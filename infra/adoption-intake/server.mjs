#!/usr/bin/env node
/* global console, process */
import { mkdirSync, readFileSync } from 'node:fs';
import { Buffer } from 'node:buffer';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { createAdoptionIntake } from './handler.mjs';
import { createSqliteRegistrationStore } from './sqlite-store.mjs';

const port = integerEnvironment('PORT', 8787);
const host = process.env.HOST ?? '127.0.0.1';
const databasePath = resolve(process.env.ADOPTION_DB_PATH ?? './data/adoption-intake.sqlite');
mkdirSync(dirname(databasePath), { recursive: true, mode: 0o700 });
const database = new DatabaseSync(databasePath);
database.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;');

const handler = createAdoptionIntake({
  store: createSqliteRegistrationStore(database),
  secret: requiredSecret('ADOPTION_REGISTRATION_PEPPER'),
  aggregateToken: requiredSecret('ADOPTION_AGGREGATE_TOKEN'),
  aggregateThreshold: integerEnvironment('ADOPTION_AGGREGATE_THRESHOLD', 5),
  rateLimit: integerEnvironment('ADOPTION_RATE_LIMIT_PER_HOUR', 30),
});

const server = createServer(async (incoming, outgoing) => {
  try {
    if (incoming.url === '/health' && ['GET', 'HEAD'].includes(incoming.method ?? '')) {
      outgoing.writeHead(204, { 'cache-control': 'no-store' });
      outgoing.end();
      return;
    }
    const body = await readBody(incoming, 4096);
    const headers = new globalThis.Headers();
    for (const [name, value] of Object.entries(incoming.headers)) {
      if (Array.isArray(value)) headers.set(name, value.join(', '));
      else if (value !== undefined) headers.set(name, value);
    }
    const forwarded = incoming.headers['x-forwarded-for'];
    const peerAddress = incoming.socket.remoteAddress ?? 'unknown';
    const trustedProxy = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(peerAddress);
    const forwardedAddress = Array.isArray(forwarded)
      ? forwarded[0]
      : forwarded?.split(',')[0]?.trim();
    const clientAddress = trustedProxy && forwardedAddress ? forwardedAddress : peerAddress;
    headers.set('cf-connecting-ip', clientAddress);
    const request = new globalThis.Request(`https://localhost${incoming.url ?? '/'}`, {
      method: incoming.method,
      headers,
      ...(incoming.method === 'GET' || incoming.method === 'HEAD' ? {} : { body }),
    });
    const response = await handler(request);
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    const status = error?.code === 'BODY_TOO_LARGE' ? 413 : 500;
    outgoing.writeHead(status, {
      'cache-control': 'no-store',
      'content-type': 'application/json',
      'x-content-type-options': 'nosniff',
    });
    outgoing.end(
      JSON.stringify({ error: status === 413 ? 'payload_too_large' : 'internal_error' }),
    );
  }
});

server.listen(port, host, () => console.log(`Adoption intake listening on ${host}:${port}.`));

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    server.close(() => {
      database.close();
      process.exit(0);
    });
  });
}

function readBody(stream, limit) {
  return new Promise((resolveBody, rejectBody) => {
    const chunks = [];
    let length = 0;
    stream.on('data', (chunk) => {
      length += chunk.length;
      if (length > limit) {
        const error = new Error('Request body too large.');
        error.code = 'BODY_TOO_LARGE';
        rejectBody(error);
        stream.destroy();
        return;
      }
      chunks.push(chunk);
    });
    stream.on('end', () => resolveBody(Buffer.concat(chunks)));
    stream.on('error', rejectBody);
  });
}

function requiredSecret(name) {
  const file = process.env[`${name}_FILE`];
  const value = file ? readFileSync(file, 'utf8').trim() : process.env[name];
  if (typeof value !== 'string' || value.length < 32) {
    throw new Error(`${name} must contain at least 32 characters.`);
  }
  return value;
}

function integerEnvironment(name, fallback) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be positive.`);
  return value;
}
