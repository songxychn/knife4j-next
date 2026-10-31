import { afterEach, expect, test, vi } from 'vitest';
import { addUriSchemePlugin, acceptableMediaTypes, retrieve, get as browserGet } from '@hyperjump/browser';
import { createSchemaEngine, JSON_SCHEMA_2020_12 as dialect, type SchemaEngine } from '../src';
const engines: SchemaEngine[] = [];
const make = () => {
  const e = createSchemaEngine();
  engines.push(e);
  return e;
};
afterEach(() => {
  engines.forEach((e) => e.dispose());
  engines.length = 0;
  vi.restoreAllMocks();
});
const schema = (x: object) => ({ $schema: dialect, ...x });
const retrieval = 'https://retrieval.test/public-api';
test('offline plugins use only explicitly registered resources and make no fetch calls', async () => {
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network forbidden'));
  const e = make();
  const id = 'https://logical.test/value';
  await e.registerDocument(schema({ $id: id, $anchor: 'value', type: 'integer' }), retrieval);
  await e.registerDocument(schema({ $ref: id + '#value' }), 'https://retrieval.test/root');
  expect((await e.evaluate('https://retrieval.test/root', 1)).valid).toBe(true);
  const response = await retrieve(id + '#value');
  expect(response.url).toBe(id);
  const direct = await browserGet(id + '#value');
  expect(direct.document.baseUri).toBe(id);
  await e.registerDocument(schema({ $ref: 'https://logical.test/missing' }), 'https://retrieval.test/missing');
  await expect(e.evaluate('https://retrieval.test/missing', 1)).rejects.toMatchObject({
    code: 'EXTERNAL_RESOURCE_LOADING_DISABLED',
  });
  expect(fetchSpy).not.toHaveBeenCalled();
});
test('foreign scheme handlers are replaced with registered-only handlers before evaluate', async () => {
  const e = make();
  const id = 'urn:test:plugin-owned';
  let calls = 0;
  await e.registerDocument(schema({ $id: id, type: 'integer' }), retrieval);
  await e.registerDocument(schema({ $ref: id }), 'https://retrieval.test/root');
  addUriSchemePlugin('urn', {
    retrieve: async () => {
      calls++;
      throw new Error('foreign plugin ran');
    },
  });
  expect((await e.evaluate('https://retrieval.test/root', 1)).valid).toBe(true);
  expect(calls).toBe(0);
});
test('unload and disposal remove handlers and a new owner can reuse IDs', async () => {
  const e = make();
  const id = 'urn:test:plugin-owned';
  await e.registerDocument(schema({ $id: id, type: 'integer' }), retrieval);
  expect((await e.evaluate(id, 1)).valid).toBe(true);
  e.unregisterDocument(retrieval);
  await expect(Promise.resolve().then(() => retrieve(id))).rejects.toMatchObject({ name: 'UnsupportedUriSchemeError' });
  e.dispose();
  const next = make();
  await next.registerDocument(schema({ $id: id, type: 'string' }), retrieval);
  expect((await next.evaluate(id, 'ok')).valid).toBe(true);
  expect((await next.evaluate(id, 1)).valid).toBe(false);
  next.dispose();
  await expect(Promise.resolve().then(() => retrieve(id))).rejects.toMatchObject({ name: 'UnsupportedUriSchemeError' });
});
test('failed registration and disposal while pending leave no resolver entries', async () => {
  const e = make();
  const id = 'urn:test:plugin-pending';
  const pending = e.registerDocument(schema({ $id: id, type: 'integer' }), retrieval);
  e.dispose();
  await pending;
  const next = make();
  await next.registerDocument(schema({ $id: id, type: 'integer' }), retrieval);
  await expect(
    next.registerDocument(schema({ $id: id, type: 'string' }), 'https://retrieval.test/conflict'),
  ).rejects.toMatchObject({ code: 'RESOURCE_URI_CONFLICT' });
  expect((await next.evaluate(id, 1)).valid).toBe(true);
  next.dispose();
  await expect(Promise.resolve().then(() => retrieve(id))).rejects.toMatchObject({ name: 'UnsupportedUriSchemeError' });
});
test('conflicting engine does not change the active resolver owner', async () => {
  const first = make();
  const id = 'urn:test:first-owned';
  await first.registerDocument(schema({ $id: id, type: 'integer' }), retrieval);
  const second = make();
  await expect(second.registerDocument(true, 'https://retrieval.test/other')).rejects.toMatchObject({
    code: 'ENGINE_SCOPE_CONFLICT',
  });
  await first.registerDocument(schema({ $ref: id }), 'https://retrieval.test/root');
  expect((await first.evaluate('https://retrieval.test/root', 1)).valid).toBe(true);
});
test('cross-document dynamicRef preserves the static anchor target and failure ownership', async () => {
  const e = make();
  const id = 'https://logical.test/dynamic';
  await e.registerDocument(schema({ $id: id, $dynamicAnchor: 'node', type: 'integer' }), retrieval);
  await e.registerDocument(schema({ $dynamicRef: id + '#node' }), 'https://retrieval.test/root');
  expect((await e.evaluate('https://retrieval.test/root', 1)).valid).toBe(true);
  expect((await e.evaluate('https://retrieval.test/root', 'x')).valid).toBe(false);
  e.unregisterDocument(retrieval);
  await e.registerDocument(schema({ $id: id, $dynamicAnchor: 'node', minLength: -1 }), retrieval);
  await expect(e.evaluate('https://retrieval.test/root', 'x')).rejects.toMatchObject({
    code: 'SCHEMA_RESOLUTION_FAILED',
  });
  await expect(e.evaluate(id, 'x')).rejects.toMatchObject({ code: 'SCHEMA_RESOLUTION_FAILED' });
  e.unregisterDocument(retrieval);
  await e.registerDocument(schema({ $id: id, $dynamicAnchor: 'node', minLength: 2 }), retrieval);
  expect((await e.evaluate('https://retrieval.test/root', 'long')).valid).toBe(true);
});

test('disposal removes the engine-owned media type plugin', async () => {
  const e = make();
  const mime = 'application/vnd.knife4j.registered-schema';
  await e.registerDocument(schema({ $id: 'urn:test:mime', type: 'integer' }), retrieval);
  expect(acceptableMediaTypes()).toContain(mime);
  e.dispose();
  expect(acceptableMediaTypes()).not.toContain(mime);
});
