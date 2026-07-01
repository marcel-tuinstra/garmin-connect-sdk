import { Buffer } from 'node:buffer';
import { EventEmitter } from 'node:events';

import { describe, expect, it, vi } from 'vitest';

import { questionHidden } from '../../scripts/garmin-prompt-utils.mjs';

class FakeInput extends EventEmitter {
  constructor({ isTTY = true } = {}) {
    super();
    this.isTTY = isTTY;
    this.resume = vi.fn();
  }
}

function createOutput() {
  const chunks = [];
  return {
    chunks,
    write: vi.fn((chunk) => {
      chunks.push(String(chunk));
      return true;
    }),
  };
}

describe('CLI prompt utilities', () => {
  it('does not echo hidden TTY input to the output stream', async () => {
    const input = new FakeInput();
    const output = createOutput();
    const rl = {
      close: vi.fn(),
      question: vi.fn(),
    };
    const setTerminalEcho = vi.fn().mockReturnValue(true);

    const answer = questionHidden(rl, 'Garmin password: ', {
      input,
      output,
      killProcess: vi.fn(),
      setTerminalEcho,
    });

    input.emit('data', Buffer.from('secret\n'));

    await expect(answer).resolves.toBe('secret');
    expect(rl.close).toHaveBeenCalledTimes(1);
    expect(rl.question).not.toHaveBeenCalled();
    expect(output.chunks.join('')).toBe('Garmin password: \n');
    expect(output.chunks.join('')).not.toContain('secret');
    expect(setTerminalEcho).toHaveBeenNthCalledWith(1, input, false);
    expect(setTerminalEcho).toHaveBeenLastCalledWith(input, true);
  });

  it('does not attempt to restore TTY echo when disabling echo fails', async () => {
    const input = new FakeInput();
    const output = createOutput();
    const rl = {
      close: vi.fn(),
      question: vi.fn(),
    };
    const setTerminalEcho = vi.fn().mockReturnValue(false);

    const answer = questionHidden(rl, 'Garmin password: ', {
      input,
      output,
      setTerminalEcho,
    });

    input.emit('data', Buffer.from('secret\n'));

    await expect(answer).resolves.toBe('secret');

    expect(setTerminalEcho).toHaveBeenCalledTimes(1);
    expect(setTerminalEcho).toHaveBeenCalledWith(input, false);
  });

  it('uses readline question for non-TTY input', async () => {
    const input = new FakeInput({ isTTY: false });
    const output = createOutput();
    const rl = {
      question: vi.fn().mockResolvedValue('piped-secret'),
    };

    await expect(questionHidden(rl, 'Garmin password: ', { input, output })).resolves.toBe(
      'piped-secret',
    );

    expect(rl.question).toHaveBeenCalledWith('Garmin password: ');
    expect(output.write).not.toHaveBeenCalled();
  });
});
