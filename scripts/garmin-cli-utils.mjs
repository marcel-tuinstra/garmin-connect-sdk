/* global process */
import { stdin as input, stdout as output } from 'node:process';

import { FileTokenStorage, GarminConnectSDK, GarminMfaRequiredError } from '../dist/index.js';
import { createPrompt, questionHidden } from './garmin-prompt-utils.mjs';

export { createPrompt } from './garmin-prompt-utils.mjs';

export async function createGarminFromCli(rl = createPrompt()) {
  const tokenPath = process.env.GARMIN_TOKEN_PATH ?? './.garmin-tokens';
  const garmin = new GarminConnectSDK({
    storage: new FileTokenStorage(tokenPath),
    timeoutMs: Number(process.env.GARMIN_TIMEOUT_MS ?? 15000),
  });

  const restored = await garmin.restoreSession().catch(() => false);
  if (restored) return { garmin, restoredSession: true };

  const email = process.env.GARMIN_EMAIL ?? (await rl.question('Garmin email: '));
  const passwordFromPrompt = !process.env.GARMIN_PASSWORD;
  const password = process.env.GARMIN_PASSWORD ?? (await questionHidden(rl, 'Garmin password: '));

  try {
    await garmin.login({ email, password, mfaCode: process.env.GARMIN_MFA_CODE });
  } catch (error) {
    if (!(error instanceof GarminMfaRequiredError)) throw error;
    const mfaPrompt = passwordFromPrompt && input.isTTY ? createPrompt() : rl;
    let mfaCode;
    try {
      mfaCode = await mfaPrompt.question('Garmin MFA code: ');
    } finally {
      if (mfaPrompt !== rl) mfaPrompt.close();
    }
    await garmin.login({ email, password, mfaCode });
  }

  return { garmin, restoredSession: false };
}

export function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

export function writeJson(value) {
  output.write(`${JSON.stringify(value, null, 2)}\n`);
}

export function parseArgs(argv) {
  const normalized = argv[0] === '--' ? argv.slice(1) : argv;
  const [command = 'help', ...rest] = normalized;
  const flags = {};

  for (let index = 0; index < rest.length; index += 1) {
    const value = rest[index];
    if (!value?.startsWith('--')) continue;

    const key = value.slice(2);
    const next = rest[index + 1];
    if (!next || next.startsWith('--')) {
      flags[key] = true;
    } else {
      flags[key] = next;
      index += 1;
    }
  }

  return { command, flags };
}

export function numberFlag(flags, key, fallback) {
  const value = flags[key];
  if (typeof value !== 'string') return fallback;

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
