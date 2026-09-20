import { URL } from 'node:url';

const PACKAGE_NAME = 'garmin-connect-sdk';
const SAFE_REPOSITORY_PART = /^[A-Za-z0-9_.-]{1,100}$/;
const SAFE_VERSION_RANGE = /^[\x20-\x7e]{1,128}$/;
const EVIDENCE_TYPES = new Set([
  'dependency_declaration',
  'lockfile_resolution',
  'sdk_import',
  'active_use_evidence',
]);

export function normalizeSourceStatus({ httpStatus, headers = {} }) {
  const remaining = headerValue(headers, 'x-ratelimit-remaining');
  const retryAfter = headerValue(headers, 'retry-after');
  let status = 'failed';

  if (httpStatus === 401) status = 'denied';
  else if (httpStatus === 429 || (httpStatus === 403 && remaining === '0')) {
    status = 'rate_limited';
  } else if (httpStatus === 403) status = 'denied';
  else if (httpStatus === 404) status = 'missing';

  const result = { status, httpStatus };
  if (remaining !== null && /^\d+$/.test(remaining)) result.rateLimitRemaining = Number(remaining);
  if (retryAfter !== null && /^\d+$/.test(retryAfter)) {
    result.retryAfterSeconds = Math.min(Number(retryAfter), 86_400);
  }
  return result;
}

