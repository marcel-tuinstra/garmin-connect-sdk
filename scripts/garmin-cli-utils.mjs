/* global process */
import { emitKeypressEvents } from 'node:readline';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

import { FileTokenStorage, GarminConnectSDK, GarminMfaRequiredError } from '../dist/index.js';

export function createPrompt() {
  return createInterface({ input, output });
}

export async function createGarminFromCli(rl = createPrompt()) {
  const tokenPath = process.env.GARMIN_TOKEN_PATH ?? './.garmin-tokens';
  const garmin = new GarminConnectSDK({
    storage: new FileTokenStorage(tokenPath),
    timeoutMs: Number(process.env.GARMIN_TIMEOUT_MS ?? 15000),
  });

  const restored = await garmin.restoreSession().catch(() => false);
  if (restored) return { garmin, restoredSession: true };

  const email = process.env.GARMIN_EMAIL ?? (await rl.question('Garmin email: '));
  const password = process.env.GARMIN_PASSWORD ?? (await questionHidden(rl, 'Garmin password: '));

  try {
    await garmin.login({ email, password, mfaCode: process.env.GARMIN_MFA_CODE });
  } catch (error) {
    if (!(error instanceof GarminMfaRequiredError)) throw error;
    const mfaCode = await rl.question('Garmin MFA code: ');
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

async function questionHidden(rl, prompt) {
  if (!input.isTTY) return rl.question(prompt);

  output.write(prompt);
  emitKeypressEvents(input);
  input.setRawMode(true);

  let value = '';
  return new Promise((resolve) => {
    const onKeypress = (character, key) => {
      if (key?.name === 'return') {
        input.setRawMode(false);
        input.off('keypress', onKeypress);
        output.write('\n');
        resolve(value);
        return;
      }

      if (key?.name === 'backspace') {
        value = value.slice(0, -1);
        return;
      }

      if (key?.ctrl && key.name === 'c') {
        input.setRawMode(false);
        input.off('keypress', onKeypress);
        process.kill(process.pid, 'SIGINT');
        return;
      }

      if (character) value += character;
    };

    input.on('keypress', onKeypress);
  });
}
