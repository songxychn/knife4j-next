import { afterEach, describe, expect, test, vi } from 'vitest';
import { createSchemaEngine, JSON_SCHEMA_2020_12, type SchemaEngine } from '../src';
import { normalizeUri, parseUri, resolveUri, toAbsoluteUri } from '../src/uri';

const engines: SchemaEngine[] = [];
const pathUri = 'example:/.//b';
const authorityUri = 'example://b';

afterEach(() => {
  for (const engine of engines.splice(0)) engine.dispose();
  vi.restoreAllMocks();
});

describe('double-slash paths and authority identities', () => {
  // RFC 3986 sections 3.2 and 5.2.4: removing dot segments cannot turn a path
  // into an authority. The /./ prefix preserves a path starting with //.
  test.each([
    ['example:/a/..//b', pathUri],
    [pathUri, pathUri],
    [authorityUri, authorityUri],
    ['example:/a/..//b?value=%26#%2F', `${pathUri}?value=%26#%2F`],
    ['https://example.test/a/..//b', 'https://example.test//b'],
  ])('preserves URI structure while normalizing %s', (input, expected) => {
    expect(normalizeUri(input)).toBe(expected);
    expect(normalizeUri(expected)).toBe(expected);
    expect(toAbsoluteUri(input)).toBe(expected.split('#')[0]);
    expect(resolveUri(input, 'https://example.test/root')).toBe(expected);
    expect(parseUri(normalizeUri(input)).authority).toBe(parseUri(expected).authority);
  });

  test.each([
    [pathUri, authorityUri],
    [authorityUri, pathUri],
  ])('keeps independent resources when registering %s before %s', async (first, second) => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network access is forbidden'));
    const engine = createSchemaEngine();
    engines.push(engine);
    const schemas = {
      [pathUri]: { $schema: JSON_SCHEMA_2020_12, type: 'integer' },
      [authorityUri]: { $schema: JSON_SCHEMA_2020_12, type: 'string' },
    };
    for (const schema of Object.values(schemas)) {
      await expect(engine.evaluate(JSON_SCHEMA_2020_12, schema)).resolves.toMatchObject({ valid: true });
    }

    await engine.registerDocument(schemas[first], first);
    await engine.registerDocument(schemas[second], second);
    await expect(engine.resolve(pathUri)).resolves.toMatchObject({ resourceUri: pathUri });
    await expect(engine.resolve(authorityUri)).resolves.toMatchObject({ resourceUri: authorityUri });
    await expect(engine.evaluate(pathUri, 1)).resolves.toMatchObject({ valid: true });
    await expect(engine.evaluate(pathUri, 'text')).resolves.toMatchObject({ valid: false });
    await expect(engine.evaluate(authorityUri, 'text')).resolves.toMatchObject({ valid: true });
    await expect(engine.evaluate(authorityUri, 1)).resolves.toMatchObject({ valid: false });

    await expect(engine.registerDocument(false, 'example:/a/..//b')).rejects.toMatchObject({
      code: 'DOCUMENT_ALREADY_REGISTERED',
    });
    engine.unregisterDocument('example:/a/..//b');
    await expect(engine.resolve(pathUri)).rejects.toMatchObject({ code: 'RESOURCE_NOT_REGISTERED' });
    await expect(engine.evaluate(authorityUri, 'still registered')).resolves.toMatchObject({ valid: true });
    await engine.registerDocument({ $schema: JSON_SCHEMA_2020_12, type: 'boolean' }, pathUri);
    await expect(engine.evaluate(pathUri, true)).resolves.toMatchObject({ valid: true });
    await expect(engine.evaluate(pathUri, 1)).resolves.toMatchObject({ valid: false });
    await expect(engine.evaluate(authorityUri, 1)).resolves.toMatchObject({ valid: false });

    await expect(engine.resolve('example:/.//unregistered')).rejects.toMatchObject({
      code: 'RESOURCE_NOT_REGISTERED',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
