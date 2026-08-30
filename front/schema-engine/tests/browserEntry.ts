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
  document.documentElement.dataset.schemaEngineStatus = 'passed';
} finally {
  engine.dispose();
}
