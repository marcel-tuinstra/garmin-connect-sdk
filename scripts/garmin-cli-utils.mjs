/* global process */
import { spawnSync } from 'node:child_process';
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

export async function questionHidden(rl, prompt, streams = { input, output }) {
  const promptInput = streams.input ?? input;
  const promptOutput = streams.output ?? output;
  const killProcess = streams.killProcess ?? process.kill;
  const setTerminalEcho = streams.setTerminalEcho ?? setInputEcho;

  if (!promptInput.isTTY) {
    return rl.question(prompt);
  }

  rl.close?.();

  return new Promise((resolve) => {
    const echoChanged = setTerminalEcho(promptInput, false);
    let restoredEcho = false;
    const restoreEcho = () => {
      if (!echoChanged || restoredEcho) return;
      setTerminalEcho(promptInput, true);
      restoredEcho = true;
    };

    const cleanup = () => {
      promptInput.off('data', onData);
      process.off('SIGINT', onSigint);
      restoreEcho();
      promptInput.pause?.();
      promptOutput.write('\n');
    };

    const onSigint = () => {
      cleanup();
      killProcess(process.pid, 'SIGINT');
    };

    const onData = (chunk) => {
      cleanup();
      resolve(chunk.toString('utf8').replace(/[\r\n]+$/, ''));
    };

    process.once('SIGINT', onSigint);
    promptInput.once('data', onData);
    promptInput.resume?.();
    promptOutput.write(prompt);
  });
}

function setInputEcho(promptInput, enabled) {
  const inputStdio = promptInput === input ? 'inherit' : promptInput.fd;
  if (inputStdio !== 'inherit' && typeof inputStdio !== 'number') return false;

  const result = spawnSync('stty', [enabled ? 'echo' : '-echo'], {
    stdio: [inputStdio, 'ignore', 'ignore'],
  });

  return result.status === 0;
}
