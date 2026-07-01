/* global process */
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

export function createPrompt() {
  return createInterface({ input, output });
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
