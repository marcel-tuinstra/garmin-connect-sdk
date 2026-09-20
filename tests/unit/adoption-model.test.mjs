import { describe, expect, it } from 'vitest';

import {
  buildAdopterIndex,
  extractRepositoryEvidence,
  mergeAdopterIndex,
  normalizeSourceStatus,
} from '../../tools/adoption/model.mjs';

const observedAt = '2026-09-20T10:00:00.000Z';

describe('adoption evidence model', () => {
  it('keeps declarations, lock resolutions, imports, and active-use evidence distinct', () => {
    const evidence = [
      ...extractRepositoryEvidence({
        path: 'package.json',
        content: JSON.stringify({ dependencies: { 'garmin-connect-sdk': '^1.1.0' } }),
        sourceUrl: 'https://github.com/example/app/blob/main/package.json',
        observedAt,
      }),
      ...extractRepositoryEvidence({
        path: 'package-lock.json',
        content: JSON.stringify({
          packages: {
            'node_modules/garmin-connect-sdk': { version: '1.1.1' },
          },
        }),
        sourceUrl: 'https://github.com/example/app/blob/main/package-lock.json',
        observedAt,
      }),
      ...extractRepositoryEvidence({
        path: 'src/index.ts',
        content:
          "import { GarminConnectSDK } from 'garmin-connect-sdk';\nconst garmin = new GarminConnectSDK();",
        sourceUrl: 'https://github.com/example/app/blob/main/src/index.ts',
        observedAt,
      }),
    ];

    expect(evidence.map(({ type }) => type)).toEqual([
      'dependency_declaration',
      'lockfile_resolution',
      'sdk_import',
      'active_use_evidence',
    ]);
    expect(evidence[0]).toMatchObject({ declaredVersionRange: '^1.1.0', parseStatus: 'parsed' });
    expect(evidence[1]).toMatchObject({ resolvedVersion: '1.1.1', parseStatus: 'parsed' });
  });

  it.each([
    ['workspace:*', 'parsed'],
    ['>=1 <2', 'parsed'],
    ['', 'malformed'],
    ['1.1.0\n=HYPERLINK("https://evil.example")', 'malformed'],
  ])('retains a bounded declaration %j with %s status', (range, parseStatus) => {
    const [evidence] = extractRepositoryEvidence({
      path: 'package.json',
      content: JSON.stringify({ dependencies: { 'garmin-connect-sdk': range } }),
      sourceUrl: 'https://github.com/example/app/blob/main/package.json',
      observedAt,
    });

    expect(evidence).toMatchObject({
      type: 'dependency_declaration',
      declaredVersionRange: range || null,
      parseStatus,
    });
  });

  it('records malformed manifests without promoting them to dependency evidence', () => {
    expect(
      extractRepositoryEvidence({
        path: 'package.json',
        content: '{ definitely not json',
        sourceUrl: 'https://github.com/example/app/blob/main/package.json',
        observedAt,
      }),
    ).toEqual([
      expect.objectContaining({ type: 'dependency_declaration', parseStatus: 'malformed' }),
    ]);
  });

  it('extracts a resolved version from a pnpm v9 lockfile key', () => {
    expect(
      extractRepositoryEvidence({
        path: 'pnpm-lock.yaml',
        content:
          "packages:\n  'garmin-connect-sdk@1.1.1':\n    resolution: {integrity: sha512-test}\n",
        sourceUrl: 'https://github.com/example/app/blob/main/pnpm-lock.yaml',
        observedAt,
      }),
    ).toEqual([
      expect.objectContaining({
        type: 'lockfile_resolution',
        resolvedVersion: '1.1.1',
        parseStatus: 'parsed',
      }),
    ]);
  });

  it('extracts a resolved version from a Yarn Berry lockfile block', () => {
    expect(
      extractRepositoryEvidence({
        path: 'yarn.lock',
        content:
          '"garmin-connect-sdk@npm:^1.1.0":\n  version: 1.1.1\n  resolution: "garmin-connect-sdk@npm:1.1.1"\n',
        sourceUrl: 'https://github.com/example/app/blob/main/yarn.lock',
        observedAt,
      }),
    ).toEqual([
      expect.objectContaining({
        type: 'lockfile_resolution',
        resolvedVersion: '1.1.1',
        parseStatus: 'parsed',
      }),
    ]);
  });

  it('deduplicates repositories case-insensitively and lowers confidence for forks and archives', () => {
    const index = buildAdopterIndex([
      {
        repository: {
          owner: 'Example',
          name: 'App',
          url: 'https://github.com/Example/App',
          visibility: 'public',
          archived: false,
          fork: false,
          disabled: false,
        },
        evidence: [{ type: 'dependency_declaration', declaredVersionRange: '^1.1.0' }],
        observedAt,
      },
      {
        repository: {
          owner: 'example',
          name: 'app',
          url: 'https://github.com/example/app',
          visibility: 'public',
          archived: true,
          fork: true,
          disabled: false,
        },
        evidence: [{ type: 'sdk_import' }, { type: 'active_use_evidence' }],
        observedAt,
      },
    ]);

    expect(index).toHaveLength(1);
    expect(index[0]).toMatchObject({
      repositoryKey: 'example/app',
      repositoryState: 'archived_fork',
      confidence: 'low',
      countsAsAdopter: false,
      declaredVersionRange: '^1.1.0',
    });
    expect(index[0].evidenceTypes).toEqual([
      'active_use_evidence',
      'dependency_declaration',
      'sdk_import',
    ]);
  });

  it('rejects private or unsafe repository identities', () => {
    expect(
      buildAdopterIndex([
        {
          repository: {
            owner: 'private-owner',
            name: 'private-app',
            url: 'https://github.com/private-owner/private-app',
            visibility: 'private',
          },
          evidence: [{ type: 'sdk_import' }],
          observedAt,
        },
        {
          repository: {
            owner: 'evil\nowner',
            name: 'app',
            url: 'https://github.com/evil/app',
            visibility: 'public',
          },
          evidence: [{ type: 'sdk_import' }],
          observedAt,
        },
      ]),
    ).toEqual([]);
  });

  it('retains a previously observed adopter when the next search sample is empty', () => {
    const repository = {
      owner: 'example',
      name: 'app',
      url: 'https://github.com/example/app',
      visibility: 'public',
      archived: false,
      fork: false,
      disabled: false,
    };
    const first = mergeAdopterIndex(
      [],
      [
        {
          repository,
          evidence: [{ type: 'sdk_import' }, { type: 'active_use_evidence' }],
          observedAt,
        },
      ],
      { observedAt },
    );
    const next = mergeAdopterIndex(first, [], {
      observedAt: '2026-09-21T10:00:00.000Z',
    });

    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({
      repositoryKey: 'example/app',
      firstObservedAt: observedAt,
      lastObservedAt: observedAt,
      observationState: 'not_observed',
      stale: false,
      countsAsAdopter: true,
    });
  });

  it('expires stale adopters and applies an explicit suppression list', () => {
    const existing = [
      {
        ...buildAdopterIndex([
          {
            repository: {
              owner: 'example',
              name: 'app',
              url: 'https://github.com/example/app',
              visibility: 'public',
            },
            evidence: [{ type: 'active_use_evidence' }],
            observedAt,
          },
        ])[0],
        firstObservedAt: observedAt,
        lastObservedAt: observedAt,
      },
    ];

    expect(
      mergeAdopterIndex(existing, [], { observedAt: '2026-11-01T10:00:00.000Z' })[0],
    ).toMatchObject({ stale: true, countsAsAdopter: false });
    expect(
      mergeAdopterIndex(existing, [], {
        observedAt: '2026-09-21T10:00:00.000Z',
        suppressions: ['example/app'],
      }),
    ).toEqual([]);
  });

  it('uses current repository metadata and the latest observed versions', () => {
    const older = '2026-09-01T10:00:00.000Z';
    const current = mergeAdopterIndex(
      buildAdopterIndex([
        {
          repository: {
            owner: 'example',
            name: 'app',
            url: 'https://github.com/example/app',
            visibility: 'public',
            archived: true,
            fork: true,
            disabled: false,
          },
          evidence: [
            { type: 'dependency_declaration', declaredVersionRange: '^1.0.0', observedAt: older },
            { type: 'lockfile_resolution', resolvedVersion: '1.0.0', observedAt: older },
          ],
          observedAt: older,
        },
      ]),
      [
        {
          repository: {
            owner: 'example',
            name: 'app',
            url: 'https://github.com/example/app',
            visibility: 'public',
            archived: false,
            fork: false,
            disabled: false,
          },
          evidence: [
            {
              type: 'dependency_declaration',
              declaredVersionRange: '^1.1.0',
              observedAt,
            },
            { type: 'lockfile_resolution', resolvedVersion: '1.1.1', observedAt },
          ],
          observedAt,
        },
      ],
      { observedAt },
    );

    expect(current[0]).toMatchObject({
      repositoryState: 'active',
      declaredVersionRange: '^1.1.0',
      resolvedVersion: '1.1.1',
      countsAsAdopter: true,
    });
  });

  it('does not age unseen repositories after an incomplete discovery pass', () => {
    const existing = mergeAdopterIndex(
      [],
      [
        {
          repository: {
            owner: 'example',
            name: 'app',
            url: 'https://github.com/example/app',
            visibility: 'public',
          },
          evidence: [{ type: 'active_use_evidence', observedAt }],
          observedAt,
        },
      ],
      { observedAt },
    );

    expect(
      mergeAdopterIndex(existing, [], {
        observedAt: '2026-11-01T10:00:00.000Z',
        completeObservation: false,
      })[0],
    ).toMatchObject({ observationState: 'observed', stale: false, countsAsAdopter: true });
  });

  it.each([
    [401, {}, 'denied'],
    [403, { 'x-ratelimit-remaining': '0' }, 'rate_limited'],
    [403, {}, 'denied'],
    [429, { 'retry-after': '60' }, 'rate_limited'],
    [500, {}, 'failed'],
  ])('maps HTTP %i to %s without inventing zeroes', (httpStatus, headers, status) => {
    expect(normalizeSourceStatus({ httpStatus, headers })).toMatchObject({ status, httpStatus });
  });
});
