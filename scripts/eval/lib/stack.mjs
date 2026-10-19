// The isolated release-auth Supabase stack is the only database this harness
// may touch. Every entry point calls isolatedStack() first; anything else
// (production, staging, another local stack) is refused before a connection.
import path from 'node:path';
import assert from 'node:assert/strict';
import { REPO, readJson, exists } from './paths.mjs';

export const STACK_DIR = path.join(REPO, 'work', 'release-auth-stack');
export const API = 'http://127.0.0.1:55435';
export const DB_HOST = '127.0.0.1';
export const DB_PORT = '55438';

export function isolatedStack() {
  const file = path.join(STACK_DIR, 'status.json');
  assert(exists(file), `Isolated stack status missing: ${file}. Start the release-auth stack first.`);
  const status = readJson(file);
  const db = new URL(status.DB_URL);
  assert.equal(status.API_URL, API, 'Refusing: stack API is not the isolated 127.0.0.1:55435');
  assert.equal(db.protocol, 'postgresql:');
  assert.equal(db.hostname, DB_HOST, 'Refusing: database is not on 127.0.0.1');
  assert.equal(db.port, DB_PORT, 'Refusing: database is not the isolated port 55438');
  assert.equal(db.pathname, '/postgres');
  assert(status.PUBLISHABLE_KEY?.startsWith('sb_publishable_'), 'Unexpected publishable key format');
  assert(status.SECRET_KEY?.startsWith('sb_secret_'), 'Unexpected secret key format');
  return { apiUrl: status.API_URL, dbUrl: status.DB_URL, publishableKey: status.PUBLISHABLE_KEY, secretKey: status.SECRET_KEY, mailUrl: status.MAILPIT_URL ?? status.INBUCKET_URL };
}

/** The local quality fixture account (password stays in memory, never logged). */
export function qualityFixture() {
  const file = path.join(STACK_DIR, 'quality-fixture.json');
  assert(exists(file), `Fixture missing: ${file}`);
  const fixture = readJson(file);
  assert.match(fixture.email, /@example\.invalid$/, 'Fixture account must be a local example.invalid address');
  return fixture;
}

/** Only loopback origins are acceptable targets for app traffic from the harness. */
export function assertLocalOrigin(origin) {
  const url = new URL(origin);
  assert(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), `Refusing non-local origin ${url.origin}`);
  return url.origin;
}
