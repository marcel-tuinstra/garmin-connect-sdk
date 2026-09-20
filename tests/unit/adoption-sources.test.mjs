import { Buffer } from 'node:buffer';

import { describe, expect, it, vi } from 'vitest';

import {
  collectGitHubTraffic,
  collectNpmDownloads,
  collectPublicRepositoryEvidence,
  collectVoluntaryRegistrations,
} from '../../tools/adoption/sources.mjs';

const retrievedAt = '2026-09-20T10:00:00.000Z';
const aggregateUrl = 'https://adoption.example.test/v1/aggregate';

function response(status, body, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new globalThis.Headers(headers),
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

function trafficSeries(count, uniques) {
  return Array.from({ length: 14 }, (_, index) => {
    const date = new Date(Date.UTC(2026, 8, 6 + index)).toISOString().slice(0, 10);
    return {
      timestamp: `${date}T00:00:00Z`,
      count: index === 13 ? count : 0,
      uniques: index === 13 ? uniques : 0,
    };
  });
}

describe('adoption source adapters', () => {
  it('collects only thresholded aggregate voluntary registrations', async () => {
    const result = await collectVoluntaryRegistrations({
      fetchImpl: vi.fn().mockResolvedValue(
        response(200, {
          schemaVersion: 1,
          measuredAt: retrievedAt,
          activeRegistrations: 5,
          threshold: 5,
          sdkVersions: { 1.2: 5 },
          visibility: { private: 5 },
        }),
      ),
      token: 'aggregate-only-secret',
      aggregateUrl,
      retrievedAt,
    });

    expect(result.status).toEqual({ source: 'private_opt_in_self_report', status: 'success' });
    expect(result.measurements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'private_opt_in_self_report',
          metric: 'active_registrations',
          value: 5,
        }),
        expect.objectContaining({
          metric: 'sdk_version_registrations',
          dimension: '1.2',
          value: 5,
        }),
        expect.objectContaining({
          metric: 'visibility_registrations',
          dimension: 'private',
          value: 5,
        }),
      ]),
    );
    expect(JSON.stringify(result)).not.toContain('aggregate-only-secret');
  });

  it.each([
    ['missing token', '', vi.fn(), 'missing'],
    ['rate limited', 'token', vi.fn().mockResolvedValue(response(429, {})), 'rate_limited'],
    [
      'malformed response',
      'token',
      vi.fn().mockResolvedValue(response(200, { activeRegistrations: 0 })),
      'failed',
    ],
  ])('keeps aggregate source %s distinct from zero', async (_label, token, fetchImpl, status) => {
    const result = await collectVoluntaryRegistrations({
      fetchImpl,
      token,
      aggregateUrl,
      retrievedAt,
    });
    expect(result.status.status).toBe(status);
    expect(result.measurements).toEqual([
      expect.objectContaining({ metric: 'active_registrations', value: null, status }),
    ]);
  });

  it.each(['', 'http://adoption.example.test/v1/aggregate', 'https://example.test/other'])(
    'keeps an unauthorized aggregate endpoint %j missing without a request',
    async (configuredUrl) => {
      const fetchImpl = vi.fn();
      const result = await collectVoluntaryRegistrations({
        fetchImpl,
        token: 'aggregate-only-secret',
        aggregateUrl: configuredUrl,
        retrievedAt,
      });
      expect(result.status).toMatchObject({
        status: 'missing',
        reasonCode: 'endpoint_unconfigured',
      });
      expect(fetchImpl).not.toHaveBeenCalled();
    },
  );

  it('rejects a below-threshold non-zero aggregate instead of publishing it', async () => {
    const result = await collectVoluntaryRegistrations({
      fetchImpl: vi.fn().mockResolvedValue(
        response(200, {
          schemaVersion: 1,
          measuredAt: retrievedAt,
          activeRegistrations: 1,
          threshold: 5,
          sdkVersions: {},
          visibility: {},
        }),
      ),
      token: 'aggregate-only-secret',
      aggregateUrl,
      retrievedAt,
    });

    expect(result.status).toMatchObject({ status: 'failed', reasonCode: 'invalid_payload' });
    expect(result.measurements[0]).toMatchObject({ status: 'failed', value: null });
  });

  it.each([
    ['threshold below five', 5, 4, { 1.2: 4 }, { private: 4 }],
    ['non-rounded total', 6, 5, { 1.2: 5 }, { private: 5 }],
    ['non-rounded bucket', 10, 5, { 1.2: 6 }, { private: 10 }],
    ['bucket sum above total', 5, 5, { 1.1: 5, 1.2: 5 }, { private: 5 }],
  ])(
    'rejects an aggregate with %s',
    async (_label, activeRegistrations, threshold, sdkVersions, visibility) => {
      const result = await collectVoluntaryRegistrations({
        fetchImpl: vi.fn().mockResolvedValue(
          response(200, {
            schemaVersion: 1,
            measuredAt: retrievedAt,
            activeRegistrations,
            threshold,
            sdkVersions,
            visibility,
          }),
        ),
        token: 'aggregate-only-secret',
        aggregateUrl,
        retrievedAt,
      });

      expect(result.status).toMatchObject({ status: 'failed', reasonCode: 'invalid_payload' });
      expect(result.measurements[0]).toMatchObject({ status: 'failed', value: null });
    },
  );

  it('collects npm daily and version-level downloads without conflating their windows', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        response(200, {
          start: '2026-09-18',
          end: '2026-09-19',
          package: 'garmin-connect-sdk',
          downloads: [
            { day: '2026-09-18', downloads: 0 },
            { day: '2026-09-19', downloads: 12 },
          ],
        }),
      )
      .mockResolvedValueOnce(
        response(200, {
          start: '2026-09-13',
          end: '2026-09-19',
          package: 'garmin-connect-sdk',
          downloads: { '1.0.0': 3, '1.1.1': 7 },
        }),
      );

    const result = await collectNpmDownloads({
      fetchImpl,
      packageName: 'garmin-connect-sdk',
      startDate: '2026-09-18',
      endDate: '2026-09-19',
      retrievedAt,
    });

    expect(result.status).toMatchObject({ source: 'npm_downloads', status: 'success' });
    expect(result.measurements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          metric: 'package_downloads',
          metricDate: '2026-09-18',
          value: 0,
        }),
        expect.objectContaining({
          metric: 'package_downloads',
          metricDate: '2026-09-19',
          value: 12,
        }),
        expect.objectContaining({
          metric: 'version_downloads_last_week',
          dimension: '1.1.1',
          value: 7,
          windowStart: '2026-09-13',
          windowEnd: '2026-09-19',
        }),
      ]),
    );
  });

  it.each([
    [401, {}, 'denied'],
    [403, { 'x-ratelimit-remaining': '0' }, 'rate_limited'],
    [429, { 'retry-after': '120' }, 'rate_limited'],
  ])('persists npm HTTP %i as %s with a null measurement', async (status, headers, expected) => {
    const result = await collectNpmDownloads({
      fetchImpl: vi
        .fn()
        .mockResolvedValue(response(status, { message: 'secret upstream body' }, headers)),
      packageName: 'garmin-connect-sdk',
      startDate: '2026-09-18',
      endDate: '2026-09-19',
      retrievedAt,
    });

    expect(result.status.status).toBe(expected);
    expect(result.measurements[0]).toMatchObject({ status: expected, value: null });
    expect(JSON.stringify(result)).not.toContain('secret upstream body');
  });

  it('marks a successful HTTP response with malformed npm data as failed, not zero', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(response(200, { downloads: 'not-an-array' }))
      .mockResolvedValueOnce(
        response(200, {
          start: '2026-09-13',
          end: '2026-09-19',
          package: 'garmin-connect-sdk',
          downloads: {},
        }),
      );

    const result = await collectNpmDownloads({
      fetchImpl,
      packageName: 'garmin-connect-sdk',
      startDate: '2026-09-18',
      endDate: '2026-09-19',
      retrievedAt,
    });

    expect(result.status.status).toBe('partial');
    expect(result.statuses[0]).toMatchObject({
      source: 'npm_downloads',
      status: 'failed',
      reasonCode: 'invalid_payload',
    });
    expect(result.measurements[0]).toMatchObject({ status: 'failed', value: null });
  });

  it('still records version downloads when the independent daily endpoint fails', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(response(500, { message: 'daily unavailable' }))
      .mockResolvedValueOnce(
        response(200, {
          start: '2026-09-13',
          end: '2026-09-19',
          package: 'garmin-connect-sdk',
          downloads: { '1.1.1': 9 },
        }),
      );

    const result = await collectNpmDownloads({
      fetchImpl,
      packageName: 'garmin-connect-sdk',
      startDate: '2026-09-18',
      endDate: '2026-09-19',
      retrievedAt,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.status.status).toBe('partial');
    expect(result.measurements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ metric: 'package_downloads', status: 'failed', value: null }),
        expect.objectContaining({
          metric: 'version_downloads_last_week',
          dimension: '1.1.1',
          status: 'observed',
          value: 9,
        }),
      ]),
    );
  });

  it('labels version downloads by retrieval date when npm omits window metadata', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        response(200, {
          start: '2026-09-18',
          end: '2026-09-19',
          package: 'garmin-connect-sdk',
          downloads: [
            { day: '2026-09-18', downloads: 1 },
            { day: '2026-09-19', downloads: 2 },
          ],
        }),
      )
      .mockResolvedValueOnce(
        response(200, {
          package: 'garmin-connect-sdk',
          downloads: { '1.1.1': 9 },
        }),
      );

    const result = await collectNpmDownloads({
      fetchImpl,
      packageName: 'garmin-connect-sdk',
      startDate: '2026-09-18',
      endDate: '2026-09-19',
      retrievedAt,
    });

    expect(result.status.status).toBe('success');
    expect(result.measurements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          metric: 'version_downloads_last_week',
          metricDate: '2026-09-20',
          status: 'observed',
          value: 9,
          windowStart: null,
          windowEnd: null,
        }),
      ]),
    );
  });

  it('collects GitHub views and clones as separate daily metrics', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        response(200, {
          count: 9,
          uniques: 4,
          views: trafficSeries(5, 3),
        }),
      )
      .mockResolvedValueOnce(
        response(200, {
          count: 2,
          uniques: 2,
          clones: trafficSeries(2, 2),
        }),
      );

    const result = await collectGitHubTraffic({
      fetchImpl,
      repository: 'marcel-tuinstra/garmin-connect-sdk',
      token: 'not-logged',
      retrievedAt,
    });

    expect(result.status.status).toBe('success');
    expect(result.measurements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ metric: 'views', value: 5 }),
        expect.objectContaining({ metric: 'unique_viewers', value: 3 }),
        expect.objectContaining({ metric: 'clones', value: 2 }),
        expect.objectContaining({ metric: 'unique_cloners', value: 2 }),
      ]),
    );
    expect(JSON.stringify(result)).not.toContain('not-logged');
  });

  it('marks traffic unavailable when its separate token is absent', async () => {
    const result = await collectGitHubTraffic({
      fetchImpl: vi.fn(),
      repository: 'marcel-tuinstra/garmin-connect-sdk',
      token: '',
      retrievedAt,
    });

    expect(result.status).toMatchObject({ status: 'missing', reasonCode: 'token_missing' });
    expect(result.measurements.map(({ metric }) => metric)).toEqual([
      'views',
      'unique_viewers',
      'clones',
      'unique_cloners',
    ]);
    expect(
      result.measurements.every(({ status, value }) => status === 'missing' && value === null),
    ).toBe(true);
  });

  it('keeps malformed traffic payloads distinct from observed zero', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(response(200, { count: 0, uniques: 0, views: 'invalid' }))
      .mockResolvedValueOnce(response(200, { count: 0, uniques: 0, clones: [] }));

    const result = await collectGitHubTraffic({
      fetchImpl,
      repository: 'marcel-tuinstra/garmin-connect-sdk',
      token: 'not-logged',
      retrievedAt,
    });

    expect(result.status.status).toBe('partial');
    expect(result.measurements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ metric: 'views', status: 'failed', value: null }),
        expect.objectContaining({ metric: 'clones_window_total', status: 'observed', value: 0 }),
      ]),
    );
  });

  it('deduplicates public search hits and records archive/fork state without executing source', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        response(200, {
          incomplete_results: false,
          total_count: 2,
          items: [
            {
              path: 'package.json',
              html_url: 'https://github.com/Example/App/blob/main/package.json',
              url: 'https://api.github.com/repositories/1/contents/package.json',
              repository: {
                full_name: 'Example/App',
                url: 'https://api.github.com/repos/Example/App',
              },
            },
            {
              path: 'src/index.ts',
              html_url: 'https://github.com/example/app/blob/main/src/index.ts',
              url: 'https://api.github.com/repositories/1/contents/src/index.ts',
              repository: {
                full_name: 'example/app',
                url: 'https://api.github.com/repos/example/app',
              },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        response(200, {
          full_name: 'Example/App',
          html_url: 'https://github.com/Example/App',
          visibility: 'public',
          archived: true,
          fork: true,
          disabled: false,
          default_branch: 'main',
          pushed_at: '2026-09-18T12:00:00Z',
        }),
      )
      .mockResolvedValueOnce(
        response(200, {
          encoding: 'base64',
          size: 72,
          content: Buffer.from(
            JSON.stringify({ dependencies: { 'garmin-connect-sdk': '^1.1.0' } }),
          ).toString('base64'),
        }),
      )
      .mockResolvedValueOnce(
        response(200, {
          encoding: 'base64',
          size: 120,
          content: Buffer.from(
            "import { GarminConnectSDK } from 'garmin-connect-sdk'; new GarminConnectSDK();",
          ).toString('base64'),
        }),
      );

    const result = await collectPublicRepositoryEvidence({
      fetchImpl,
      token: 'public-only-token',
      retrievedAt,
      queries: ['"garmin-connect-sdk"'],
    });

    expect(result.status.status).toBe('success');
    expect(result.adopters).toHaveLength(1);
    expect(result.adopters[0]).toMatchObject({
      repositoryKey: 'example/app',
      repositoryState: 'archived_fork',
      countsAsAdopter: false,
    });
  });

  it('filters private repositories returned by search and reports truncated search as partial', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        response(200, {
          incomplete_results: true,
          total_count: 1,
          items: [
            {
              path: 'package.json',
              html_url: 'https://github.com/private/app/blob/main/package.json',
              url: 'https://api.github.com/repositories/2/contents/package.json',
              repository: {
                full_name: 'private/app',
                url: 'https://api.github.com/repos/private/app',
              },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        response(200, {
          full_name: 'private/app',
          html_url: 'https://github.com/private/app',
          visibility: 'private',
        }),
      );

    const result = await collectPublicRepositoryEvidence({
      fetchImpl,
      token: 'public-only-token',
      retrievedAt,
      queries: ['"garmin-connect-sdk"'],
    });

    expect(result.status.status).toBe('partial');
    expect(result.adopters).toEqual([]);
  });

  it('keeps evidence from successful queries when a later search is rate-limited', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        response(200, {
          incomplete_results: false,
          total_count: 1,
          items: [
            {
              path: 'package.json',
              html_url: 'https://github.com/example/app/blob/main/package.json',
              url: 'https://api.github.com/repositories/1/contents/package.json',
              repository: {
                full_name: 'example/app',
                url: 'https://api.github.com/repos/example/app',
              },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(response(429, { message: 'rate limited' }, { 'retry-after': '60' }))
      .mockResolvedValueOnce(
        response(200, {
          full_name: 'example/app',
          html_url: 'https://github.com/example/app',
          visibility: 'public',
          archived: false,
          fork: false,
          disabled: false,
          default_branch: 'main',
          pushed_at: '2026-09-18T12:00:00Z',
        }),
      )
      .mockResolvedValueOnce(
        response(200, {
          encoding: 'base64',
          size: 72,
          content: Buffer.from(
            JSON.stringify({ dependencies: { 'garmin-connect-sdk': '^1.1.0' } }),
          ).toString('base64'),
        }),
      );

    const result = await collectPublicRepositoryEvidence({
      fetchImpl,
      token: 'public-only-token',
      retrievedAt,
      queries: ['first query', 'second query'],
    });

    expect(result.status.status).toBe('partial');
    expect(result.statuses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'github_public_search_query_2',
          status: 'rate_limited',
        }),
      ]),
    );
    expect(result.adopters).toEqual([
      expect.objectContaining({ repositoryKey: 'example/app', countsAsAdopter: false }),
    ]);
  });

  it('treats a malformed successful code-search response as failed, never as an empty census', async () => {
    const result = await collectPublicRepositoryEvidence({
      fetchImpl: vi.fn().mockResolvedValue(response(200, { incomplete_results: false })),
      token: 'public-only-token',
      retrievedAt,
      queries: ['query'],
    });

    expect(result.status.status).toBe('failed');
    expect(result.statuses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: 'failed', reasonCode: 'invalid_payload' }),
      ]),
    );
    expect(result.observations).toEqual([]);
  });

  it('marks structurally invalid search hits as partial instead of negative evidence', async () => {
    const result = await collectPublicRepositoryEvidence({
      fetchImpl: vi.fn().mockResolvedValue(
        response(200, {
          incomplete_results: false,
          total_count: 2,
          items: [
            {
              path: 'package.json',
              html_url: 'https://evil.example/package.json',
              url: 'https://api.github.com/repositories/1/contents/package.json',
              repository: {
                full_name: 'example/app',
                url: 'https://api.github.com/repos/example/app',
              },
            },
            {
              path: 'pnpm-lock.yaml',
              html_url: 'https://github.com/example/app/blob/main/pnpm-lock.yaml',
              url: 'https://api.github.com/repositories/1/contents/pnpm-lock.yaml',
              repository: {
                full_name: 'invalid-repository-slug',
                url: 'https://api.github.com/repos/example/app',
              },
            },
          ],
        }),
      ),
      token: 'public-only-token',
      retrievedAt,
      queries: ['query'],
    });

    expect(result.status.status).toBe('partial');
    expect(result.statuses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'github_public_search_hits',
          status: 'failed',
          reasonCode: 'invalid_payload',
        }),
      ]),
    );
    expect(
      result.statuses.filter(
        ({ source, status, reasonCode }) =>
          source === 'github_public_search_hits' &&
          status === 'failed' &&
          reasonCode === 'invalid_payload',
      ),
    ).toHaveLength(1);
    expect(result.observations).toEqual([]);
  });
});
