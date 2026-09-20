#!/usr/bin/env node
/* global console, process */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { collectAdoption } from './collector.mjs';
import { publishCollection } from './publication.mjs';

const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`Adoption metrics failed: ${safeError(error)}`);
    process.exitCode = 1;
  });
}

export async function main(args) {
  const [command, ...rest] = args;
  const options = parseOptions(rest);

  if (command === 'collect') {
    const source = required(options, 'source');
    const output = required(options, 'output');
    const runId = required(options, 'run-id');
    let result;
    try {
      result = await collectAdoption({
        source,
        runId,
        trafficToken: process.env.ADOPTION_TRAFFIC_TOKEN ?? '',
        discoveryToken: process.env.ADOPTION_DISCOVERY_TOKEN ?? '',
        aggregateToken: process.env.ADOPTION_AGGREGATE_TOKEN ?? '',
        aggregateUrl: process.env.ADOPTION_AGGREGATE_URL ?? '',
        suppressions: await readSuppressions(options.get('suppressions')),
      });
    } catch (error) {
      await writeCollection(output, failedCollection(source, runId));
      throw error;
    }
    await writeCollection(output, result);
    console.log(
      `Collected ${source}: ${result.runStatus}; ${result.measurements.length} measurements.`,
    );
    return result;
  }

  if (command === 'publish') {
    const result = await publishCollection({
      inputDir: required(options, 'input-dir'),
      dataDir: required(options, 'data-dir'),
      reportDir: required(options, 'report-dir'),
    });
    console.log(
      `Published ${result.metricDate}: ${result.runStatus}; ${result.measurementCount} measurements; ${result.adopterCount} public repositories.`,
    );
    return result;
  }

  throw new Error('Usage: cli.mjs collect|publish [options]');
}

async function readSuppressions(path) {
  if (!path) return [];
  const value = JSON.parse(await readFile(path, 'utf8'));
  if (
    !Array.isArray(value) ||
    value.some(
      (repository) =>
        typeof repository !== 'string' ||
        !/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(repository),
    )
  ) {
    throw new Error('Invalid repository suppression list.');
  }
  return value.map((repository) => repository.toLowerCase());
}

async function writeCollection(output, result) {
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
}

function failedCollection(source, runId) {
  const retrievedAt = new Date().toISOString();
  return {
    schemaVersion: 1,
    collectionSource: source,
    metricDate: retrievedAt.slice(0, 10),
    retrievedAt,
    runId,
    runStatus: 'failed',
    sourceStatuses: [
      {
        source: sourceStatusName(source),
        status: 'failed',
        reasonCode: 'collector_error',
      },
    ],
    measurements: [],
    adopterObservations: [],
  };
}

function sourceStatusName(source) {
  if (source === 'npm') return 'npm_collection';
  if (source === 'github-traffic') return 'github_traffic';
  if (source === 'github-adopters') return 'github_public_search';
  if (source === 'voluntary-opt-in') return 'private_opt_in_self_report';
  return 'unknown_collection';
}

function parseOptions(args) {
  const options = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith('--') || value === undefined || value.startsWith('--')) {
      throw new Error('Options must use --name value pairs.');
    }
    options.set(key.slice(2), value);
  }
  return options;
}

function required(options, name) {
  const value = options.get(name);
  if (!value) throw new Error(`Missing --${name}.`);
  return value;
}

function safeError(error) {
  const code = typeof error?.code === 'string' ? ` (${error.code})` : '';
  const message =
    typeof error?.message === 'string' ? error.message.slice(0, 300) : 'unknown error';
  return [...`${message}${code}`]
    .map((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint < 32 || codePoint === 127 ? ' ' : character;
    })
    .join('');
}
