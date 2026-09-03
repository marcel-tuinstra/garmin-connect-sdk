import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { verifyPackedLicense } from '../../scripts/package-license.mjs';

const MIT_LICENSE = `MIT License

Copyright (c) 2026 Synthetic Author

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;

const fixtureRoots = new Set();

afterEach(async () => {
  await Promise.all([...fixtureRoots].map((root) => rm(root, { recursive: true, force: true })));
  fixtureRoots.clear();
});

describe('packed license verification', () => {
  it('accepts a matching source license, package SPDX, and packed artifact', async () => {
    const fixture = await packageFixture({ licenseText: MIT_LICENSE });

    await expect(verify(fixture)).resolves.toBeTruthy();
  });

  it.each([
    ['missing', { licenseText: MIT_LICENSE, omitArtifact: true }],
    ['empty', { licenseText: MIT_LICENSE, artifactLicenseText: '' }],
    [
      'truncated',
      {
        licenseText: MIT_LICENSE,
        artifactLicenseText: 'MIT License\n\nCopyright (c) 2026 Synthetic Author\n',
      },
    ],
  ])('rejects a %s packed LICENSE file', async (_name, fixtureOptions) => {
    const fixture = await packageFixture(fixtureOptions);

    await expect(verify(fixture)).rejects.toThrow(/license/i);
  });

  it('rejects a package SPDX mismatch even when license text matches', async () => {
    const fixture = await packageFixture({
      licenseText: MIT_LICENSE,
      packageLicense: 'Apache-2.0',
      expectedLicense: 'MIT',
    });

    await expect(verify(fixture)).rejects.toThrow(/license|SPDX|mismatch/i);
  });

  it('permits CRLF-normalized license text', async () => {
    const fixture = await packageFixture({
      sourceLicenseText: MIT_LICENSE,
      artifactLicenseText: MIT_LICENSE.replaceAll('\n', '\r\n'),
    });

    await expect(verify(fixture)).resolves.toBeTruthy();
  });

  it('rejects a stale current MIT badge when the current package license is Apache', async () => {
    const fixture = await packageFixture({
      licenseText: 'Apache License 2.0\n',
      packageLicense: 'Apache-2.0',
      expectedLicense: 'Apache-2.0',
      readme: '[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)]',
    });

    await expect(verify(fixture)).rejects.toThrow(/MIT|claim|badge|license/i);
  });

  it('allows an explicitly historical MIT release mention while validating the current Apache license', async () => {
    const fixture = await packageFixture({
      licenseText: 'Apache License 2.0\n',
      packageLicense: 'Apache-2.0',
      expectedLicense: 'Apache-2.0',
      readme: 'Release 0.9.0 was historically distributed under the MIT License.\n',
      version: '1.0.0',
    });

    await expect(verify(fixture)).resolves.toBeTruthy();
  });
});

async function packageFixture({
  licenseText,
  sourceLicenseText = licenseText,
  artifactLicenseText = licenseText,
  omitArtifact = false,
  packageLicense = 'MIT',
  expectedLicense = packageLicense,
  readme = 'Current license: MIT\n',
  version = '1.0.0',
}) {
  const workspace = await mkdtemp(join(tmpdir(), 'gcs-package-license-'));
  fixtureRoots.add(workspace);
  const packageRoot = join(workspace, 'package');
  await mkdir(packageRoot);
  if (sourceLicenseText !== undefined) {
    await writeFile(join(workspace, 'LICENSE'), sourceLicenseText, 'utf8');
  }
  if (!omitArtifact && artifactLicenseText !== undefined) {
    await writeFile(join(packageRoot, 'LICENSE'), artifactLicenseText, 'utf8');
  }
  await writeFile(join(packageRoot, 'README.md'), readme, 'utf8');
  await writeFile(
    join(packageRoot, 'package.json'),
    JSON.stringify({ name: 'synthetic-package', version, license: packageLicense }),
    'utf8',
  );
  return {
    packageRoot,
    sourceLicensePath: join(workspace, 'LICENSE'),
    expectedLicense,
    expectedText: sourceLicenseText,
    version,
  };
}

function verify(fixture) {
  return verifyPackedLicense({
    packageRoot: fixture.packageRoot,
    sourceLicensePath: fixture.sourceLicensePath,
    policy: {
      expectedLicense: fixture.expectedLicense,
      expectedText: fixture.expectedText,
      expectedVersion: fixture.version,
    },
  });
}
