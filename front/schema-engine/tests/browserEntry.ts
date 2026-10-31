import { createSchemaEngine, JSON_SCHEMA_2020_12 } from '../src';

const engine = createSchemaEngine();
const uri = 'https://browser-check.knife4j.example/tree';

try {
  await engine.registerDocument(
    {
      $schema: JSON_SCHEMA_2020_12,
      $dynamicAnchor: 'node',
      type: 'object',
      properties: {
        value: true,
        children: {
          type: 'array',
          items: { $dynamicRef: '#node' },
        },
      },
      unevaluatedProperties: false,
    },
    uri,
  );
  const result = await engine.evaluate(uri, { value: 'root', children: [] });
  if (!result.valid) throw new Error('Browser schema evaluation failed.');
  const targetUri = 'https://browser-check.knife4j.example/target';
  const rootUri = 'https://browser-check.knife4j.example/root';
  const resourceId = 'example:/.//value';
  await engine.registerDocument(
    { $schema: JSON_SCHEMA_2020_12, $id: 'example:/a/..//value', type: 'integer' },
    targetUri,
  );
  await engine.registerDocument({ $schema: JSON_SCHEMA_2020_12, $ref: resourceId }, rootUri);
  if (!(await engine.evaluate(rootUri, 1)).valid || (await engine.evaluate(rootUri, 'bad')).valid)
    throw new Error('Cross-document offline resource identity was lost.');
  engine.unregisterDocument(targetUri);
  const missing = await engine.evaluate(rootUri, 1).then(
    () => undefined,
    (error: unknown) => error,
  );
  if (!(missing instanceof Error) || !('code' in missing) || missing.code !== 'RESOURCE_NOT_REGISTERED')
    throw new Error('An unloaded dependency survived in the browser cache.');
  await engine.registerDocument({ $schema: JSON_SCHEMA_2020_12, $id: resourceId, type: 'string' }, targetUri);
  if (!(await engine.evaluate(rootUri, 'ok')).valid || (await engine.evaluate(rootUri, 1)).valid)
    throw new Error('A reloaded dependency retained its old compiled validator.');
  document.documentElement.dataset.schemaEngineStatus = 'passed';
} finally {
  engine.dispose();
}
