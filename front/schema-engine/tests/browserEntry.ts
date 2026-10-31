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
  const handoffTarget = 'https://browser-check.knife4j.example/handoff-target';
  const handoffRoot = 'https://browser-check.knife4j.example/handoff-root';
  const handoffId = 'urn:browser-check:handoff';
  await engine.registerDocument({ $schema: JSON_SCHEMA_2020_12, $id: handoffId, type: 'integer' }, handoffTarget);
  await engine.registerDocument({ $schema: JSON_SCHEMA_2020_12, $ref: handoffId }, handoffRoot);
  const retired = engine.evaluate(handoffRoot, 'x').catch((error: unknown) => error);
  for (let turn = 0; turn < 6; turn += 1) await Promise.resolve();
  engine.dispose();
  const successor = createSchemaEngine();
  try {
    await successor.registerDocument({ $schema: JSON_SCHEMA_2020_12, $id: handoffId, minLength: -1 }, handoffTarget);
    await successor.registerDocument({ $schema: JSON_SCHEMA_2020_12, $ref: handoffId }, handoffRoot);
    for (const address of [handoffRoot, handoffRoot, handoffId]) {
      const failure = await successor.evaluate(address, 'x').then(
        () => undefined,
        (error: unknown) => error,
      );
      if (!(failure instanceof Error) || !('code' in failure) || failure.code !== 'SCHEMA_RESOLUTION_FAILED')
        throw new Error('A retired owner bypassed its successor meta-validation.');
    }
    await retired;
  } finally {
    successor.dispose();
  }
  document.documentElement.dataset.schemaEngineStatus = 'passed';
} finally {
  engine.dispose();
}
