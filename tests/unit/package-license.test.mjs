import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { verifyPackedLicense } from '../../scripts/package-license.mjs';

const APACHE_TEXT = 'Apache License\nVersion 2.0\n';
const policy = {
  expectedLicense: 'Apache-2.0',
  expectedText: APACHE_TEXT,
  expectedVersion: '2.0.0',
};

const roots = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('verifyPackedLicense', () => {
  it('accepts matching SPDX metadata and normalized trusted license text', async () => {
    const packageRoot = createPackage({ licenseText: APACHE_TEXT.replaceAll('\n', '\r\n') });

    await expect(verifyPackedLicense({ packageRoot, policy })).resolves.toBe(true);
  });

  it('requires trusted text from the policy or a reference root', async () => {
    const packageRoot = createPackage();

    await expect(
      verifyPackedLicense({ packageRoot, policy: { expectedLicense: 'Apache-2.0' } }),
    ).rejects.toThrow('expectedText or referenceRoot');
  });

  it('fails closed when a trusted source path and policy text disagree', async () => {
    const packageRoot = createPackage();
    const sourceLicensePath = join(packageRoot, 'trusted-LICENSE');
    writeFileSync(sourceLicensePath, 'Different trusted license text\n');

    await expect(verifyPackedLicense({ packageRoot, sourceLicensePath, policy })).rejects.toThrow(
      'Trusted license text expectations conflict',
    );
  });

  it.each([
    ['SPDX identity', { expectedLicense: 'BSD-3-Clause' }],
    ['version', { expectedVersion: '1.0.0' }],
  ])(
    'fails closed when a policy and reference root disagree on %s',
    async (_kind, conflictingPolicy) => {
      const packageRoot = createPackage();
      const referenceRoot = createPackage();

      await expect(
        verifyPackedLicense({
          packageRoot,
          referenceRoot,
          policy: { ...policy, ...conflictingPolicy },
        }),
      ).rejects.toThrow('expectations conflict');
    },
  );

  it.each([
    ['missing', null],
    ['truncated', 'Apache License\n'],
    ['mismatched', 'BSD 3-Clause License\n'],
  ])('rejects %s packed license text', async (_kind, licenseText) => {
    const packageRoot = createPackage({ licenseText });

    await expect(verifyPackedLicense({ packageRoot, policy })).rejects.toThrow('LICENSE');
  });

  it('rejects a stale current MIT presentation for a non-MIT policy', async () => {
    const packageRoot = createPackage({
      readme: '[License](https://img.shields.io/badge/license-MIT-blue.svg)',
    });

    await expect(verifyPackedLicense({ packageRoot, policy })).rejects.toThrow(
      'current MIT presentation',
    );
  });

  it.each([
    'This package is licensed under MIT.',
    'This package is MIT-licensed.',
    'Previously it used another license, but now it is licensed under MIT.',
    'Previously MIT-licensed; now licensed under MIT.',
    'License: [MIT](LICENSE)',
    'License: **MIT**',
  ])('rejects a current MIT claim even when the line also mentions history', async (readme) => {
    const packageRoot = createPackage({ readme });

    await expect(verifyPackedLicense({ packageRoot, policy })).rejects.toThrow(
      'current MIT presentation',
    );
  });

  it('allows an explicitly historical MIT mention for a non-MIT policy', async () => {
    const packageRoot = createPackage({
      readme: 'A release was historically distributed under the MIT License.',
    });

    await expect(verifyPackedLicense({ packageRoot, policy })).resolves.toBe(true);
  });

  it('allows a MIT presentation confined to an earlier changelog release', async () => {
    const packageRoot = createPackage({
      version: '2.0.0',
      changelog:
        '# Changelog\n\n## 2.0.0 - 2026-07-18\nNew terms.\n\n## 1.0.0 - 2026-07-17\nLicensed under MIT.\n',
    });
    const policyForVersion = { ...policy, expectedVersion: '2.0.0' };

    await expect(verifyPackedLicense({ packageRoot, policy: policyForVersion })).resolves.toBe(
      true,
    );
  });

  it('rejects a package version that differs from the policy identity', async () => {
    const packageRoot = createPackage({ version: '1.9.0' });

    await expect(verifyPackedLicense({ packageRoot, policy })).rejects.toThrow('version');
  });

  it('does not carry historical changelog context into an unreleased section', async () => {
    const packageRoot = createPackage({
      changelog:
        '## 1.0.0 - 2026-07-17\nLicensed under MIT.\n\n## Unreleased\nLicensed under MIT.\n',
    });

    await expect(verifyPackedLicense({ packageRoot, policy })).rejects.toThrow(
      'current MIT presentation',
    );
  });
});

function createPackage({ licenseText = APACHE_TEXT, readme, changelog, version = '2.0.0' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'garmin-connect-sdk-license-test-'));
  roots.push(root);
  mkdirSync(root, { recursive: true });
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ name: 'fixture', version, license: 'Apache-2.0' }),
  );
  if (licenseText !== null) writeFileSync(join(root, 'LICENSE'), licenseText);
  if (readme !== undefined) writeFileSync(join(root, 'README.md'), readme);
  if (changelog !== undefined) writeFileSync(join(root, 'CHANGELOG.md'), changelog);
  return root;
}