export function extractRepositoryEvidence({ path, content, sourceUrl, observedAt }) {
  if (typeof path !== 'string' || typeof content !== 'string' || content.length > 262_144) {
    return [];
  }

  const lowerPath = path.toLowerCase();
  const common = {
    path: safeText(path, 240),
    sourceUrl: safeGitHubUrl(sourceUrl),
    observedAt,
  };

  if (lowerPath.endsWith('package.json')) {
    return extractPackageJsonEvidence(content, common);
  }
  if (lowerPath.endsWith('package-lock.json')) {
    return extractPackageLockEvidence(content, common);
  }
  if (lowerPath.endsWith('pnpm-lock.yaml') || lowerPath.endsWith('pnpm-lock.yml')) {
    return extractPnpmLockEvidence(content, common);
  }
  if (lowerPath.endsWith('yarn.lock')) {
    return extractYarnLockEvidence(content, common);
  }

  const evidence = [];
  const importsSdk = hasSdkImport(content);
  if (importsSdk) evidence.push({ ...common, type: 'sdk_import', parseStatus: 'parsed' });
  if (importsSdk && /\bnew\s+GarminConnectSDK\s*\(/.test(content)) {
    evidence.push({ ...common, type: 'active_use_evidence', parseStatus: 'parsed' });
  }
  return evidence;
}

export function buildAdopterIndex(observations) {
  const byRepository = new Map();

  for (const observation of observations ?? []) {
    const repository = normalizeRepository(observation?.repository);
    if (!repository) continue;

    const repositoryKey = `${repository.owner}/${repository.name}`.toLowerCase();
    const current = byRepository.get(repositoryKey) ?? {
      repositoryKey,
      owner: repository.owner,
      repository: repository.name,
      repositoryUrl: repository.url,
      repositoryState: repositoryState(repository),
      metadataObservedAt: validIso(observation.observedAt),
      visibility: 'public',
      defaultBranch: repository.defaultBranch ?? null,
      pushedAt: repository.pushedAt ?? null,
      observedAt: observation.observedAt,
      evidence: [],
    };

    if (
      !current.metadataObservedAt ||
      validIso(observation.observedAt) >= current.metadataObservedAt
    ) {
      current.repositoryState = repositoryState(repository);
      current.metadataObservedAt = validIso(observation.observedAt);
      current.defaultBranch = repository.defaultBranch ?? current.defaultBranch;
      current.pushedAt = repository.pushedAt ?? current.pushedAt;
    }
    current.observedAt = latestIso(current.observedAt, observation.observedAt);
    for (const evidence of observation.evidence ?? []) {
      const normalized = normalizeEvidence(evidence);
      if (!normalized) continue;
      const key = [
        normalized.type,
        normalized.path,
        normalized.sourceUrl,
        normalized.declaredVersionRange,
        normalized.resolvedVersion,
      ].join('|');
      if (!current.evidence.some((item) => item.key === key)) {
        current.evidence.push({ ...normalized, key });
      }
    }
    byRepository.set(repositoryKey, current);
  }

  return [...byRepository.values()]
    .map((entry) => finalizeAdopter(entry))
    .sort((left, right) => left.repositoryKey.localeCompare(right.repositoryKey));
}

export function mergeAdopterIndex(
  existing,
  observations,
  { observedAt, staleAfterDays = 30, suppressions = [], completeObservation = true },
) {
  const suppressionSet = new Set(
    suppressions.filter((value) => validRepositoryKey(value)).map((value) => value.toLowerCase()),
  );
  const seen = new Set(
    (observations ?? [])
      .map((observation) => repositoryKeyFromObservation(observation))
      .filter(Boolean),
  );
  const priorByKey = new Map(
    (existing ?? [])
      .filter((adopter) => validRepositoryKey(adopter?.repositoryKey))
      .map((adopter) => [adopter.repositoryKey.toLowerCase(), adopter]),
  );
  const merged = buildAdopterIndex([
    ...(existing ?? []).map(adopterToObservation).filter(Boolean),
    ...(observations ?? []),
  ]);
  const referenceTime = Date.parse(observedAt);

  return merged.flatMap((adopter) => {
    if (suppressionSet.has(adopter.repositoryKey)) return [];
    const prior = priorByKey.get(adopter.repositoryKey);
    const firstObservedAt = earliestIso(
      prior?.firstObservedAt ?? prior?.observedAt,
      adopter.observedAt,
    );
    const lastObservedAt = seen.has(adopter.repositoryKey)
      ? latestIso(prior?.lastObservedAt ?? prior?.observedAt, adopter.observedAt)
      : (prior?.lastObservedAt ?? prior?.observedAt ?? adopter.observedAt);
    const ageDays =
      Number.isFinite(referenceTime) && Number.isFinite(Date.parse(lastObservedAt))
        ? (referenceTime - Date.parse(lastObservedAt)) / 86_400_000
        : Number.POSITIVE_INFINITY;
    const wasSeen = seen.has(adopter.repositoryKey);
    const stale = wasSeen
      ? false
      : completeObservation
        ? ageDays > staleAfterDays
        : (prior?.stale ?? false);
    return [
      {
        ...adopter,
        firstObservedAt,
        lastObservedAt,
        observationState: wasSeen
          ? 'observed'
          : completeObservation
            ? 'not_observed'
            : (prior?.observationState ?? 'observed'),
        stale,
        countsAsAdopter: adopter.countsAsAdopter && !stale,
      },
    ];
  });
}

function extractPackageJsonEvidence(content, common) {
  try {
    const manifest = JSON.parse(content);
    for (const field of [
      'dependencies',
      'devDependencies',
      'peerDependencies',
      'optionalDependencies',
    ]) {
      const dependencies = manifest?.[field];
      if (!dependencies || typeof dependencies !== 'object' || Array.isArray(dependencies))
        continue;
      if (!Object.prototype.hasOwnProperty.call(dependencies, PACKAGE_NAME)) continue;
      const raw = dependencies[PACKAGE_NAME];
      const declaredVersionRange =
        typeof raw === 'string' && raw.length <= 128 ? raw || null : null;
      return [
        {
          ...common,
          type: 'dependency_declaration',
          dependencyField: field,
          declaredVersionRange,
          parseStatus:
            declaredVersionRange && SAFE_VERSION_RANGE.test(declaredVersionRange)
              ? 'parsed'
              : 'malformed',
        },
      ];
    }
    return [];
  } catch {
    return [
      {
        ...common,
        type: 'dependency_declaration',
        declaredVersionRange: null,
        parseStatus: 'malformed',
      },
    ];
  }
}

function extractPackageLockEvidence(content, common) {
  try {
    const lock = JSON.parse(content);
    const version =
      lock?.packages?.[`node_modules/${PACKAGE_NAME}`]?.version ??
      lock?.dependencies?.[PACKAGE_NAME]?.version;
    if (typeof version !== 'string') return [];
    return [versionEvidence(version, 'package-lock.json', common)];
  } catch {
    return [{ ...common, type: 'lockfile_resolution', parseStatus: 'malformed' }];
  }
}

function extractPnpmLockEvidence(content, common) {
  const escaped = PACKAGE_NAME.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(
      `${escaped}:\\s*(?:\\r?\\n[ \\t]+[^\\n]+)*?\\r?\\n[ \\t]+version:\\s*['"]?([^'"\\s]+)`,
    ),
    new RegExp(`/${escaped}@([^:\\s()]+)`),
    new RegExp(`(?:^|\\n)\\s*["']?${escaped}@([^:\\s("']+)["']?:`),
  ];
  const match = patterns.map((pattern) => content.match(pattern)).find(Boolean);
  return match ? [versionEvidence(match[1], 'pnpm-lock.yaml', common)] : [];
}

