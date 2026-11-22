import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { collectOas32DocumentDiagnostics } from 'knife4j-core';
import type { SwaggerDoc } from '../../types/swagger';
import { ExternalResourceLoader } from '../../schema/externalResourceGraph';
import { componentDiscriminatorLocation, describeSchemaDiscriminator } from '../../schema/schemaDiscriminatorView';

import { createReactTestRoot } from '../../test/reactTestRoot';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('./SchemaFieldTable', () => ({
  SchemaTypeLink: ({ node }: { node: { refName?: string } }) => (
    <span data-model-link={node.refName}>{node.refName}</span>
  ),
}));

import SchemaDiscriminatorPanel from './SchemaDiscriminatorPanel';

let view: ReturnType<typeof createReactTestRoot>;
beforeEach(() => {
  view = createReactTestRoot();
});
afterEach(async () => {
  await view.unmount();
});

const uri = 'https://retrieval.example/entry.json';
const libraryUri = 'https://retrieval.example/library.json';

describe('SchemaDiscriminatorPanel', () => {
  test('previews external same-name targets in place and keeps entry models on the model route', async () => {
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
    await view.render(<SchemaDiscriminatorPanel metadata={metadata} operationToken="payload" />);
    const external = view.container.querySelector('[data-discriminator-preview="external"]');
    expect(external?.textContent).toContain('schema.discriminator.preview.external');
    expect(external?.querySelector('[data-model-link]')).toBeNull();
    const models = [...view.container.querySelectorAll('[data-discriminator-preview="model"] [data-model-link]')];
    expect(models.map((model) => model.textContent)).toContain('Known');
  });

  test('hides the panel for OAS 3.1 documents', async () => {
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
    await view.render(<SchemaDiscriminatorPanel metadata={metadata} operationToken="payload" />);
    expect(view.container.childElementCount).toBe(0);
  });

  test('does not pretend-select the first overlapping branch or enable generate until chosen', async () => {
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
    await view.render(
      <SchemaDiscriminatorPanel
        metadata={metadata}
        snapshot={snapshot}
        session={{ token: 'session' } as never}
        operationToken="payload"
      />,
    );
    expect(view.container.querySelectorAll('[role="combobox"]').length).toBeGreaterThan(0);
    expect(view.container.textContent).toContain('schema.discriminator.generate.ambiguous');
    expect(
      view.container.querySelector<HTMLButtonElement>('button[data-discriminator-generate="explicit"]')?.disabled,
    ).toBe(true);
  });
});
