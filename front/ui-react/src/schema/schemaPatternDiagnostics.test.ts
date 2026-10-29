import { afterEach, expect, test } from 'vitest';
import type { SwaggerDoc } from '../types/swagger';
import { createSchemaDocumentSession, type SchemaDocumentSession } from './schemaDocumentSession';
import { generateSchemaExample } from './schemaExampleGeneration';

let session: SchemaDocumentSession | undefined;
afterEach(() => session?.dispose());
const uri = 'https://example.test/original.json';
const pattern = '^[\\p{IsHan}A-Za-z0-9]+$';
const document = (value = pattern, nested = false): SwaggerDoc => ({
  openapi: '3.1.0',
  info: { title: 'Issue 991', version: '1' },
  paths: {},
  components: {
    schemas: {
      Role: {
        ...(nested ? { $id: 'role.json' } : {}),
        type: 'object',
        properties: { roleName: { type: 'string', pattern: value } },
        required: ['roleName'],
      },
      User: { type: 'string', pattern: '^a+$' },
    },
  },
});

test.each([
  { nested: false, direction: 'request' as const },
  { nested: true, direction: 'request' as const },
  { nested: false, direction: 'response' as const },
  { nested: true, direction: 'response' as const },
])('maps $direction projections to the original pattern (nested resource: $nested)', async ({ nested, direction }) => {
  session = await createSchemaDocumentSession(document(pattern, nested), uri);
  const result = await generateSchemaExample(session, '#/components/schemas/Role', { direction });
  expect(result).toMatchObject({
    status: 'none',
    reason: 'evaluation-unavailable',
    diagnostics: [
      {
        regexIssues: [{ documentUri: uri, pointer: '#/components/schemas/Role/properties/roleName/pattern', pattern }],
      },
    ],
  });
  expect(JSON.stringify(result)).not.toMatch(/knife4j.invalid|schema-projections|bundle|SyntaxError/);
  await expect(
    generateSchemaExample(session, '#/components/schemas/User', { direction: 'request' }),
  ).resolves.toMatchObject({
    status: 'value',
    validation: 'valid',
  });
});

test('keeps an external failure attached to its own registered source document', async () => {
  const external = 'https://example.test/role.json';
  const input = document();
  input.components!.schemas!.Role = { $ref: './role.json' };
  session = await createSchemaDocumentSession(input, uri, {
    resourceDocuments: [
      {
        document: { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'string', pattern },
        retrievalUri: external,
      },
    ],
  });
  const result = await generateSchemaExample(session, '#/components/schemas/Role', { direction: 'request' });
  expect(result).toMatchObject({
    status: 'none',
    diagnostics: [{ regexIssues: [{ documentUri: external, pointer: '#/pattern', pattern }] }],
  });
  expect(JSON.stringify(result)).not.toMatch(/knife4j.invalid|schema-projections/);
});

test('the existing OAS 3.2 adapter also keeps regex diagnostics in public coordinates', async () => {
  session = await createSchemaDocumentSession({ ...document(), openapi: '3.2.0' }, uri);
  const result = await generateSchemaExample(session, '#/components/schemas/Role', { direction: 'request' });
  expect(result).toMatchObject({
    status: 'none',
    diagnostics: [
      {
        regexIssues: [{ documentUri: uri, pointer: '#/components/schemas/Role/properties/roleName/pattern', pattern }],
      },
    ],
  });
  expect(JSON.stringify(result)).not.toMatch(/knife4j.invalid|schema-projections|physical|document0|root0/);
});

test('preserves an authored example with the same structured failure', async () => {
  session = await createSchemaDocumentSession(document(), uri);
  await expect(
    generateSchemaExample(session, '#/components/schemas/Role', {
      direction: 'request',
      explicit: [{ source: 'media-example', value: { roleName: '角色' } }],
    }),
  ).resolves.toMatchObject({
    status: 'value',
    value: { roleName: '角色' },
    authored: true,
    validation: 'unavailable',
    diagnostics: [
      {
        regexIssues: [{ documentUri: uri, pointer: '#/components/schemas/Role/properties/roleName/pattern', pattern }],
      },
    ],
  });
});

test('a compatible Unicode pattern generates a validated example', async () => {
  session = await createSchemaDocumentSession(document('^[\\p{Script=Han}A-Za-z0-9]+$'), uri);
  await expect(
    generateSchemaExample(session, '#/components/schemas/Role', { direction: 'request' }),
  ).resolves.toMatchObject({
    status: 'value',
    validation: 'valid',
    diagnostics: [],
  });
});
