// nginx отдаёт ZIP с max-age на 10 лет, а адрес архива не меняется между
// пересборками прошивки, поэтому загрузчик обязан обходить HTTP-кэш браузера.
import test from 'node:test';
import assert from 'node:assert/strict';

import { loadArchiveEntry, clearArchiveCache } from '../js/zip-loader.js';

test('loadArchiveEntry просит браузер не брать архив из кэша', async (t) => {
  const calls = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    // Не ZIP: разбор упадёт, но вызов fetch уже случился.
    return new Response(new Uint8Array([0x00]), {
      status: 200,
      headers: { 'Content-Length': '1' },
    });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
    clearArchiveCache();
  });

  await assert.rejects(loadArchiveEntry('https://example.test/stale.zip', '\\.bin$'));

  assert.equal(calls.length, 1);
  assert.equal(calls[0].options?.cache, 'no-store');
});
