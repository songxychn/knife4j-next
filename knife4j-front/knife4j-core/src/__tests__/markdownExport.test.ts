/**
 * Unit tests for markdownExport.ts — issue-302
 *
 * Verifies that schemaName correctly handles the three schema branches
 * (array / object / $ref) and never produces "[object Object]".
 */
import { generateApiMarkdown } from '../markdownExport';
import type { MdDocContext, MdOperationObject, MdSchemaObject } from '../markdownExport';

// ── helpers ──────────────────────────────────────────────────────────────────

function makeCtx(schemas?: Record<string, MdSchemaObject>): MdDocContext {
  return { components: schemas ? { schemas } : undefined };
}

// ── schemaName via generateApiMarkdown ────────────────────────────────────────

describe('markdownExport — schemaName type rendering', () => {
  test('$ref schema renders the schema name, not [object Object]', () => {
    const ctx = makeCtx({
      UserVO: {
        type: 'object',
        properties: { id: { type: 'integer' }, name: { type: 'string' } },
      },
    });
    const op: MdOperationObject = {
      summary: 'Get user',
      requestBody: {
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/UserVO' },
          },
        },
      },
    };
    const md = generateApiMarkdown({ method: 'GET', path: '/user', operation: op, docContext: ctx });
    expect(md).not.toContain('[object Object]');
    expect(md).toContain('id');
    expect(md).toContain('name');
  });

  test('array schema renders "ElementType[]", not [object Object]', () => {
    const ctx = makeCtx();
    const op: MdOperationObject = {
      summary: 'List items',
      parameters: [
        {
          name: 'ids',
          in: 'query',
          schema: { type: 'array', items: { type: 'integer', format: 'int64' } },
        },
      ],
    };
    const md = generateApiMarkdown({ method: 'GET', path: '/items', operation: op, docContext: ctx });
    expect(md).not.toContain('[object Object]');
    expect(md).toContain('integer/int64[]');
  });

  test('object schema with properties renders "object", not [object Object]', () => {
    const ctx = makeCtx();
    const op: MdOperationObject = {
      summary: 'Create',
      parameters: [
        {
          name: 'body',
          in: 'body',
          schema: { type: 'object', properties: { foo: { type: 'string' } } },
        },
      ],
    };
    const md = generateApiMarkdown({ method: 'POST', path: '/create', operation: op, docContext: ctx });
    expect(md).not.toContain('[object Object]');
    expect(md).toContain('object');
  });

  test('atomic type renders "string", not [object Object]', () => {
    const ctx = makeCtx();
    const op: MdOperationObject = {
      summary: 'Echo',
      parameters: [
        {
          name: 'msg',
          in: 'query',
          schema: { type: 'string' },
        },
      ],
    };
    const md = generateApiMarkdown({ method: 'GET', path: '/echo', operation: op, docContext: ctx });
    expect(md).not.toContain('[object Object]');
    expect(md).toContain('string');
  });

  test('$ref array items renders "RefName[]", not [object Object]', () => {
    const ctx = makeCtx({
      Item: { type: 'object', properties: { id: { type: 'integer' } } },
    });
    const op: MdOperationObject = {
      summary: 'List',
      parameters: [
        {
          name: 'items',
          in: 'query',
          schema: { type: 'array', items: { $ref: '#/components/schemas/Item' } },
        },
      ],
    };
    const md = generateApiMarkdown({ method: 'GET', path: '/list', operation: op, docContext: ctx });
    expect(md).not.toContain('[object Object]');
    expect(md).toContain('Item[]');
  });

  test('response $ref schema renders ref name in Schema column', () => {
    const ctx = makeCtx({
      PageResult: { type: 'object', properties: { total: { type: 'integer' } } },
    });
    const op: MdOperationObject = {
      summary: 'Page query',
      responses: {
        '200': {
          description: 'OK',
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/PageResult' } },
          },
        },
      },
    };
    const md = generateApiMarkdown({ method: 'GET', path: '/page', operation: op, docContext: ctx });
    expect(md).not.toContain('[object Object]');
    expect(md).toContain('PageResult');
  });

  test('OAS2 parameter with type/format fields renders correctly', () => {
    const ctx = makeCtx();
    const op: MdOperationObject = {
      summary: 'Legacy',
      parameters: [
        {
          name: 'page',
          in: 'query',
          type: 'integer',
          format: 'int32',
        },
      ],
    };
    const md = generateApiMarkdown({ method: 'GET', path: '/legacy', operation: op, docContext: ctx });
    expect(md).not.toContain('[object Object]');
    expect(md).toContain('integer/int32');
  });
});
