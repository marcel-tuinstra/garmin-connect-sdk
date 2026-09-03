import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { verifyPackedLicense } from '../../scripts/package-license.mjs';

const REPOSITORY_ROOT = resolve(import.meta.dirname, '../..');
const PACKAGE_JSON_PATH = join(REPOSITORY_ROOT, 'package.json');
const LICENSE_PATH = join(REPOSITORY_ROOT, 'LICENSE');
const EXPECTED_SPDX = 'PolyForm-Noncommercial-1.0.0';
const EXPECTED_VERSION = '1.1.0';
const REQUIRED_NOTICE = 'Required Notice: Copyright (c) 2026 Marcel Tuinstra\n\n';
// Official plain-text terms, retrieved from the licensor on 2026-09-03:
// https://polyformproject.org/licenses/noncommercial/1.0.0.txt
const OFFICIAL_LICENSE_SHA256 = 'ffcca38841adb694b6f380647e15f17c446a4d1656fed51a1e2041d064c94cc8';

const fixtureRoots = [];

afterEach(() => {
  for (const root of fixtureRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('GCS-13 repository license policy', () => {
  it('declares the PolyForm SPDX identity for the 1.1.0 release boundary', () => {
    const packageJson = readJson(PACKAGE_JSON_PATH);

    expect(packageJson.license).toBe(EXPECTED_SPDX);
    expect(packageJson.version).toBe(EXPECTED_VERSION);
  });

  it('keeps the required notice separate from the unmodified official plain-text terms', () => {
    const license = readFileSync(LICENSE_PATH, 'utf8').replace(/\r\n?/g, '\n');

    expect(license.startsWith(REQUIRED_NOTICE)).toBe(true);
    const officialText = license.slice(REQUIRED_NOTICE.length);
    expect(sha256Normalized(officialText)).toBe(OFFICIAL_LICENSE_SHA256);
    expect(officialText).toContain('# PolyForm Noncommercial License 1.0.0\n');
    expect(officialText).toContain('<https://polyformproject.org/licenses/noncommercial/1.0.0>');
    expect(officialText).toContain('## Notices\n');
    expect(officialText).toContain('## Noncommercial Purposes\n');
  });

  it('verifies the repository source package with the license checker', async () => {
    const licenseText = readFileSync(LICENSE_PATH, 'utf8');
    const packageJson = readJson(PACKAGE_JSON_PATH);

    await expect(
      verifyPackedLicense({
        packageRoot: REPOSITORY_ROOT,
        sourceLicensePath: LICENSE_PATH,
        policy: {
          expectedLicense: EXPECTED_SPDX,
          expectedText: licenseText,
          expectedVersion: packageJson.version,
        },
      }),
    ).resolves.toBe(true);
  });

  it('documents the 1.1.0 boundary and links consumers to the terms', () => {
    const readme = readFileSync(join(REPOSITORY_ROOT, 'README.md'), 'utf8');
    const usage = readFileSync(join(REPOSITORY_ROOT, 'docs/usage.md'), 'utf8');
    const contributing = readFileSync(join(REPOSITORY_ROOT, 'CONTRIBUTING.md'), 'utf8');

    expect(readme).toMatch(/Starting with version\s+`1\.1\.0`[\s\S]{0,300}PolyForm Noncommercial/);
    expect(readme).toMatch(/Previously published releases through\s+`1\.0\.0`[\s\S]{0,200}\bMIT\b/);
    expect(readme).toContain('](./LICENSE)');
    expect(usage).toContain('](../LICENSE)');
    expect(contributing).toContain('](./LICENSE)');
  });

  it('rejects a current MIT presentation in a 1.1.0 package fixture', async () => {
    const fixture = createFixture({ readme: 'Current license: MIT\n' });
    const licenseText = readFileSync(LICENSE_PATH, 'utf8');

    await expect(verify(fixture, licenseText)).rejects.toThrow('current MIT presentation');
  });

  it('rejects a package with matching terms but the wrong SPDX identifier', async () => {
    const fixture = createFixture({ packageLicense: 'MIT' });
    const licenseText = readFileSync(LICENSE_PATH, 'utf8');

    await expect(verify(fixture, licenseText)).rejects.toThrow('SPDX identifier');
  });

  it('rejects a tampered canonical license body', async () => {
    const canonical = readFileSync(LICENSE_PATH, 'utf8');
    const fixture = createFixture({ licenseText: `${canonical}Tampered\n` });

    await expect(verify(fixture, canonical)).rejects.toThrow('trusted license text');
  });

  it('rejects a package that omits the author notice but retains the official terms', async () => {
    const canonical = readFileSync(LICENSE_PATH, 'utf8');
    const fixture = createFixture({
      licenseText: canonical.replace(/^Required Notice:.*\r?\n\r?\n/, ''),
    });

    await expect(verify(fixture, canonical)).rejects.toThrow('trusted license text');
  });

  it('rejects a package with new terms but the old published version identity', async () => {
    const canonical = readFileSync(LICENSE_PATH, 'utf8');
    const fixture = createFixture({ version: '1.0.0' });

    await expect(verify(fixture, canonical)).rejects.toThrow('expected package identity');
  });
});

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function sha256Normalized(text) {
  return createHash('sha256').update(text.replace(/\r\n?/g, '\n')).digest('hex');
}

function createFixture({
  licenseText = readFileSync(LICENSE_PATH, 'utf8'),
  packageLicense = EXPECTED_SPDX,
  readme = 'Current license: PolyForm Noncommercial License 1.0.0\n',
  version = EXPECTED_VERSION,
} = {}) {
  const root = mkdtempSync(join(tmpdir(), 'garmin-connect-sdk-license-policy-'));
  fixtureRoots.push(root);
  writeFileSync(join(root, 'LICENSE'), licenseText);
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ name: 'fixture', version, license: packageLicense }),
  );
  writeFileSync(join(root, 'README.md'), readme);
  return root;
}

function verify(packageRoot, expectedText) {
  return verifyPackedLicense({
    packageRoot,
    sourceLicensePath: LICENSE_PATH,
    policy: {
      expectedLicense: EXPECTED_SPDX,
      expectedText,
      expectedVersion: EXPECTED_VERSION,
    },
  });
}
