#!/usr/bin/env node
/* global console, process */
import { createInterface } from 'node:readline/promises';

import { runAdoptionCommand } from './garmin-adoption-utils.mjs';

const terminal = createInterface({ input: process.stdin, output: process.stdout });

try {
  process.exitCode = await runAdoptionCommand({
    args: process.argv.slice(2),
    confirm: async (question) => {
      const answer = await terminal.question(question);
      return answer.trim().toLowerCase() === 'y' || answer.trim().toLowerCase() === 'yes';
    },
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Adoption command failed.');
  process.exitCode = 1;
} finally {
  terminal.close();
}
