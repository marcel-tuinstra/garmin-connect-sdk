import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '../..');
const WORKFLOW = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8');
const PACKAGE_JSON = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const DEVOPS_DOCS = readFileSync(join(ROOT, 'docs/operations/devops-gate-baseline.md'), 'utf8');

const CHECKOUT_SHA = '11d5960a326750d5838078e36cf38b85af677262';
const SETUP_NODE_SHA = '49933ea5288caeca8642d1e84afbd3f7d6820020';

describe('GCS-10 CI supply-chain policy', () => {
  it('pins reviewed GitHub actions immutably with their release tags documented', () => {
    expect(WORKFLOW).toContain(`uses: actions/checkout@${CHECKOUT_SHA} # v4.4.0`);
    expect(WORKFLOW).toContain(`uses: actions/setup-node@${SETUP_NODE_SHA} # v4.4.0`);

    const actionReferences = [...WORKFLOW.matchAll(/^\s*uses:\s*([^\s#]+)/gmu)].map(
      ([, reference]) => reference,
    );
    expect(actionReferences).not.toHaveLength(0);
    expect(actionReferences.every((reference) => /@[0-9a-f]{40}$/u.test(reference))).toBe(true);
  });

  it('keeps checkout credentials ephemeral and workflow permissions read-only', () => {
    expect(WORKFLOW).toMatch(
      new RegExp(
        `uses: actions/checkout@${CHECKOUT_SHA}[^\\n]*\\n\\s+with:\\n\\s+persist-credentials: false`,
        'u',
      ),
    );
    expect(WORKFLOW).toMatch(/permissions:\n\s+contents: read/u);
    expect(WORKFLOW).not.toMatch(/(?:write-all|contents:\s*write|pull-requests:\s*write)/u);
  });

  it('blocks high and critical dependency vulnerabilities through the committed lockfile', () => {
    expect(PACKAGE_JSON.scripts['audit:dependencies']).toBe('pnpm audit --audit-level high');
    expect(WORKFLOW).toContain('run: pnpm audit:dependencies');
    expect(DEVOPS_DOCS).toMatch(/blocking threshold[^\n]*`high`/iu);
    expect(DEVOPS_DOCS).toMatch(/committed\s+`pnpm-lock\.yaml`/iu);
  });

  it('retains every normal package verification gate', () => {
    for (const command of [
      'pnpm typecheck',
      'pnpm lint',
      'pnpm test',
      'pnpm coverage',
      'pnpm build',
      'pnpm package:smoke',
    ]) {
      expect(WORKFLOW).toContain(`run: ${command}`);
    }
  });
});
