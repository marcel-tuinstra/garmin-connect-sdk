import { describe, expect, it, vi } from 'vitest';

import { combineCollectionResults, collectAdoption } from '../../tools/adoption/collector.mjs';

const now = new Date('2026-09-20T10:00:00.000Z');

describe('adoption collection orchestration', () => {
  it('keeps voluntary registrations as a separate unverified collection source', async () => {
    const voluntaryCollector = vi.fn().mockResolvedValue({
      statuses: [{ source: 'private_opt_in_self_report', status: 'success' }],
      measurements: [
        {
          source: 'private_opt_in_self_report',
          metric: 'active_registrations',
          metricDate: '2026-09-20',
          status: 'observed',
          value: 5,
        },
      ],
    });

    const result = await collectAdoption({
      source: 'voluntary-opt-in',
      now,
      runId: 'run-voluntary',
      aggregateToken: 'aggregate-only',
      aggregateUrl: 'https://adoption.example.test/v1/aggregate',
      voluntaryCollector,
    });

    expect(voluntaryCollector).toHaveBeenCalledWith(
      expect.objectContaining({
        token: 'aggregate-only',
        aggregateUrl: 'https://adoption.example.test/v1/aggregate',
        retrievedAt: now.toISOString(),
      }),
    );
    expect(result).toMatchObject({
      collectionSource: 'voluntary-opt-in',
      runStatus: 'complete',
    });
  });

  it('uses the previous 14 complete UTC days and returns a complete run', async () => {
    const npmCollector = vi.fn().mockResolvedValue({
      statuses: [{ source: 'npm_downloads', status: 'success' }],
      measurements: [{ source: 'npm', metric: 'package_downloads' }],
    });

    const result = await collectAdoption({
      source: 'npm',
      now,
      runId: 'run-1',
      npmCollector,
    });

    expect(npmCollector).toHaveBeenCalledWith(
      expect.objectContaining({ startDate: '2026-09-06', endDate: '2026-09-19' }),
    );
    expect(result).toMatchObject({
      schemaVersion: 1,
      metricDate: '2026-09-20',
      retrievedAt: '2026-09-20T10:00:00.000Z',
      runId: 'run-1',
      runStatus: 'complete',
    });
  });

  it('returns a partial run when a source is rate-limited', async () => {
    const result = await collectAdoption({
      source: 'github-traffic',
      now,
      runId: 'run-2',
      trafficToken: 'token',
      trafficCollector: vi.fn().mockResolvedValue({
        statuses: [
          { source: 'github_traffic_views', status: 'success' },
          { source: 'github_traffic_clones', status: 'rate_limited' },
        ],
        measurements: [],
      }),
    });

    expect(result.runStatus).toBe('partial');
    expect(result.sourceStatuses[1].status).toBe('rate_limited');
  });

  it.each(['rate_limited', 'delayed'])(
    'returns a failed run when every source is %s',
    async (status) => {
      const result = await collectAdoption({
        source: 'github-traffic',
        now,
        runId: `run-all-${status}`,
        trafficToken: 'token',
        trafficCollector: vi.fn().mockResolvedValue({
          statuses: [
            { source: 'github_traffic_views', status },
            { source: 'github_traffic_clones', status },
          ],
          measurements: [],
        }),
      });

      expect(result.runStatus).toBe('failed');
    },
  );

  it('excludes the SDK repository itself from public adopter evidence', async () => {
    const adopterCollector = vi.fn().mockResolvedValue({
      statuses: [{ source: 'github_public_search', status: 'success' }],
      observations: [],
    });

    await collectAdoption({
      source: 'github-adopters',
      now,
      runId: 'run-self-exclusion',
      discoveryToken: 'token',
      adopterCollector,
    });

    expect(adopterCollector).toHaveBeenCalledWith(
      expect.objectContaining({
        excludeRepositories: ['marcel-tuinstra/garmin-connect-sdk'],
      }),
    );
  });

  it('applies repository suppressions before an adopter artifact is created', async () => {
    const adopterCollector = vi.fn().mockResolvedValue({
      statuses: [{ source: 'github_public_search', status: 'success' }],
      observations: [],
    });

    await collectAdoption({
      source: 'github-adopters',
      now,
      runId: 'run-suppressed',
      discoveryToken: 'token',
      suppressions: ['example/app'],
      adopterCollector,
    });

    expect(adopterCollector).toHaveBeenCalledWith(
      expect.objectContaining({
        excludeRepositories: ['marcel-tuinstra/garmin-connect-sdk', 'example/app'],
      }),
    );
  });

  it('combines independently collected sources without duplicating evidence', () => {
    const partial = {
      schemaVersion: 1,
      metricDate: '2026-09-20',
      retrievedAt: '2026-09-20T10:00:00.000Z',
      runId: 'run-3',
      runStatus: 'complete',
      sourceStatuses: [{ source: 'npm_downloads', status: 'success' }],
      measurements: [
        {
          source: 'npm',
          metric: 'package_downloads',
          metricDate: '2026-09-19',
          dimension: null,
          status: 'observed',
          value: 4,
        },
      ],
      adopterObservations: [],
    };
    const combined = combineCollectionResults([partial, partial]);

    expect(combined.sourceStatuses).toHaveLength(1);
    expect(combined.measurements).toHaveLength(1);
    expect(combined.runStatus).toBe('complete');
  });

  it('rejects mixed dates rather than corrupting a snapshot', () => {
    expect(() =>
      combineCollectionResults([
        {
          schemaVersion: 1,
          metricDate: '2026-09-20',
          retrievedAt: now.toISOString(),
          runId: 'a',
          sourceStatuses: [],
          measurements: [],
          adopterObservations: [],
        },
        {
          schemaVersion: 1,
          metricDate: '2026-09-19',
          retrievedAt: now.toISOString(),
          runId: 'b',
          sourceStatuses: [],
          measurements: [],
          adopterObservations: [],
        },
      ]),
    ).toThrow('same metric date');
  });
});
