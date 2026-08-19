import JSZip from 'jszip';
import { buildExportDocument } from 'knife4j-core';
import { describe, expect, test, vi } from 'vitest';
import type { MenuOperation, MenuTag, OperationObject, SwaggerDoc } from '../../types/swagger';
import { buildDocx, buildHtmlDoc, buildMarkdownDoc, buildWordDoc, type OfficeDocLabels } from './OfficeDoc';

vi.mock('../../context/GroupContext', () => ({
  useGroup: () => ({}),
}));

const labels: OfficeDocLabels = {
  language: 'en-US',
  version: 'Version',
  description: 'Description',
  name: 'Name',
  location: 'Location',
  required: 'Required',
  type: 'Type',
  field: 'Field',
  yes: 'Yes',
  no: 'No',
  requestBody: 'Request body',
  mediaType: 'Content-Type',
  responses: 'Responses',
  response: 'Response',
  statusCode: 'Status code',
  schema: 'Schema',
  deprecated: 'Deprecated',
  parameters: 'Parameters',
  circularReference: 'Circular reference',
  fallbackTitle: 'API documentation',
  markdown: {
    version: 'Version',
    truncated: 'Circular reference',
    deprecated: 'Deprecated',
    requestParameters: 'Request parameters',
    noRequestParameters: 'No request parameters.',
    requestBody: 'Request body',
    noRequestBody: 'No request body.',
    requestBodyNotExpandable: 'Request body schema cannot be expanded.',
    mediaType: 'Content-Type',
    responseStructure: 'Responses',
    noResponse: 'No response defined.',
    name: 'Name',
    location: 'Location',
    type: 'Type',
    required: 'Required',
    description: 'Description',
    field: 'Field',
    yes: 'Yes',
    no: 'No',
    status: 'Status code',
    schema: 'Schema',
  },
};

const listPeople: OperationObject = {
  summary: 'Find a person',
  description: 'Returns one person with profile details.',
  deprecated: true,
  parameters: [
    {
      name: 'personId',
      in: 'path',
      required: true,
      description: 'Person identifier',
      schema: { type: 'string' },
    },
    {
      name: 'verbose',
      in: 'query',
      description: 'Include profile details',
      schema: { type: 'boolean' },
    },
  ],
  responses: {
    200: {
      description: 'Person found',
      content: { 'application/json': { schema: { $ref: '#/components/schemas/PersonEnvelope' } } },
    },
    404: {
      description: 'Person missing',
      content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } },
    },
  },
};

const createPerson: OperationObject = {
  summary: 'Create a person',
  description: 'Creates a person from a nested profile.',
  requestBody: {
    required: true,
    description: 'Person creation payload.',
    content: { 'application/json': { schema: { $ref: '#/components/schemas/CreatePerson' } } },
  },
  responses: {
    201: {
      description: 'Person created',
      content: { 'application/json': { schema: { $ref: '#/components/schemas/PersonEnvelope' } } },
    },
    422: {
      description: 'Validation failed',
      content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } },
    },
  },
};

const getAuditEntry: OperationObject = {
  summary: 'Read an audit entry',
  description: 'Returns one immutable audit entry.',
  parameters: [
    {
      name: 'entryId',
      in: 'path',
      required: true,
      description: 'Audit entry identifier',
      schema: { type: 'integer', format: 'int64' },
    },
  ],
  responses: {
    200: {
      description: 'Audit entry found',
      content: { 'application/json': { schema: { $ref: '#/components/schemas/AuditEntry' } } },
    },
  },
};

const deleteAuditEntry: OperationObject = {
  summary: 'Delete an audit entry',
  description: 'Deletes one audit entry after retention expires.',
  parameters: [
    {
      name: 'entryId',
      in: 'path',
      required: true,
      description: 'Audit entry identifier',
      schema: { type: 'integer', format: 'int64' },
    },
  ],
  responses: {
    204: { description: 'Audit entry deleted' },
    409: {
      description: 'Retention active',
      content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } },
    },
  },
};

const doc: SwaggerDoc = {
  openapi: '3.0.3',
  info: {
    title: 'Unified Export API',
    version: '2026.8.19',
    description: 'Cross-format contract fixture.',
  },
  tags: [
    { name: 'People', description: 'People operations.' },
    { name: 'Audit', description: 'Audit operations.' },
  ],
  paths: {
    '/people/{personId}': { get: listPeople },
    '/people': { post: createPerson },
    '/audit/{entryId}': { get: getAuditEntry, delete: deleteAuditEntry },
  },
  components: {
    schemas: {
      Address: {
        type: 'object',
        required: ['city'],
        properties: {
          city: { type: 'string', description: 'Home city' },
        },
      },
      Profile: {
        type: 'object',
        required: ['email'],
        properties: {
          email: { type: 'string', format: 'email', description: 'Contact email' },
          address: { $ref: '#/components/schemas/Address' },
        },
      },
      CreatePerson: {
        type: 'object',
        required: ['name', 'profile'],
        properties: {
          name: { type: 'string', description: 'Display name' },
          profile: { $ref: '#/components/schemas/Profile' },
        },
      },
      PersonEnvelope: {
        type: 'object',
        required: ['data'],
        properties: {
          data: { $ref: '#/components/schemas/CreatePerson' },
        },
      },
      ErrorItem: {
        type: 'object',
        required: ['code'],
        properties: {
          code: { type: 'string', description: 'Machine error code' },
        },
      },
      ErrorEnvelope: {
        type: 'object',
        properties: {
          errors: {
            type: 'array',
            description: 'Validation errors',
            items: { $ref: '#/components/schemas/ErrorItem' },
          },
        },
      },
      AuditEntry: {
        type: 'object',
        required: ['event'],
        properties: {
          event: { type: 'string', description: 'Audit event name' },
        },
      },
    },
  },
};