function extractYarnLockEvidence(content, common) {
  const block = content.match(/(?:^|\n)["']?garmin-connect-sdk@[^\n]+:\r?\n([\s\S]*?)(?=\n\S|$)/);
  const version = block?.[1]?.match(/\bversion(?::\s*|\s+)["']?([^"'\s]+)["']?/)?.[1];
  return version ? [versionEvidence(version, 'yarn.lock', common)] : [];
}

function versionEvidence(version, lockfile, common) {
  const parsed = typeof version === 'string' && SAFE_VERSION_RANGE.test(version);
  return {
    ...common,
    type: 'lockfile_resolution',
    lockfile,
    resolvedVersion: parsed ? version : null,
    parseStatus: parsed ? 'parsed' : 'malformed',
  };
}

function hasSdkImport(content) {
  return (
    /(?:from\s*|require\s*\(\s*|import\s*\(\s*)['"]garmin-connect-sdk['"]/.test(content) ||
    /import\s+['"]garmin-connect-sdk['"]/.test(content)
  );
}

function normalizeRepository(repository) {
  if (!repository || repository.visibility !== 'public') return null;
  const owner = safeRepositoryPart(repository.owner);
  const name = safeRepositoryPart(repository.name);
  if (!owner || !name) return null;
  const expectedUrl = `https://github.com/${owner}/${name}`;
  if (
    repository.url !== expectedUrl &&
    repository.url?.toLowerCase() !== expectedUrl.toLowerCase()
  ) {
    return null;
  }
  return {
    owner,
    name,
    url: expectedUrl,
    visibility: 'public',
    archived: repository.archived === true,
    fork: repository.fork === true,
    disabled: repository.disabled === true,
    defaultBranch: safeText(repository.defaultBranch, 200),
    pushedAt: validIso(repository.pushedAt),
  };
}

function normalizeEvidence(evidence) {
  if (!evidence || !EVIDENCE_TYPES.has(evidence.type)) return null;
  return {
    type: evidence.type,
    path: safeText(evidence.path, 240),
    sourceUrl: safeGitHubUrl(evidence.sourceUrl),
    observedAt: validIso(evidence.observedAt),
    parseStatus: evidence.parseStatus === 'malformed' ? 'malformed' : 'parsed',
    declaredVersionRange:
      typeof evidence.declaredVersionRange === 'string' &&
      evidence.declaredVersionRange.length <= 128
        ? evidence.declaredVersionRange
        : null,
    resolvedVersion:
      typeof evidence.resolvedVersion === 'string' && evidence.resolvedVersion.length <= 128
        ? evidence.resolvedVersion
        : null,
  };
}

function finalizeAdopter(entry) {
  const evidenceTypes = [...new Set(entry.evidence.map(({ type }) => type))].sort();
  const degraded = entry.repositoryState !== 'active';
  const hasStrongUse = evidenceTypes.includes('active_use_evidence');
  const hasImportAndDependency =
    evidenceTypes.includes('sdk_import') && evidenceTypes.includes('dependency_declaration');
  const hasResolvedDependency =
    evidenceTypes.includes('lockfile_resolution') &&
    evidenceTypes.includes('dependency_declaration');
  const confidence = degraded
    ? 'low'
    : hasStrongUse || hasResolvedDependency
      ? 'high'
      : hasImportAndDependency
        ? 'medium'
        : 'low';
  const evidence = entry.evidence
    .map((entryEvidence) => {
      const item = { ...entryEvidence };
      delete item.key;
      return item;
    })
    .sort((left, right) =>
      [left.type, left.path ?? '', left.sourceUrl ?? '']
        .join('|')
        .localeCompare([right.type, right.path ?? '', right.sourceUrl ?? ''].join('|')),
    );
  const declaredEvidence = latestEvidence(evidence, 'declaredVersionRange');
  const resolvedEvidence = latestEvidence(evidence, 'resolvedVersion');

  return {
    repositoryKey: entry.repositoryKey,
    owner: entry.owner,
    repository: entry.repository,
    repositoryUrl: entry.repositoryUrl,
    repositoryState: entry.repositoryState,
    visibility: 'public',
    defaultBranch: entry.defaultBranch,
    pushedAt: entry.pushedAt,
    observedAt: entry.observedAt,
    declaredVersionRange: declaredEvidence?.declaredVersionRange ?? null,
    resolvedVersion: resolvedEvidence?.resolvedVersion ?? null,
    evidenceTypes,
    sourceUrls: [...new Set(evidence.map(({ sourceUrl }) => sourceUrl).filter(Boolean))].sort(),
    confidence,
    countsAsAdopter: !degraded && (hasStrongUse || hasImportAndDependency || hasResolvedDependency),
    evidence,
  };
}

function repositoryState(repository) {
  const archived = repository.archived;
  const fork = repository.fork;
  const disabled = repository.disabled;
  if (disabled) return 'disabled';
  if (archived && fork) return 'archived_fork';
  if (archived) return 'archived';
  if (fork) return 'fork';
  return 'active';
}

function latestEvidence(evidence, field) {
  return evidence
    .filter((item) => item[field])
    .sort((left, right) => String(right.observedAt ?? '').localeCompare(left.observedAt ?? ''))[0];
}

function headerValue(headers, name) {
  if (headers && typeof headers.get === 'function') return headers.get(name);
  const entry = Object.entries(headers ?? {}).find(([key]) => key.toLowerCase() === name);
  return entry ? String(entry[1]) : null;
}

function safeRepositoryPart(value) {
  return typeof value === 'string' && SAFE_REPOSITORY_PART.test(value) ? value : null;
}

function safeGitHubUrl(value) {
  if (typeof value !== 'string' || value.length > 500) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'github.com' ? url.toString() : null;
  } catch {
    return null;
  }
}

function safeText(value, maxLength) {
  return typeof value === 'string' && value.length <= maxLength && !hasControlCharacter(value)
    ? value
    : null;
}

function hasControlCharacter(value) {
  return [...value].some((character) => character.codePointAt(0) < 32);
}

function validIso(value) {
  if (typeof value !== 'string') return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function latestIso(left, right) {
  const validLeft = validIso(left);
  const validRight = validIso(right);
  if (!validLeft) return validRight;
  if (!validRight) return validLeft;
  return validLeft > validRight ? validLeft : validRight;
}

function earliestIso(left, right) {
  const validLeft = validIso(left);
  const validRight = validIso(right);
  if (!validLeft) return validRight;
  if (!validRight) return validLeft;
  return validLeft < validRight ? validLeft : validRight;
}

function repositoryKeyFromObservation(observation) {
  const owner = safeRepositoryPart(observation?.repository?.owner);
  const name = safeRepositoryPart(observation?.repository?.name);
  return owner && name ? `${owner}/${name}`.toLowerCase() : null;
}

function validRepositoryKey(value) {
  if (typeof value !== 'string') return false;
  const [owner, name, extra] = value.split('/');
  return !extra && Boolean(safeRepositoryPart(owner) && safeRepositoryPart(name));
}

function adopterToObservation(adopter) {
  if (!validRepositoryKey(adopter?.repositoryKey)) return null;
  const state = adopter.repositoryState ?? 'active';
  return {
    repository: {
      owner: adopter.owner,
      name: adopter.repository,
      url: adopter.repositoryUrl,
      visibility: 'public',
      archived: state.includes('archived'),
      fork: state.includes('fork'),
      disabled: state === 'disabled',
      defaultBranch: adopter.defaultBranch,
      pushedAt: adopter.pushedAt,
    },
    evidence: adopter.evidence ?? [],
    observedAt: adopter.lastObservedAt ?? adopter.observedAt,
  };
}
