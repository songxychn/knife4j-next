import { describe, expect, it } from 'vitest';
import { ExternalResourceLoader } from '../../schema/externalResourceGraph';
import type { MenuOperation, SwaggerDoc } from '../../types/swagger';
import { buildOpenApiViewState } from './openApiViewState';

const retrievalUri = 'https://fixtures.knife4j.example/openapi.json';

function operation(path = '/pets', source: 'path' | 'webhook' = 'path'): MenuOperation {
  return {
    key: `Pets/${source}`,
    path,
    method: 'get',
    summary: 'Get pets',
    operationId: 'getPets',
    source,
    operation: {
      operationId: 'getPets',
      responses: { 200: { description: 'ok' } },
    },
  };
}

function oas31Document(): SwaggerDoc {
  return {
    openapi: '3.1.1',
    info: { title: 'Pets', version: '1.0.0' },
    paths: {
      '/pets': {
        get: {
          operationId: 'getPets',
          responses: {
            200: {
              description: 'ok',
              content: { 'application/json': { schema: { type: 'array', items: { type: 'string' } } } },
            },
          },
        },
      },
    },
    webhooks: {
      changed: {
        get: {
          operationId: 'getPets',
          responses: {
            200: {
              description: 'accepted',
              content: { 'application/json': { schema: { type: 'string' } } },
            },
          },
        },
      },
    },
  } as SwaggerDoc;
}

function readyAvailability(document: SwaggerDoc) {
  const loader = new ExternalResourceLoader(document, retrievalUri);
  return {
    status: 'ready' as const,
    retrievalUri,
    snapshot: loader.currentSnapshot(),
  };
}

describe('buildOpenApiViewState', () => {
  it('keeps the OAS 3.0 closed-document download path unchanged', () => {
    const document = { ...oas31Document(), openapi: '3.0.3', webhooks: undefined } as SwaggerDoc;
    const state = buildOpenApiViewState(document, operation(), { status: 'unavailable' });

    expect(state).toMatchObject({ status: 'ready', downloadable: true, notice: null });
    expect(JSON.parse(state.status === 'ready' ? state.json : '{}')).toHaveProperty('paths./pets.get');
  });

  it.each([
    ['/pets', 'path'],
    ['changed', 'webhook'],
  ] as const)('enables a portable OAS 3.1 %s operation download', (path, source) => {
    const document = oas31Document();
    const state = buildOpenApiViewState(document, operation(path, source), readyAvailability(document));

    expect(state).toMatchObject({ status: 'ready', downloadable: true, notice: null });
    const output = JSON.parse(state.status === 'ready' ? state.json : '{}');
    expect(output).toHaveProperty(`${source === 'webhook' ? 'webhooks' : 'paths'}.${path}.get`);
    expect(output).toHaveProperty('x-knife4j-schema-resources');
  });

  it('keeps preview and copy data while selected external resources block download', () => {
    const document = oas31Document();
    document.paths!['/pets'].get!.responses = {
      200: {
        description: 'ok',
        content: {
          'application/json': { schema: { $ref: './schemas/pet.json' } },
        },
      },
    };
    const state = buildOpenApiViewState(document, operation(), readyAvailability(document));

    expect(state).toMatchObject({
      status: 'ready',
      downloadable: false,
      notice: {
        kind: 'oas31-blocked',
        blockers: [expect.objectContaining({ code: 'RESOURCE_PENDING' })],
      },
    });
    expect(JSON.parse(state.status === 'ready' ? state.json : '{}')).toHaveProperty(
      'paths./pets.get.responses.200.content.application/json.schema.$ref',
      './schemas/pet.json',
    );
  });

  it('reports preparation without removing OAS 3.1 preview data', () => {
    const state = buildOpenApiViewState(oas31Document(), operation(), { status: 'loading' });

    expect(state).toMatchObject({
      status: 'ready',
      downloadable: false,
      notice: { kind: 'oas31-loading' },
    });
  });

  it('keeps newer unsupported versions previewable but not downloadable', () => {
    const document = { ...oas31Document(), openapi: '3.2.0' } as SwaggerDoc;
    const state = buildOpenApiViewState(document, operation(), { status: 'unavailable' });

    expect(state).toMatchObject({
      status: 'ready',
      downloadable: false,
      notice: { kind: 'version-unsupported' },
    });
  });
});
