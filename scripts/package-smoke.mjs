#!/usr/bin/env node
/* global console, process */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const tempRoot = mkdtempSync(join(tmpdir(), 'garmin-connect-sdk-package-smoke-'));
const packDir = join(tempRoot, 'pack');
const consumerDir = join(tempRoot, 'consumer');

try {
  mkdirSync(packDir);
  mkdirSync(consumerDir);
  writeFileSync(
    join(consumerDir, 'package.json'),
    `${JSON.stringify({ private: true, type: 'module' }, null, 2)}\n`,
  );

  run('pnpm', ['pack', '--pack-destination', packDir], repoRoot);

  const tarball = readdirSync(packDir)
    .filter((file) => file.endsWith('.tgz'))
    .map((file) => join(packDir, file))
    .at(0);

  if (!tarball || !existsSync(tarball)) {
    throw new Error('pnpm pack did not create a package tarball.');
  }

  run('pnpm', ['add', tarball], consumerDir);
  run(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `
        import { existsSync } from 'node:fs';
        const sdk = await import('garmin-connect-sdk');
        const required = [
          'decodeActivityMetricRow',
          'GarminConnectSDK',
          'GarminAuthError',
          'GarminMfaRequiredError',
          'GarminRateLimitError',
          'GarminRequestError',
          'GarminSessionExpiredError',
          'GarminTimeoutError',
          'GarminValidationError',
          'FileTokenStorage',
          'MemoryTokenStorage',
          'normalizeMetricDescriptors',
          'errorFromResponse',
          'parseRetryAfter',
          'summarizeActivityDetails',
          'summarizeActivitySplits',
          'buildWorkoutPayload',
        ];
        for (const name of required) {
          if (!(name in sdk)) throw new Error(\`Missing export: \${name}\`);
        }
        const blocked = ['AuthService', 'HttpClient', 'buildPath'];
        for (const name of blocked) {
          if (name in sdk) throw new Error(\`Unexpected internal export: \${name}\`);
        }
        const garmin = new sdk.GarminConnectSDK();
        for (const name of ['auth', 'http']) {
          if (name in garmin) throw new Error(\`Unexpected public SDK property: \${name}\`);
        }
        const expected = [...required].sort();
        const actual = Object.keys(sdk).sort();
        if (JSON.stringify(actual) !== JSON.stringify(expected)) {
          throw new Error(\`Unexpected public exports: \${actual.join(', ')}\`);
        }
        if (!existsSync('node_modules/garmin-connect-sdk/dist/index.d.ts')) {
          throw new Error('Missing dist/index.d.ts in installed package.');
        }
        const blockedImports = [
          'garmin-connect-sdk/auth/AuthService',
          'garmin-connect-sdk/client/HttpClient',
          'garmin-connect-sdk/dist/index.js',
          'garmin-connect-sdk/src/index.js',
        ];
        for (const specifier of blockedImports) {
          await import(specifier)
            .then(() => {
              throw new Error(\`Unexpected deep import success: \${specifier}\`);
            })
            .catch((error) => {
              if (error?.code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED') throw error;
            });
        }
      `,
    ],
    consumerDir,
  );
  run('pnpm', ['exec', 'garmin-connect', 'help'], consumerDir);

  console.log('Package smoke check passed.');
} finally {
  if (process.env.KEEP_PACKAGE_SMOKE_DIR === '1') {
    console.log(`Kept package smoke directory: ${tempRoot}`);
  } else {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    env: process.env,
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed with exit code ${result.status ?? 'unknown'}.`,
    );
  }
}
