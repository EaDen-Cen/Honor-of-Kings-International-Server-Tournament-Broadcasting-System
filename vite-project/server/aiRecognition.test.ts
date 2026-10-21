import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { setTimeout as pause, setImmediate as tick } from 'node:timers/promises';
import {
  AiRecognitionService,
  aiRecognition,
  recognizeAiWithFallback,
  setAiConfig,
} from './aiRecognition.js';
import { publicAiAddress, type VisionTransport } from './aiTransport.js';
import { fuseHud, fusePlayers, fusePostGame } from './aiFusion.js';
const image = 'data:image/png;base64,aGVsbG8=';
const config = {
  enabled: true,
  vendor: 'openai',
  model: 'vision',
  endpoint: '',
  apiKey: 'fake-secret',
};
const reply = (value: unknown) => ({
  status: 200,
  data: { choices: [{ message: { content: JSON.stringify(value) } }] },
});
const local = () =>
  Promise.resolve({ preview: 'lock-evidence', candidates: [{ heroId: 7, confidence: 0.4 }] });
afterEach(() => setAiConfig({ ...config, enabled: false, apiKey: '' }));

test('credentials never cross a provider/origin change and explicit empty clears them', () => {
  const service = new AiRecognitionService();
  assert.equal(service.configure(config).configured, true);
  assert.equal(JSON.stringify(service.publicConfig()).includes('fake-secret'), false);
  assert.equal(
    service.configure({ ...config, apiKey: undefined, model: 'other' }).configured,
    true,
  );
  assert.equal(
    service.configure({ ...config, vendor: 'anthropic', apiKey: undefined }).configured,
    false,
  );
  assert.equal(service.configure(config).configured, true);
  assert.equal(service.configure({ ...config, apiKey: '' }).configured, false);
});
test('reject unsafe endpoints including query secrets and non-public literal IPs', () => {
  for (const endpoint of [
    'http://api.openai.com',
    'https://127.0.0.1/x',
    'https://100.64.0.1/x',
    'https://192.0.2.1/x',
    'https://api.openai.com/?key=secret',
    'https://u:p@api.openai.com/x',
    'https://api.openai.com:444/x',
    'https://evil.example/x',
  ]) {
    assert.throws(() => new AiRecognitionService().configure({ ...config, endpoint }));
  }
  for (const address of [
    '127.0.0.1',
    '10.1.1.1',
    '169.254.169.254',
    '192.168.0.1',
    '100.64.1.1',
    '::1',
    '::ffff:127.0.0.1',
    'fc00::1',
    '2001:db8::1',
  ])
    assert.equal(publicAiAddress(address), false, address);
  assert.equal(publicAiAddress('8.8.8.8'), true);
});
test('all named vendors configure without network requests', () => {
  for (const vendor of [
    'openai',
    'anthropic',
    'gemini',
    'deepseek',
    'qwen',
    'doubao',
    'glm',
    'kimi',
    'baidu',
  ])
    assert.equal(new AiRecognitionService().configure({ ...config, vendor }).vendor, vendor);
});
test('slow cloud never blocks local recognition and duplicate frames dispatch once', async () => {
  let finish!: (v: Awaited<ReturnType<VisionTransport>>) => void;
  let calls = 0;
  const service = new AiRecognitionService(() => {
    calls++;
    return new Promise((r) => {
      finish = r;
    });
  });
  service.configure(config);
  const start = performance.now();
  assert.equal(service.hero(image, [7], 'match-a'), undefined);
  assert.equal(service.hero(image, [7], 'match-a'), undefined);
  assert.equal(calls, 1);
  assert.ok(performance.now() - start < 100);
  finish(reply({ heroId: 7, confidence: 0.99 }));
  await tick();
  assert.equal(service.hero(image, [7], 'match-a')?.heroId, 7);
  assert.equal(service.hero(image, [7], 'match-b'), undefined);
  service.invalidate();
});
test('configuration epoch prevents a late response repopulating cleared caches', async () => {
  let finish!: (v: Awaited<ReturnType<VisionTransport>>) => void;
  const service = new AiRecognitionService(
    () =>
      new Promise((r) => {
        finish = r;
      }),
  );
  service.configure(config);
  service.hero(image, [7], 'match');
  service.configure({ ...config, model: 'new-model' });
  finish(reply({ heroId: 7, confidence: 1 }));
  await tick();
  assert.equal(service.diagnostics().cached, 0);
  assert.equal(service.diagnostics().busy, false);
});
test('changing same-stream image cancels obsolete work; pool and context do not share cache', async () => {
  let signal: AbortSignal | undefined;
  const service = new AiRecognitionService(async (_u, _h, _b, s) => {
    signal = s;
    return new Promise(() => {});
  });
  service.configure(config);
  service.hero(image, [7], 'match');
  service.hero(image + 'YQ==', [7], 'match');
  assert.equal(signal?.aborted, true);
  await tick();
  assert.equal(service.diagnostics().busy, false);
});
test('429 and failures do not queue work, cooldown and TTL expire', async () => {
  let now = 0,
    calls = 0;
  const service = new AiRecognitionService(
    async () => {
      calls++;
      return calls === 1 ? { status: 429, data: {} } : reply({ heroId: 7, confidence: 1 });
    },
    () => now,
  );
  service.configure(config);
  service.hero(image, [7], 'match');
  await tick();
  now = 2000;
  service.hero(image, [7], 'match');
  assert.equal(calls, 1);
  now = 11000;
  service.hero(image, [7], 'match');
  await tick();
  assert.equal(service.hero(image, [7], 'match')?.heroId, 7);
  now = 16000;
  assert.equal(service.hero(image, [7], 'match'), undefined);
  await tick();
});
test('malformed and out-of-pool model values are ignored', async () => {
  for (const value of [
    { heroId: 999999, confidence: 1 },
    { heroId: 7, confidence: 2 },
    { heroId: '7', confidence: 0.99 },
    { heroId: 7, confidence: 0.2 },
    null,
  ]) {
    const service = new AiRecognitionService(async () => reply(value));
    service.configure(config);
    service.hero(image, [7], 's');
    await tick();
    assert.equal(service.hero(image, [7], 's'), undefined);
    service.invalidate();
  }
});
test('provider adapters use distinct wire protocols and no URL credentials', async () => {
  for (const vendor of ['openai', 'anthropic', 'gemini']) {
    let captured: { url: string; headers: Record<string, string>; body: unknown } | undefined;
    const service = new AiRecognitionService(async (url, headers, body) => {
      captured = { url, headers, body };
      return reply({});
    });
    service.configure({ ...config, vendor });
    service.hero(image, [7], 's');
    await tick();
    assert.ok(captured);
    assert.ok(!captured.url.includes('fake-secret'));
    assert.equal(
      captured.headers[
        vendor === 'openai'
          ? 'Authorization'
          : vendor === 'anthropic'
            ? 'x-api-key'
            : 'x-goog-api-key'
      ],
      vendor === 'openai' ? 'Bearer fake-secret' : 'fake-secret',
    );
    assert.ok(
      JSON.stringify(captured.body).includes(
        vendor === 'anthropic' ? 'media_type' : vendor === 'gemini' ? 'inline_data' : 'image_url',
      ),
    );
  }
});
test('validated AI fills weak HUD fields while credible conflicting OCR wins', async () => {
  const service = new AiRecognitionService(async () => reply({ text: '10', confidence: 0.99 }));
  service.configure(config);
  const weak = [{ key: 'blueKills' as const, value: null, confidence: 0, text: '' }];
  assert.equal(fuseHud([image], weak, 'm', service)[0].value, null);
  await tick();
  assert.equal(fuseHud([image], weak, 'm', service)[0].value, 10);
  assert.equal(
    fuseHud([image], [{ ...weak[0], value: 9, confidence: 0.7 }], 'm', service)[0].value,
    9,
  );
  assert.equal(fuseHud([image], weak, 'new-match', service)[0].value, null);
  service.invalidate();
});
test('postgame numeric and player identity validators reject inventions', async () => {
  const service = new AiRecognitionService(async () =>
    reply({ text: '99999999999', confidence: 0.99 }),
  );
  service.configure(config);
  const weak = { text: '', confidence: 0 };
  fusePostGame(image, 'kills', 'm', weak, service);
  await tick();
  assert.equal(fusePostGame(image, 'kills', 'm', weak, service).text, '');
  const ids = new AiRecognitionService(async () => reply({ text: 'outsider', confidence: 0.99 }));
  ids.configure(config);
  fusePlayers([image], [[]], [['Alpha'], ['Beta']], 'm', ids);
  await tick();
  assert.deepEqual(fusePlayers([image], [[]], [['Alpha'], ['Beta']], 'm', ids), [[]]);
});
test('local lock evidence survives AI failure and high-confidence conflicts', async (t) => {
  t.mock.method(aiRecognition, 'hero', () => ({ heroId: 8, confidence: 0.95 }));
  const result = await recognizeAiWithFallback(image, [7, 8], local, 'r1');
  assert.equal(result.preview, 'lock-evidence');
  assert.equal(result.candidates[0].heroId, 8);
  const strong = await recognizeAiWithFallback(
    image,
    [7, 8],
    async () => ({ candidates: [{ heroId: 7, confidence: 0.7 }] }),
    'r1',
  );
  assert.equal(strong.candidates[0].heroId, 7);
});

test('deadline frees the scheduler even when a provider ignores cancellation', async () => {
  const service = new AiRecognitionService(async () => new Promise(() => {}));
  service.configure(config);
  service.hero(image, [7], 'timeout');
  assert.equal(service.diagnostics().busy, true);
  await pause(1900);
  assert.equal(service.diagnostics().busy, false);
  assert.equal(service.diagnostics().cached, 0);
});

test('late throttling from an old configuration cannot cool down the new provider', async () => {
  let finish!: (v: Awaited<ReturnType<VisionTransport>>) => void;
  let calls = 0;
  const service = new AiRecognitionService(() => {
    calls++;
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  service.configure(config);
  service.hero(image, [7], 'old');
  service.configure({ ...config, model: 'replacement' });
  await tick();
  finish({ status: 429, data: null });
  await tick();
  service.hero(image, [7], 'new');
  assert.equal(calls, 2);
  service.invalidate();
});
