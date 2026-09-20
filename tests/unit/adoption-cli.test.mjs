import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { main } from '../../tools/adoption/cli.mjs';

describe('adoption metrics CLI', () => {
  it('writes a sanitized failed collection when a collector crashes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'gcs-adoption-cli-'));
    const output = join(directory, 'failed.json');

    await expect(
      main(['collect', '--source', 'unexpected-source', '--output', output, '--run-id', 'run-1']),
    ).rejects.toThrow('Unsupported adoption source');

    expect(JSON.parse(await readFile(output, 'utf8'))).toMatchObject({
      runId: 'run-1',
      runStatus: 'failed',
      sourceStatuses: [{ status: 'failed', reasonCode: 'collector_error' }],
      measurements: [],
      adopterObservations: [],
    });
    expect(await readFile(output, 'utf8')).not.toContain('Unsupported adoption source');
  });
});
