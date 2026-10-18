import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { AccessSettingsFailure, fetchAccessSettings, publicWebsiteBase, sharingLinks } from '../src/control/accessSettingsRequest.js';

const reply = (value: unknown, status = 200): typeof fetch => async () => new Response(JSON.stringify(value), { status });

test('sharing website accepts a clean origin and rejects paths, credentials and token fragments', () => {
  assert.equal(publicWebsiteBase(' https://broadcast.example.com/ ', 'http://localhost:3000'), 'https://broadcast.example.com');
  assert.equal(publicWebsiteBase('', 'http://localhost:3000'), 'http://localhost:3000');
  for (const value of ['javascript:alert(1)', 'https://user:secret@example.com', 'https://example.com/control', 'https://example.com/#token=secret', 'https://example.com/?token=secret', '//example.com']) assert.throws(() => publicWebsiteBase(value, 'http://localhost:3000'));
  assert.deepEqual(sharingLinks('https://broadcast.example.com', { caster: 'a+b&c', overlay: 'd/e#f' }), { caster: 'https://broadcast.example.com/caster#token=a%2Bb%26c', overlay: 'https://broadcast.example.com/overlay/draft#token=d%2Fe%23f' });
});

test('access settings reads only complete role tokens and validates rotated credentials', async () => {
  assert.deepEqual(await fetchAccessSettings('/api/access', 'control', { fetcher: reply({ tokens: { control: 'private', caster: 'c', overlay: 'o' } }) }), { tokens: { caster: 'c', overlay: 'o' } });
  assert.deepEqual(await fetchAccessSettings('/api/access', 'control', { password: 'password123', fetcher: reply({ token: 'new-control' }) }), { token: 'new-control' });
  for (const data of [{}, { token: '' }, { token: 123 }]) await assert.rejects(fetchAccessSettings('/api/access', 'control', { password: 'password123', fetcher: reply(data) }), (error: unknown) => error instanceof AccessSettingsFailure && error.code === 'invalidResponse');
  await assert.rejects(fetchAccessSettings('/api/access', 'control', { fetcher: reply({ tokens: { caster: 'c', overlay: '' } }) }), (error: unknown) => error instanceof AccessSettingsFailure && error.code === 'invalidResponse');
});

test('expired access and malformed gateway responses have distinct recoverable errors', async () => {
  await assert.rejects(fetchAccessSettings('/api/access', 'old', { fetcher: reply({}, 403) }), (error: unknown) => error instanceof AccessSettingsFailure && error.code === 'unauthorized');
  await assert.rejects(fetchAccessSettings('/api/access', 'old', { fetcher: reply({ local: false }) }), (error: unknown) => error instanceof AccessSettingsFailure && error.code === 'unauthorized');
  await assert.rejects(fetchAccessSettings('/api/access', 'control', { fetcher: async () => new Response('<html>Gateway unavailable</html>', { status: 502 }) }), (error: unknown) => error instanceof AccessSettingsFailure && error.code === 'invalidResponse');
});

test('a hung password rotation times out once without retrying the mutation', async () => {
  let requests = 0;
  const fetcher: typeof fetch = async (_url, init) => {
    requests++;
    assert.equal(init?.method, 'PUT'); assert.equal(init?.body, JSON.stringify({ password: 'password123' }));
    return new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }));
  };
  await assert.rejects(fetchAccessSettings('/api/access', 'control', { password: 'password123', timeoutMs: 10, fetcher }), (error: unknown) => error instanceof AccessSettingsFailure && error.code === 'timeout');
  assert.equal(requests, 1);
});

test('closing settings cancels the read instead of turning it into a timeout', async () => {
  const controller = new AbortController();
  const fetcher: typeof fetch = async (_url, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }));
  const promise = fetchAccessSettings('/api/access', 'control', { signal: controller.signal, fetcher });
  controller.abort();
  await assert.rejects(promise, { name: 'AbortError' });
});
