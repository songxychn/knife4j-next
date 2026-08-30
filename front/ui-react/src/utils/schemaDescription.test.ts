import { describe, expect, it } from 'vitest';
import type { SwaggerDoc } from '../types/swagger';
import { buildSchemaDescriptionMap } from './schemaDescription';

describe('buildSchemaDescriptionMap OAS 3.1 refs', () => {
  it('resolves nested $defs pointers and applies Schema Object $ref siblings', () => {
    const doc = {
      openapi: '3.1.2',
      info: { title: 'Descriptions', version: '1' },
      paths: {},
      components: {
        schemas: {
          Wrapper: {
            $defs: {
              Label: { type: 'string', description: 'base label' },
            },
          },
        },
      },
    } as SwaggerDoc;

    const descriptions = buildSchemaDescriptionMap(
      {
        type: 'object',
        properties: {
          label: {
            $ref: '#/components/schemas/Wrapper/$defs/Label',
            description: 'use-site label',
          },
        },
      },
      doc,
    );

    expect(descriptions.get('label')).toBe('use-site label');
  });

  it('keeps OAS 3.0 Reference Object sibling behavior unchanged', () => {
    const doc = {
      openapi: '3.0.4',
      info: { title: 'Descriptions', version: '1' },
      paths: {},
      components: { schemas: { Label: { type: 'string', description: 'base label' } } },
    } as SwaggerDoc;

    const descriptions = buildSchemaDescriptionMap(
      {
        type: 'object',
        properties: {
          label: { $ref: '#/components/schemas/Label', description: 'ignored sibling' },
        },
      },
      doc,
    );

    expect(descriptions.get('label')).toBe('base label');
  });

  it('preserves target descriptions when a sibling adds constraints to the same property', () => {
    const doc = {
      openapi: '3.1.2',
      info: { title: 'Descriptions', version: '1' },
      paths: {},
      components: {
        schemas: {
          Base: {
            type: 'object',
            properties: { value: { type: 'string', description: 'base value' } },
          },
        },
      },
    } as SwaggerDoc;

    const descriptions = buildSchemaDescriptionMap(
      {
        $ref: '#/components/schemas/Base',
        properties: { value: { minLength: 2 } },
      },
      doc,
    );

    expect(descriptions.get('value')).toBe('base value');
  });
});
