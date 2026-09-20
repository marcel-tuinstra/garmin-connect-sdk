import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';

import { describe, expect, it } from 'vitest';

const root = new URL('../../', import.meta.url);

describe('adoption measurement operations contract', () => {
  it('runs daily and separates source credentials from publication permission', async () => {
    const workflow = await readFile(
      new URL('.github/workflows/adoption-metrics.yml', root),
      'utf8',
    );

    expect(workflow).toContain("cron: '17 3 * * *'");
    expect(workflow).not.toContain('workflow_dispatch:');
    expect(workflow).toContain('collect-npm:');
    expect(workflow).toContain('collect-traffic:');
    expect(workflow).toContain('collect-adopters:');
    expect(workflow).toContain('collect-voluntary-opt-in:');
    expect(workflow).toContain('publish:');
    expect(workflow).toContain('ADOPTION_TRAFFIC_TOKEN: ${{ secrets.ADOPTION_TRAFFIC_TOKEN }}');
    expect(workflow).toContain('ADOPTION_DISCOVERY_TOKEN: ${{ secrets.ADOPTION_DISCOVERY_TOKEN }}');
    expect(workflow).toContain('ADOPTION_AGGREGATE_TOKEN: ${{ secrets.ADOPTION_AGGREGATE_TOKEN }}');
    expect(workflow).toContain('ADOPTION_AGGREGATE_URL: ${{ vars.ADOPTION_AGGREGATE_URL }}');
    expect(workflow).toContain('contents: write');
    expect(workflow).toContain('cancel-in-progress: false');
    expect(workflow).toContain('environment: adoption-traffic');
    expect(workflow).toContain('environment: adoption-discovery');
    expect(workflow).toContain('environment: adoption-publication');
    expect(workflow).toContain('environment: adoption-opt-in-aggregate');
    expect(workflow.match(/if: always\(\)/g)).toHaveLength(5);
    expect(workflow).toContain('--suppressions staging/suppressions.json');
    expect(workflow).toContain('ref=adoption-metrics');
    expect(workflow).not.toContain("printf '[]");
    expect(workflow).not.toMatch(/uses:\s+[^\n]+@v\d/);
    expect(workflow).not.toContain('pull_request_target');
    expect(workflow).not.toContain('--as-of');
  });

  it('documents distinct metrics, least privilege, retention, recovery, and report links', async () => {
    const operations = await readFile(
      new URL('docs/operations/adoption-measurement.md', root),
      'utf8',
    );
    const readme = await readFile(new URL('README.md', root), 'utf8');

    for (const phrase of [
      'npm downloads',
      'GitHub repository traffic',
      'public repository evidence',
      'voluntary private/unindexed registrations',
      'active installations',
      'ADOPTION_TRAFFIC_TOKEN',
      'ADOPTION_DISCOVERY_TOKEN',
      'ADOPTION_AGGREGATE_TOKEN',
      'Retention',
      'Recovery',
      'adoption-metrics',
      'opt out',
    ]) {
      expect(operations).toContain(phrase);
    }
    expect(operations).toContain(
      'https://github.com/marcel-tuinstra/garmin-connect-sdk/blob/adoption-metrics/docs/adoption/latest.md',
    );
    expect(operations).toContain('pseudonymous');
    expect(operations).not.toMatch(/anonymous/iu);
    expect(operations).toContain('24-hour replay-prevention tombstone');
    expect(operations).toContain('Encrypted operator backups');
    expect(operations).toMatch(/no\s+more than 30 days/u);
    expect(operations).toContain('rounds released counts down to a');
    expect(operations).toContain('cannot be configured below');
    expect(readme).toContain('docs/operations/adoption-measurement.md');
  });

  it('keeps maintainer-only collectors outside the published package', async () => {
    const packageJson = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));

    expect(packageJson.files).not.toContain('tools');
    expect(packageJson.files).not.toContain('data');
    expect(packageJson.files).not.toContain('docs/operations');
  });
});
