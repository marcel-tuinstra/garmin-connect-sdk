import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const MAX_TEXT_BYTES = 256 * 1024;
const PRESENTATION_FILES = ['README.md', 'CHANGELOG.md', 'CONTRIBUTING.md', 'docs/usage.md'];

/**
 * Verifies technical packaging consistency for a packed, installed package. This is deliberately
 * not legal review: it compares exact declared metadata and trusted text, and checks only a small
 * set of explicit current-MIT presentation signals in common documentation files.
 *
 * Trusted expectations must come from `policy` or an explicit source path/root, never from the
 * packed artifact being checked. Text comparison normalizes line endings only.
 *
 * @param {{
 *   packageRoot: string,
 *   sourceLicensePath?: string,
 *   referenceRoot?: string,
 *   policy?: { expectedLicense?: string, expectedText?: string, expectedVersion?: string },
 * }} options
 */
export async function verifyPackedLicense(options) {
  const packageRoot = resolve(options.packageRoot);
  const policy = resolvePolicy(options);
  const packageJson = readPackageJson(packageRoot, 'Packed package');

  if (packageJson.license !== policy.expectedLicense) {
    throw new Error(
      'Packed package package.json license does not match the expected SPDX identifier.',
    );
  }
  if (policy.expectedVersion !== undefined && packageJson.version !== policy.expectedVersion) {
    throw new Error(
      'Packed package package.json version does not match the expected package identity.',
    );
  }

  const packedLicense = readLicense(packageRoot, 'Packed package');
  if (normalizeLineEndings(packedLicense) !== normalizeLineEndings(policy.expectedText)) {
    throw new Error('Packed package LICENSE does not match the trusted license text.');
  }

  if (!isMitLicense(policy.expectedLicense)) {
    assertNoCurrentMitPresentation(packageRoot, policy.expectedVersion);
  }
  return true;
}

function resolvePolicy({ policy = {}, referenceRoot, sourceLicensePath }) {
  const reference =
    referenceRoot === undefined
      ? undefined
      : readPackageJson(resolve(referenceRoot), 'Trusted reference');
  if (
    policy.expectedLicense !== undefined &&
    reference?.license !== undefined &&
    policy.expectedLicense !== reference.license
  ) {
    throw new Error('Trusted SPDX identity expectations conflict.');
  }
  if (
    policy.expectedVersion !== undefined &&
    reference?.version !== undefined &&
    policy.expectedVersion !== reference.version
  ) {
    throw new Error('Trusted package version expectations conflict.');
  }
  const expectedLicense = policy.expectedLicense ?? reference?.license;
  const expectedVersion = policy.expectedVersion ?? reference?.version;
  const expectedTexts = [
    policy.expectedText,
    sourceLicensePath === undefined
      ? undefined
      : readTextFile(resolve(sourceLicensePath), 'Trusted source LICENSE'),
    referenceRoot === undefined
      ? undefined
      : readLicense(resolve(referenceRoot), 'Trusted reference'),
  ].filter((text) => text !== undefined);
  const expectedText = expectedTexts[0];

  if (typeof expectedLicense !== 'string' || expectedLicense.trim() === '') {
    throw new TypeError(
      'License policy must provide an expected SPDX identifier or referenceRoot.',
    );
  }
  if (typeof expectedText !== 'string' || expectedText.trim() === '') {
    throw new TypeError(
      'License policy must provide expectedText or referenceRoot/sourceLicensePath.',
    );
  }
  if (
    expectedTexts.some((text) => normalizeLineEndings(text) !== normalizeLineEndings(expectedText))
  ) {
    throw new Error('Trusted license text expectations conflict.');
  }
  if (
    expectedVersion !== undefined &&
    (typeof expectedVersion !== 'string' || expectedVersion.trim() === '')
  ) {
    throw new TypeError('License policy expectedVersion must be a nonempty string when provided.');
  }

  return { expectedLicense, expectedText, expectedVersion };
}

