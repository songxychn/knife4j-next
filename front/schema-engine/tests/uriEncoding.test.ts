import { afterEach, describe, expect, test, vi } from 'vitest';
import { createSchemaEngine, JSON_SCHEMA_2020_12, type SchemaEngine } from '../src';
import { normalizeUri, resolveUri, toAbsoluteUri } from '../src/uri';

const engines: SchemaEngine[] = [];
const createEngine = () => {
  const engine = createSchemaEngine();
  engines.push(engine);
  return engine;
};
const base = 'https://encoding.knife4j.example/';

afterEach(() => {
  for (const engine of engines.splice(0)) engine.dispose();
  vi.restoreAllMocks();
});

describe('UTF-8 references in the offline schema registry', () => {
  test.each([
    ['two-byte path', 'caf%C3%A9', 'caf%C3%A9'],
    ['lowercase encoding', 'caf%c3%a9', 'caf%C3%A9'],
    ['three-byte path', '%E6%8E%A5%E5%8F%A3', '%E6%8E%A5%E5%8F%A3'],
    ['four-byte path', '%F0%9F%98%80', '%F0%9F%98%80'],
    ['JSON Pointer fragment', 'caf%C3%A9#/$defs/value', 'caf%C3%A9'],
    ['UTF-8 JSON Pointer fragment', 'caf%C3%A9#/$defs/donn%C3%A9es', 'caf%C3%A9'],
    ['query', '?name=caf%C3%A9', 'root?name=caf%C3%A9'],
    ['absolute control', `${base}caf%C3%A9`, 'caf%C3%A9'],
    ['ASCII control', 'plain', 'plain'],
    ['reserved path control', 'a%2Fb', 'a%2Fb'],
  ])('evaluates a registered %s without fetching', async (_name, reference, target) => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network access is forbidden'));
    const engine = createEngine();
    const rootUri = `${base}root`;
    const root = { $schema: JSON_SCHEMA_2020_12, $ref: reference };
    const value = {
      $schema: JSON_SCHEMA_2020_12,
      type: 'integer',
      $defs: { value: { type: 'integer' }, données: { type: 'integer' } },
    };
    // Keep the regression contract tied to valid JSON Schema and URI references.
    await expect(engine.evaluate(JSON_SCHEMA_2020_12, root)).resolves.toMatchObject({ valid: true });
    await expect(engine.evaluate(JSON_SCHEMA_2020_12, value)).resolves.toMatchObject({ valid: true });
    await engine.registerDocument(value, `${base}${target}`);
    await engine.registerDocument(root, rootUri);

    await expect(engine.evaluate(rootUri, 42)).resolves.toMatchObject({ valid: true });
    await expect(engine.evaluate(rootUri, '42')).resolves.toMatchObject({ valid: false });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('keeps Unicode/encoded identity, conflict detection and unregister cache invalidation', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network access is forbidden'));
    const engine = createEngine();
    const encoded = `${base}caf%C3%A9`;
    const unicode = `${base}café`;
    const root = `${base}root`;
    await engine.registerDocument({ $schema: JSON_SCHEMA_2020_12, type: 'integer' }, unicode);
    await engine.registerDocument({ $schema: JSON_SCHEMA_2020_12, $ref: 'caf%C3%A9' }, root);

    expect((await engine.resolve(encoded)).resourceUri).toBe(unicode);
    await expect(engine.registerDocument(false, encoded)).rejects.toMatchObject({
      code: 'DOCUMENT_ALREADY_REGISTERED',
    });
    await expect(engine.evaluate(root, 42)).resolves.toMatchObject({ valid: true });

    engine.unregisterDocument(encoded);
    await expect(engine.evaluate(root, 42)).rejects.toMatchObject({ code: 'EXTERNAL_RESOURCE_LOADING_DISABLED' });
    await engine.registerDocument({ $schema: JSON_SCHEMA_2020_12, type: 'string' }, encoded);
    await expect(engine.evaluate(root, 'replacement')).resolves.toMatchObject({ valid: true });
    await expect(engine.evaluate(root, 42)).resolves.toMatchObject({ valid: false });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('rejects equivalent embedded resource ids without leaking a partial registration', async () => {
    const engine = createEngine();
    const root = `${base}conflicting-root`;
    await expect(
      engine.registerDocument(
        {
          $schema: JSON_SCHEMA_2020_12,
          $defs: {
            relative: { $id: 'caf%C3%A9', type: 'integer' },
            absolute: { $id: `${base}caf%C3%A9`, type: 'string' },
          },
        },
        root,
      ),
    ).rejects.toMatchObject({ code: 'RESOURCE_URI_CONFLICT' });
    await engine.registerDocument({ $schema: JSON_SCHEMA_2020_12, type: 'boolean' }, `${base}caf%C3%A9`);
    await engine.registerDocument({ $schema: JSON_SCHEMA_2020_12, $ref: 'caf%C3%A9' }, root);
    await expect(engine.evaluate(root, true)).resolves.toMatchObject({ valid: true });
  });

  test('rejects unregistered UTF-8 targets without enabling network retrieval', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network access is forbidden'));
    const engine = createEngine();
    const root = `${base}missing-root`;
    await engine.registerDocument({ $schema: JSON_SCHEMA_2020_12, $ref: 'caf%C3%A9' }, root);
    await expect(engine.evaluate(root, 1)).rejects.toMatchObject({ code: 'EXTERNAL_RESOURCE_LOADING_DISABLED' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('public URI adapter encoding protections', () => {
  test.each([
    'a%2Fb?value=a%26b#%2F',
    'caf%C3%A9?name=%E6%8E%A5%E5%8F%A3#%F0%9F%98%80',
    '%E9',
    '%C0%AF',
    '%ED%A0%80',
    '%25C3%25A9',
  ])('preserves exactly one encoding layer for %s', (reference) => {
    const absolute = `${base}${reference}`;
    expect(resolveUri(reference, `${base}root`)).toBe(absolute);
    expect(normalizeUri(absolute)).toBe(absolute);
    expect(toAbsoluteUri(absolute)).toBe(absolute.split('#')[0]);
  });
});
