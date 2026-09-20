import { describe, expect, it } from 'vitest';

import { renderAdoptionReport } from '../../tools/adoption/report.mjs';

describe('adoption report', () => {
  it('keeps downloads, traffic, public evidence, and active installations separate', () => {
    const report = renderAdoptionReport({
      schemaVersion: 1,
      metricDate: '2026-09-20',
      retrievals: [
        {
          runId: 'run-1',
          retrievedAt: '2026-09-20T10:00:00.000Z',
          sourceStatuses: [{ source: 'npm_downloads', status: 'success' }],
        },
      ],
      measurements: [
        {
          source: 'npm',
          metric: 'package_downloads',
          metricDate: '2026-09-19',
          dimension: null,
          status: 'observed',
          value: 12,
          unit: 'downloads',
        },
        {
          source: 'github',
          metric: 'unique_viewers',
          metricDate: '2026-09-19',
          dimension: null,
          status: 'missing',
          value: null,
          unit: 'views',
        },
      ],
      adopters: [
        {
          repositoryKey: 'example/app',
          repositoryUrl: 'https://github.com/example/app',
          repositoryState: 'active',
          declaredVersionRange: '^1.1.0',
          resolvedVersion: '1.1.1',
          evidenceTypes: ['dependency_declaration', 'sdk_import'],
          confidence: 'medium',
          countsAsAdopter: true,
        },
      ],
    });

    expect(report).toContain('## npm downloads');
    expect(report).toContain('## GitHub repository traffic');
    expect(report).toContain('## Public repository evidence');
    expect(report).toContain('Active installations: not measured');
    expect(report).toContain('| 2026-09-19 | 12 | observed |');
    expect(report).toContain('| unique\\_viewers | 2026-09-19 | — | missing |');
    expect(report).not.toMatch(/unique users/i);
  });

  it('escapes untrusted Markdown and spreadsheet-formula prefixes', () => {
    const report = renderAdoptionReport({
      schemaVersion: 1,
      metricDate: '2026-09-20',
      retrievals: [],
      measurements: [],
      adopters: [
        {
          repositoryKey: 'example/app',
          repositoryUrl: 'https://github.com/example/app',
          repositoryState: 'active|spoof',
          declaredVersionRange:
            '=HYPERLINK("https://evil.example")<script>![pixel](https://evil.example)',
          resolvedVersion: null,
          evidenceTypes: ['sdk_import'],
          confidence: 'low',
          countsAsAdopter: false,
        },
      ],
    });

    expect(report).toContain("'=HYPERLINK");
    expect(report).toContain('&lt;script&gt;');
    expect(report).not.toContain('<script>');
    expect(report).not.toContain('![pixel](');
    expect(report).toContain('active\\|spoof');
    expect(report).not.toContain('| active|spoof |');
  });
});