function menuOperation(key: string, path: string, method: string, operation: OperationObject): MenuOperation {
  return {
    key,
    path,
    method,
    summary: operation.summary ?? path,
    deprecated: operation.deprecated,
    operation,
  };
}

const tags: MenuTag[] = [
  {
    tag: 'People',
    description: 'People operations.',
    operations: [
      menuOperation('people/find', '/people/{personId}', 'get', listPeople),
      menuOperation('people/create', '/people', 'post', createPerson),
    ],
  },
  {
    tag: 'Audit',
    description: 'Audit operations.',
    operations: [
      menuOperation('audit/read', '/audit/{entryId}', 'get', getAuditEntry),
      menuOperation('audit/delete', '/audit/{entryId}', 'delete', deleteAuditEntry),
    ],
  },
];

const sharedTokens = [
  'Unified Export API',
  '2026.8.19',
  'Cross-format contract fixture.',
  'People',
  'People operations.',
  'Audit',
  'Audit operations.',
  'Find a person',
  'Returns one person with profile details.',
  'Create a person',
  'Creates a person from a nested profile.',
  'Person creation payload.',
  'Read an audit entry',
  'Returns one immutable audit entry.',
  'Delete an audit entry',
  'Deletes one audit entry after retention expires.',
  'Deprecated',
  'personId',
  'verbose',
  'entryId',
  'profile.email',
  'profile.address.city',
  'Person found',
  'Person missing',
  'Person created',
  'Validation failed',
  'data.profile.email',
  'errors[].code',
  'Audit entry found',
  'Audit entry deleted',
  'Retention active',
];

async function readDocumentXml(blob: Blob): Promise<string> {
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const documentPart = zip.file('word/document.xml');
  expect(documentPart).not.toBeNull();
  return documentPart!.async('text');
}

describe('offline document cross-format contract', () => {
  test('builds one format-independent model with the selected menu order and recursive schema fields', () => {
    const model = buildExportDocument(doc, tags);
    const findOperation = model.tags[0].operations[0];
    const createOperation = model.tags[0].operations[1];

    expect(model).toMatchObject({
      title: 'Unified Export API',
      version: '2026.8.19',
      description: 'Cross-format contract fixture.',
      tags: [
        {
          name: 'People',
          description: 'People operations.',
          numberPath: [1],
          operations: [
            {
              title: 'Find a person',
              numberPath: [1, 1],
              method: 'GET',
              path: '/people/{personId}',
              summary: 'Find a person',
              description: 'Returns one person with profile details.',
              deprecated: true,
            },
            { title: 'Create a person', numberPath: [1, 2] },
          ],
        },
        { name: 'Audit', numberPath: [2], operations: [{ numberPath: [2, 1] }, { numberPath: [2, 2] }] },
      ],
    });
    expect(findOperation.parameters.map((parameter) => [parameter.name, parameter.location])).toEqual([
      ['personId', 'path'],
      ['verbose', 'query'],
    ]);
    expect(createOperation.requestBody?.schema?.fields.map((field) => field.fieldPath)).toEqual(
      expect.arrayContaining(['name', 'profile', 'profile.email', 'profile.address.city']),
    );
    expect(createOperation.requestBody).toMatchObject({
      description: 'Person creation payload.',
      required: true,
      schema: {
        mediaType: 'application/json',
        typeDisplay: 'CreatePerson',
        kind: 'object',
      },
    });
    expect(findOperation.responses.map((response) => response.statusCode)).toEqual(['200', '404']);
    expect(findOperation.responses[0].schema?.fields.map((field) => field.fieldPath)).toContain('data.profile.email');
    expect(findOperation.responses[1].schema?.fields.map((field) => field.fieldPath)).toContain('errors[].code');
  });

  test('all reading formats include the same shared document semantics', async () => {
    const outputs = {
      HTML: buildHtmlDoc(doc, tags, labels),
      DOC: buildWordDoc(doc, tags, labels),
      DOCX: await readDocumentXml(await buildDocx(doc, tags, labels)),
      Markdown: buildMarkdownDoc(doc, tags, labels),
    };

    const missingTokens = Object.fromEntries(
      Object.entries(outputs).map(([format, output]) => [
        format,
        sharedTokens.filter((token) => !output.includes(token)),
      ]),
    );

    expect(missingTokens).toEqual({
      HTML: [],
      DOC: [],
      DOCX: [],
      Markdown: [],
    });

    for (const format of ['HTML', 'DOC'] as const) {
      expect(outputs[format]).toContain('Request body (application/json)');
      expect(outputs[format]).toContain('Type: <code>CreatePerson</code> &nbsp;Required: Yes');
    }
    expect(outputs.DOCX).toContain('Request body (application/json)');
    expect(outputs.DOCX).toContain('Type: CreatePerson  Required: Yes');
    expect(outputs.Markdown).toContain(
      '**Content-Type:** `application/json` · **Type:** `CreatePerson` · **Required:** Yes',
    );
  });
});
