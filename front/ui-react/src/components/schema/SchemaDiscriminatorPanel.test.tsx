import { describe, expect, test, vi } from 'vitest';
import { collectOas32DocumentDiagnostics } from 'knife4j-core';
import type { SwaggerDoc } from '../../types/swagger';
import { ExternalResourceLoader } from '../../schema/externalResourceGraph';
import { componentDiscriminatorLocation, describeSchemaDiscriminator } from '../../schema/schemaDiscriminatorView';

const { jsxFactory } = vi.hoisted(() => ({
  jsxFactory: (type: unknown, props: Record<string, unknown>) => ({ type, props }),
}));
vi.mock('react/jsx-runtime', () => ({ jsx: jsxFactory, jsxs: jsxFactory, jsxDEV: jsxFactory, Fragment: 'Fragment' }));
vi.mock('react/jsx-dev-runtime', () => ({ jsxDEV: jsxFactory, Fragment: 'Fragment' }));
vi.mock('antd', () => ({
  Alert: 'Alert',
  Button: 'Button',
  Select: 'Select',
  Space: 'Space',
  Typography: { Text: 'Text' },
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../../pages/api/CodeBlock', () => ({ default: 'CodeBlock' }));
vi.mock('./SchemaFieldTable', () => ({ SchemaTypeLink: 'SchemaTypeLink' }));

import SchemaDiscriminatorPanel from './SchemaDiscriminatorPanel';

const uri = 'https://retrieval.example/entry.json';
const libraryUri = 'https://retrieval.example/library.json';

interface Element {
  type: unknown;
  props: Record<string, unknown>;
}

function elements(value: unknown): Element[] {
  if (Array.isArray(value)) return value.flatMap(elements);
  if (value === null || typeof value !== 'object' || !('type' in value) || !('props' in value)) return [];
  const element = value as Element;
  return [element, ...Object.values(element.props).flatMap(elements)];
}

describe('SchemaDiscriminatorPanel', () => {
  test('previews external same-name targets in place and keeps entry models on the model route', () => {
    const document = {
      openapi: '3.2.0',
      info: { title: 'Discriminator panel', version: '1' },
      components: {
        schemas: {
          Payload: {
            type: 'object',
            oneOf: [
              { $ref: `${libraryUri}#/components/schemas/Known` },
              { $ref: '#/components/schemas/Known' },
              { $ref: '#/components/schemas/Other' },
            ],
            discriminator: {
              propertyName: 'kind',
              mapping: { external: `${libraryUri}#/components/schemas/Known`, local: 'Known' },
              defaultMapping: 'Other',
            },
          },
          Known: { type: 'object', properties: { kind: { const: 'local' } } },
          Other: { type: 'object' },
        },
      },
    } as SwaggerDoc;
    expect(collectOas32DocumentDiagnostics(document)).toEqual([]);
    const snapshot = new ExternalResourceLoader(document, uri).currentSnapshot();
    const metadata = describeSchemaDiscriminator(snapshot, componentDiscriminatorLocation(uri, 'Payload'));
    const tree = SchemaDiscriminatorPanel({ metadata, operationToken: 'payload' });
    const nodes = elements(tree);
    expect(nodes.some((node) => node.props['data-discriminator-preview'] === 'external')).toBe(true);
    expect(nodes.some((node) => node.props['data-discriminator-preview'] === 'model')).toBe(true);
    const links = nodes.filter((node) => node.type === 'SchemaTypeLink');
    expect(links.every((link) => (link.props.node as { refName?: string }).refName !== undefined)).toBe(true);
    expect(links.some((link) => (link.props.node as { refName?: string }).refName === 'Known')).toBe(true);
  });

  test('hides the panel for OAS 3.1 documents', () => {
    const document = {
      openapi: '3.1.0',
      info: { title: 'OAS 3.1 discriminator regression', version: '1' },
      components: {
        schemas: {
          Payload: {
            discriminator: { propertyName: 'kind', mapping: { known: 'Known' } },
            oneOf: [{ $ref: '#/components/schemas/Known' }],
          },
          Known: { type: 'object' },
        },
      },
    } as SwaggerDoc;
    const snapshot = new ExternalResourceLoader(document, uri).currentSnapshot();
    const metadata = describeSchemaDiscriminator(snapshot, componentDiscriminatorLocation(uri, 'Payload'));
    expect(SchemaDiscriminatorPanel({ metadata, operationToken: 'payload' })).toBeNull();
  });

  test('does not pretend-select the first overlapping branch or enable generate until chosen', () => {
    const document = {
      openapi: '3.2.0',
      info: { title: 'Overlapping oneOf', version: '1' },
      components: {
        schemas: {
          Payload: {
            type: 'object',
            required: ['kind', 'side'],
            oneOf: [
              { $ref: '#/components/schemas/Known', required: ['side'], properties: { side: { const: 'left' } } },
              { $ref: '#/components/schemas/Known', required: ['side'], properties: { side: { const: 'right' } } },
            ],
            discriminator: { propertyName: 'kind', mapping: { known: 'Known' } },
          },
          Known: { type: 'object', required: ['kind'], properties: { kind: { const: 'known' } } },
        },
      },
    } as SwaggerDoc;
    expect(collectOas32DocumentDiagnostics(document)).toEqual([]);
    const snapshot = new ExternalResourceLoader(document, uri).currentSnapshot();
    const metadata = describeSchemaDiscriminator(snapshot, componentDiscriminatorLocation(uri, 'Payload'));
    const tree = SchemaDiscriminatorPanel({
      metadata,
      snapshot,
      session: { token: 'session' } as never,
      operationToken: 'payload',
    });
    const nodes = elements(tree);
    const select = nodes.find((node) => node.type === 'Select');
    const options = select?.props.options as Array<{ value: string }> | undefined;
    expect(select?.props.value).toBeUndefined();
    expect(options?.length).toBeGreaterThan(1);
    expect(options?.[0]?.value).toEqual(expect.any(String));
    expect(nodes.find((node) => node.props['data-discriminator-generate'] === 'explicit')?.props.disabled).toBe(true);
  });
});