function readPackageJson(root, label) {
  const path = join(root, 'package.json');
  const text = readTextFile(path, `${label} package.json`);
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error(`${label} package.json is not valid JSON.`);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} package.json must contain an object.`);
  }
  if (typeof value.license !== 'string' || value.license.trim() === '') {
    throw new Error(`${label} package.json must contain a nonempty license.`);
  }
  if (typeof value.version !== 'string' || value.version.trim() === '') {
    throw new Error(`${label} package.json must contain a nonempty version.`);
  }
  return value;
}

function readLicense(root, label) {
  const licenseNames = readdirSync(root, { withFileTypes: true })
    .filter((entry) => /^LICENSE(?:[._-].*)?$/i.test(entry.name))
    .map((entry) => entry.name);
  if (licenseNames.length > 1) {
    throw new Error(`${label} has ambiguous LICENSE files.`);
  }
  if (licenseNames[0] !== 'LICENSE') {
    throw new Error(`${label} LICENSE is missing.`);
  }
  return readTextFile(join(root, 'LICENSE'), `${label} LICENSE`);
}

function readTextFile(path, label) {
  if (!existsSync(path)) throw new Error(`${label} is missing.`);
  const stat = lstatSync(path);
  if (!stat.isFile()) throw new Error(`${label} must be a regular file.`);
  if (stat.size > MAX_TEXT_BYTES) throw new Error(`${label} exceeds the supported size limit.`);
  const text = readFileSync(path, 'utf8');
  if (text.trim() === '') throw new Error(`${label} must be nonempty.`);
  return text;
}

function assertNoCurrentMitPresentation(packageRoot, expectedVersion) {
  for (const relativePath of PRESENTATION_FILES) {
    const path = join(packageRoot, relativePath);
    if (!existsSync(path)) continue;
    const text = readTextFile(path, `Packed package ${relativePath}`);
    let changelogVersion;
    for (const line of normalizeLineEndings(text).split('\n')) {
      if (relativePath === 'CHANGELOG.md' && /^#{1,2}\s/.test(line)) {
        changelogVersion = parseChangelogHeading(line);
      }
      // A historical clause cannot excuse a separate current-license claim on the same line.
      for (const clause of line.split(/;\s*|[.!?]\s+|,\s+(?=(?:but|now|currently)\b)/i)) {
        if (
          isCurrentMitPresentation(clause) &&
          !isHistoricalMitPresentation(clause, changelogVersion, expectedVersion)
        ) {
          throw new Error(`Packed package ${relativePath} contains a current MIT presentation.`);
        }
      }
    }
  }
}

function isCurrentMitPresentation(line) {
  const mitSignal =
    /(?:\bMIT License\b|\blicen[cs]e[- :=]*(?:\s|\[|\*|\x60)*MIT\b|\blicensed under MIT\b|\bMIT-licensed\b)/i.test(
      line,
    );
  return (
    mitSignal &&
    !/\b(?:historically|formerly|previously|legacy)\b[^,.;\n]{0,80}\bMIT(?: License|-licensed)?\b/i.test(
      line,
    )
  );
}

function isHistoricalMitPresentation(line, changelogVersion, expectedVersion) {
  if (isEarlierVersion(changelogVersion, expectedVersion)) return true;
  const retainedRightsVersion =
    /\b(?:release|version)\s+v?(\d+\.\d+\.\d+)\b[^,.;\n]{0,80}\bretain(?:ed|s)?\b[^,.;\n]{0,80}\bMIT\b/i.exec(
      line,
    )?.[1];
  return isEarlierVersion(retainedRightsVersion, expectedVersion);
}

function parseChangelogHeading(line) {
  return /^#{1,6}\s*\[?v?(\d+\.\d+\.\d+)\]?(?:\s+-\s+\d{4}-\d{2}-\d{2})?\s*$/.exec(line)?.[1];
}

function isEarlierVersion(candidate, expected) {
  if (candidate === undefined || expected === undefined) return false;
  const candidateParts = candidate.split('.').map(Number);
  const expectedParts = expected.split('.').map(Number);
  if (
    candidateParts.some((part) => !Number.isSafeInteger(part)) ||
    expectedParts.some((part) => !Number.isSafeInteger(part))
  ) {
    return false;
  }
  for (let index = 0; index < 3; index += 1) {
    if (candidateParts[index] !== expectedParts[index])
      return candidateParts[index] < expectedParts[index];
  }
  return false;
}

function isMitLicense(identifier) {
  return identifier === 'MIT';
}

function normalizeLineEndings(text) {
  return text.replace(/\r\n?/g, '\n');
}
