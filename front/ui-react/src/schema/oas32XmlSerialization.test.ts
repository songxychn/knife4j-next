import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { afterAll, afterEach, describe, expect, test, vi } from 'vitest';
import { collectOas32DocumentDiagnostics } from 'knife4j-core';
import type { SwaggerDoc } from '../types/swagger';
import {
  ExternalResourceLoader,
  schemaDocumentsFromResourceGraph,
  schemaRegistrationContextFromResourceGraph,
  type ResourceGraphSnapshot,
} from './externalResourceGraph';
import { createSchemaDocumentSession, type SchemaDocumentSession } from './schemaDocumentSession';
import {
  OAS32_XML_LIMITS,
  isOas32XmlVersion,
  serializeOas32Xml,
  type Oas32XmlSerializationOptions,
  type Oas32XmlSerializationResult,
} from './oas32XmlSerialization';
import { parseMenuTags } from '../api/knife4jClient';
import { evaluateOperationExample, locateOperationExampleCatalog } from './operationExampleCatalog';
import { sha256Hex } from '../utils/stableJson';

const uri = 'https://retrieval.example/xml.json';
const sessions: SchemaDocumentSession[] = [];
const loaders: ExternalResourceLoader[] = [];
const validDocuments: unknown[] = [];
afterEach(() => {
  sessions.splice(0).forEach((session) => session.dispose());
  loaders.splice(0).forEach((loader) => loader.dispose());
  vi.restoreAllMocks();
});
afterAll(() => {
  // Optional local evidence export; CI does not require a downloaded validator or write any artifact.
  if (process.env.OAS32_XML_FIXTURES) writeFileSync(process.env.OAS32_XML_FIXTURES, JSON.stringify(validDocuments));
});
function documentFor(schemas: Record<string, unknown>, openapi = '3.2.0'): SwaggerDoc {
  return { openapi, info: { title: 'Synthetic XML contract', version: '1' }, components: { schemas } } as SwaggerDoc;
}
async function sessionFor(document: SwaggerDoc, snapshot: ResourceGraphSnapshot) {
  // Hyperjump's registry permits only one active engine per realm.
  sessions.splice(0).forEach((session) => session.dispose());
  const session = await createSchemaDocumentSession(document, uri, {
    registrationContext: schemaRegistrationContextFromResourceGraph(snapshot, uri),
    resourceDocuments: schemaDocumentsFromResourceGraph(snapshot),
  });
  sessions.push(session);
  return session;
}
async function fixture(
  schema: unknown,
  options: { schemas?: Record<string, unknown>; document?: SwaggerDoc; invalid?: boolean; openapi?: string } = {},
) {
  const document = options.document ?? documentFor({ Root: schema, ...options.schemas }, options.openapi);
  if (!options.invalid) {
    expect(collectOas32DocumentDiagnostics(document)).toEqual([]);
    validDocuments.push(document);
  }
  const loader = new ExternalResourceLoader(document, uri);
  loaders.push(loader);
  const snapshot = loader.currentSnapshot();
  const session = await sessionFor(document, snapshot);
  const schemaLocation = snapshot.objectLocations.find(
    (location) => location.pointer === '#/components/schemas/Root' && location.kind === 'schema',
  )!;
  const run = (value: unknown, overrides: Partial<Oas32XmlSerializationOptions> = {}) =>
    serializeOas32Xml({
      snapshot,
      session,
      schemaLocation,
      data: { kind: 'known', source: 'author', value },
      ...overrides,
    });
  return { document, loader, snapshot, session, schemaLocation, run };
}
function output(result: Oas32XmlSerializationResult) {
  expect(['document', 'fragment'], JSON.stringify(result.diagnostics)).toContain(result.status);
  if (result.status !== 'document' && result.status !== 'fragment') throw new Error('Expected XML output');
  return result;
}
function unavailable(result: Oas32XmlSerializationResult, code: string) {
  expect(result.status).toBe('unavailable');
  expect(result).not.toHaveProperty('xml');
  expect(result).not.toHaveProperty('valid');
  expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(code);
}
interface ParsedXml {
  tag: string;
  attributes: Record<string, string>;
  text: string;
  children: ParsedXml[];
  tail: string;
}
function parseXml(xml: string): ParsedXml {
  // Python's standard ElementTree/Expat parser. Only synthetic generated strings are supplied.
  // Reject DTD/entities before parsing: this test harness grants no network/file entity capability.
  const script = `import json, re, sys, xml.etree.ElementTree as ET
s = sys.stdin.read()
if re.search(r'<!\\s*(DOCTYPE|ENTITY)', s, re.I): raise ValueError('DTD/entities forbidden')
def node(e): return {'tag': e.tag, 'attributes': e.attrib, 'text': e.text or '', 'children': [node(c) for c in e], 'tail': e.tail or ''}
print(json.dumps(node(ET.fromstring(s)), ensure_ascii=False))`;
  return JSON.parse(
    execFileSync('python3', ['-c', script], {
      input: xml,
      encoding: 'utf8',
      maxBuffer: 2 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    }),
  );
}

describe('OAS 3.2 XML serialization of known logical data', () => {
  test.each(['3.2.0', '3.2.99'])('serializes the actual registered component in %s', async (openapi) => {
    const document = {
      openapi,
      info: { title: 'Synthetic XML contract', version: '1' },
      components: { schemas: { Greeting: { type: 'string' } } },
    } as SwaggerDoc;
    expect(collectOas32DocumentDiagnostics(document)).toEqual([]);
    const loader = new ExternalResourceLoader(document, uri);
    const snapshot = loader.currentSnapshot();
    const session = await createSchemaDocumentSession(document, uri, {
      registrationContext: schemaRegistrationContextFromResourceGraph(snapshot, uri),
    });
    sessions.push(session);
    const schemaLocation = snapshot.objectLocations.find(
      (location) => location.pointer === '#/components/schemas/Greeting',
    )!;
    const result = await serializeOas32Xml({
      snapshot,
      session,
      schemaLocation,
      data: { kind: 'known', source: 'author', value: 'Hello & XML' },
    });
    expect(result).toMatchObject({ status: 'document', xml: '<Greeting>Hello &amp; XML</Greeting>' });
    expect(parseXml(output(result).xml)).toMatchObject({ tag: 'Greeting', text: 'Hello & XML' });
    validDocuments.push(document);
    loader.dispose();
  });

  test.each(['3.0.4', '3.1.1'])('leaves the legal %s XML path alone', async (openapi) => {
    const document = documentFor(
      {
        Root: {
          type: 'array',
          xml: { name: 'books', wrapped: true },
          items: { type: 'string', xml: { name: 'book' } },
        },
      },
      openapi,
    );
    expect(isOas32XmlVersion(document.openapi)).toBe(false);
    if (openapi === '3.0.4') {
      // C/D never activate for 3.0, so do not invent a 3.0 graph to test this gate.
      expect(() => new ExternalResourceLoader(document, uri)).toThrow(/3.1.x or 3.2.x/);
      return;
    }
    const loader = new ExternalResourceLoader(document, uri);
    loaders.push(loader);
    const resolve = vi.fn().mockRejectedValue(new Error('Legacy path must not call D'));
    const result = await serializeOas32Xml({
      snapshot: loader.currentSnapshot(),
      session: { resolve },
      schemaLocation: { ownerRetrievalUri: uri, pointer: '#/components/schemas/Root' },
      data: { kind: 'known', source: 'candidate', value: ['a'] },
    });
    expect(result.status).toBe('not-applicable');
    expect(resolve).not.toHaveBeenCalled();
  });

  test('keeps five node kinds and the controlled mixed-content order', async () => {
    const schema = {
      type: 'array',
      xml: { nodeType: 'element', name: 'message' },
      minItems: 4,
      maxItems: 4,
      prefixItems: [
        { type: 'string', xml: { nodeType: 'text', name: 'ignored <name>' } },
        {
          type: 'object',
          xml: { name: 'em' },
          properties: {
            id: { type: 'integer', xml: { nodeType: 'attribute' } },
            value: { type: 'string', xml: { nodeType: 'text' } },
          },
        },
        { type: 'string', xml: { nodeType: 'cdata', name: 'ignored' } },
        { type: 'object', xml: { nodeType: 'none', name: 'ignored' }, properties: { end: { type: 'string' } } },
      ],
      items: false,
    };
    const value = ['Before ', { id: 0, value: 'bold' }, ' <raw> ', { end: 'after' }];
    const f = await fixture(schema);
    expect((await f.session.evaluate('#/components/schemas/Root', value)).valid).toBe(true);
    const result = output(await f.run(value));
    expect(result.xml).toBe('<message>Before <em id="0">bold</em><![CDATA[ <raw> ]]><end>after</end></message>');
    expect(parseXml(result.xml)).toMatchObject({
      text: 'Before ',
      children: [
        { tag: 'em', attributes: { id: '0' }, text: 'bold', tail: ' <raw> ' },
        { tag: 'end', text: 'after' },
      ],
    });
    expect(new Set(result.provenance.map((source) => source.nodeType))).toEqual(
      new Set(['element', 'attribute', 'text', 'cdata', 'none']),
    );
    expect(result.objectOrder).toBe('lexicographic-property-name');
    expect((await f.session.evaluate('#/components/schemas/Root', value)).valid).toBe(true);
  });

  test('retains raw reference-site and target defaults instead of merging them', async () => {
    const f = await fixture(
      { $ref: '#/components/schemas/Pet' },
      { schemas: { Pet: { type: 'object', properties: { id: { type: 'integer' } } } } },
    );
    const result = output(await f.run({ id: 7 }));
    expect(result.xml).toBe('<Pet><id>7</id></Pet>');
    expect(result.provenance[0]).toMatchObject({
      nodeType: 'none',
      nodeTypeSource: 'reference-default',
      rawSchema: { $ref: '#/components/schemas/Pet' },
      referenceTarget: { ownerRetrievalUri: uri, pointer: '#/components/schemas/Pet' },
    });
    expect(result.provenance[1]).toMatchObject({
      nodeType: 'element',
      nameSource: 'component',
      schemaLocation: { ownerRetrievalUri: uri, pointer: '#/components/schemas/Pet' },
    });
  });
  test('explicit use-site wrappers and target none preserve children', async () => {
    const f = await fixture(
      { $ref: '#/components/schemas/Content', xml: { nodeType: 'element', name: 'StoredDocument' } },
      {
        schemas: {
          Content: {
            type: 'object',
            xml: { nodeType: 'none' },
            properties: { body: { type: 'string', xml: { nodeType: 'cdata' } } },
          },
        },
      },
    );
    const result = output(await f.run({ body: '<html/>' }));
    expect(result.xml).toBe('<StoredDocument><![CDATA[<html/>]]></StoredDocument>');
    expect(parseXml(result.xml).text).toBe('<html/>');
  });
  test('a property reference uses the target component name, without an alias or plural guess', async () => {
    const f = await fixture(
      { type: 'object', properties: { aliases: { $ref: '#/components/schemas/Person' } } },
      { schemas: { Person: { type: 'string', title: 'NotTheName' } } },
    );
    expect(output(await f.run({ aliases: 'A' })).xml).toBe('<Root><Person>A</Person></Root>');
  });

  test.each([
    [{ type: 'array', items: { type: 'string' } }, '<Root><books>a</books><books>b</books></Root>'],
    [
      { type: 'array', xml: { name: 'ignored' }, items: { type: 'string', xml: { name: 'book' } } },
      '<Root><book>a</book><book>b</book></Root>',
    ],
    [
      { type: 'array', xml: { nodeType: 'element', name: 'archive' }, items: { type: 'string' } },
      '<Root><archive><books>a</books><books>b</books></archive></Root>',
    ],
    [
      { type: 'array', xml: { wrapped: true, name: 'archive' }, items: { type: 'string', xml: { name: 'book' } } },
      '<Root><archive><book>a</book><book>b</book></archive></Root>',
    ],
    [
      { type: 'array', xml: { wrapped: false, name: 'ignored' }, items: { type: 'string' } },
      '<Root><books>a</books><books>b</books></Root>',
    ],
  ])('uses real property/item names for arrays: %j', async (books, expected) => {
    const f = await fixture({ type: 'object', properties: { books } });
    const result = output(await f.run({ books: ['a', 'b'] }));
    expect(result.xml).toBe(expected);
    expect(parseXml(result.xml).tag).toBe('Root');
    expect(
      result.provenance
        .filter((source) => source.nameSource === 'property-items')
        .every((source) => source.nameLocation?.pointer === '#/components/schemas/Root/properties/books'),
    ).toBe(true);
  });
  test('nested unwrapped arrays retain item order without inventing wrappers', async () => {
    const f = await fixture({
      type: 'object',
      properties: { rows: { type: 'array', items: { type: 'array', items: { type: 'string' } } } },
    });
    const result = output(await f.run({ rows: [['a', 'b'], ['c']] }));
    expect(result.roundTrip).toBe('ambiguous');
    expect(result.xml).toBe('<Root><rows>a</rows><rows>b</rows><rows>c</rows></Root>');
  });
  test('reports unnamed and multiroot outcomes separately', async () => {
    const f = await fixture({ type: 'array', items: { type: 'string', xml: { name: 'item' } } });
    const result = output(await f.run(['a', 'b']));
    expect(result.status).toBe('fragment');
    expect(result.xml).toBe('<item>a</item><item>b</item>');
    expect(parseXml(`<test>${result.xml}</test>`).children).toHaveLength(2);
    expect(output(await f.run([]))).toMatchObject({ status: 'fragment', xml: '', roundTrip: 'ambiguous' });
    const anonymous = await fixture({ type: 'array', title: 'NoName', items: { type: 'string' } });
    unavailable(await anonymous.run(['a']), 'NAME_REQUIRED');
  });
  test('inline media schemas and $defs do not infer names from title or URI tail', async () => {
    const document = {
      ...documentFor({
        Root: {
          $id: 'https://schemas.example/root-name',
          $defs: { Item: { title: 'PretendName', type: 'string' } },
          $ref: '#/$defs/Item',
        },
      }),
      paths: {
        '/xml': {
          post: {
            requestBody: { content: { 'application/xml': { schema: { title: 'PretendName', type: 'string' } } } },
            responses: { '204': { description: 'ok' } },
          },
        },
      },
    } as SwaggerDoc;
    const f = await fixture(undefined, { document });
    unavailable(await f.run('a'), 'NAME_REQUIRED');
    const schemaLocation = f.snapshot.objectLocations.find((location) =>
      location.pointer.endsWith('/application~1xml/schema'),
    )!;
    unavailable(await f.run('a', { schemaLocation }), 'NAME_REQUIRED');
  });

  test('unprefixed attributes stay outside the default namespace and prefixed attributes keep their expanded names', async () => {
    const f = await fixture({
      type: 'object',
      xml: { namespace: 'urn:文档#根' },
      properties: {
        id: { type: 'integer', xml: { nodeType: 'attribute' } },
        label: {
          type: 'string',
          xml: { nodeType: 'attribute', prefix: 'p', namespace: 'https://例子.example/路径#片段' },
        },
        child: { type: 'string' },
      },
    });
    const result = output(await f.run({ id: 0, label: '中', child: 'text' }));
    expect(parseXml(result.xml)).toMatchObject({
      tag: '{urn:文档#根}Root',
      attributes: { id: '0', '{https://例子.example/路径#片段}label': '中' },
      children: [{ tag: '{urn:文档#根}child', text: 'text' }],
    });
    expect(result.xml).toContain('xmlns="urn:文档#根"');
    expect(result.nodes[0]).toMatchObject({ name: { namespace: 'urn:文档#根' } });
  });
  test.each([
    'urn:test:value',
    'https://例子.example/命名#fragment',
    "urn:quoted:a&b'c",
    'https://example.test/?q=\ue001',
    'urn:ns:🙂',
  ])('preserves valid non-relative namespace IRI %s', async (namespace) => {
    const f = await fixture({ type: 'string', xml: { namespace, prefix: 'p' } });
    const result = output(await f.run('x'));
    expect(parseXml(result.xml).tag).toBe(`{${namespace}}Root`);
    expect(result.xml).not.toContain('%E');
  });
  test('scoped prefix rebinding is legal and reported', async () => {
    const f = await fixture({
      type: 'object',
      xml: { namespace: 'urn:outer', prefix: 'p' },
      properties: { child: { type: 'string', xml: { namespace: 'urn:inner', prefix: 'p' } } },
    });
    const result = output(await f.run({ child: 'x' }));
    expect(parseXml(result.xml)).toMatchObject({ tag: '{urn:outer}Root', children: [{ tag: '{urn:inner}child' }] });
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain('NAMESPACE_REBOUND');
  });
  test('namespace declarations for attributes do not depend on data insertion order', async () => {
    const f = await fixture({
      type: 'object',
      properties: {
        a: { type: 'string', xml: { nodeType: 'attribute', prefix: 'p' } },
        z: { type: 'string', xml: { nodeType: 'attribute', namespace: 'urn:p', prefix: 'p' } },
      },
    });
    expect(parseXml(output(await f.run({ z: 'z', a: 'a' })).xml).attributes).toEqual({
      '{urn:p}a': 'a',
      '{urn:p}z': 'z',
    });
  });
  test.each([
    [{ prefix: 'p' }, 'UNBOUND_PREFIX'],
    [{ prefix: 'xml', namespace: 'urn:wrong' }, 'RESERVED_NAMESPACE'],
    [{ prefix: 'xmlns', namespace: 'urn:wrong' }, 'RESERVED_NAMESPACE'],
    [{ namespace: 'http://www.w3.org/2000/xmlns/' }, 'RESERVED_NAMESPACE'],
    [{ namespace: 'http://www.w3.org/XML/1998/namespace' }, 'RESERVED_NAMESPACE'],
    [{ name: 'evil" attr="x' }, 'INVALID_XML_NAME'],
    [{ name: 'a:b:c' }, 'INVALID_XML_NAME'],
    [{ name: 'p:a', prefix: 'q', namespace: 'urn:p' }, 'INVALID_XML_NAME'],
    [{ name: '1Root' }, 'INVALID_XML_NAME'],
    [{ name: '\u0301a' }, 'INVALID_XML_NAME'],
    [{ prefix: 'p:q', namespace: 'urn:p' }, 'INVALID_XML_NAME'],
    [{ namespace: '../relative' }, 'INVALID_NAMESPACE_IRI'],
    [{ namespace: 'urn:bad%xy' }, 'INVALID_NAMESPACE_IRI'],
    [{ namespace: 'https://example.test/"inject' }, 'INVALID_NAMESPACE_IRI'],
    [{ namespace: 'urn:bad\n' }, 'INVALID_NAMESPACE_IRI'],
    [{ namespace: 'urn:private:\ue000' }, 'INVALID_NAMESPACE_IRI'],
    [{ namespace: 'urn:x#\ue000' }, 'INVALID_NAMESPACE_IRI'],
    [{ namespace: 'urn:bad:\uffff' }, 'INVALID_XML_CHARACTER'],
  ])('rejects malformed/reserved XML metadata %j', async (xml, code) => {
    const f = await fixture({ type: 'string', xml }, { invalid: true });
    unavailable(await f.run('x'), code);
  });
  test('honors predefined xml binding and qualified names', async () => {
    const f = await fixture({
      type: 'object',
      xml: { name: 'p:文档', prefix: 'p', namespace: 'urn:docs' },
      properties: { language: { type: 'string', xml: { name: 'xml:lang', nodeType: 'attribute' } } },
    });
    const result = output(await f.run({ language: 'zh' }));
    expect(parseXml(result.xml)).toMatchObject({
      tag: '{urn:docs}文档',
      attributes: { '{http://www.w3.org/XML/1998/namespace}lang': 'zh' },
    });
    expect(result.xml).not.toContain('xmlns:xml=');
  });
  test.each([
    [{ name: 'xmlns', nodeType: 'attribute' }, 'RESERVED_NAMESPACE'],
    [{ nodeType: 'attribute', namespace: 'urn:attr' }, 'ATTRIBUTE_NAMESPACE_REQUIRES_PREFIX'],
  ])('rejects attribute namespace misuse %j', async (xml, code) => {
    const f = await fixture({ type: 'object', properties: { bad: { type: 'string', xml } } });
    unavailable(await f.run({ bad: 'x' }), code);
  });
  test('rejects same-element prefix conflicts and duplicate expanded attribute names', async () => {
    const conflicting = await fixture({
      type: 'object',
      xml: { prefix: 'p', namespace: 'urn:one' },
      properties: { attr: { type: 'string', xml: { nodeType: 'attribute', prefix: 'p', namespace: 'urn:two' } } },
    });
    unavailable(await conflicting.run({ attr: 'x' }), 'NAMESPACE_CONFLICT');
    const duplicate = await fixture({
      type: 'object',
      properties: {
        a: { type: 'string', xml: { nodeType: 'attribute', name: 'id', prefix: 'a', namespace: 'urn:same' } },
        b: { type: 'string', xml: { nodeType: 'attribute', name: 'id', prefix: 'b', namespace: 'urn:same' } },
      },
    });
    unavailable(await duplicate.run({ a: '1', b: '2' }), 'DUPLICATE_ATTRIBUTE');
    const orphan = await fixture({ type: 'string', xml: { nodeType: 'attribute' } });
    unavailable(await orphan.run('x'), 'ATTRIBUTE_WITHOUT_ELEMENT');
  });

  test('standard XML parsing preserves escaped scalar content and CDATA terminators/CR', async () => {
    const text = 'A & < > " \'\r\n\t中文🙂 ]]> end';
    const f = await fixture({
      type: 'object',
      properties: {
        a: { type: 'string', xml: { nodeType: 'attribute' } },
        c: { type: 'string', xml: { nodeType: 'cdata' } },
        t: { type: 'string' },
      },
    });
    const result = output(await f.run({ a: text, c: text, t: text }));
    const parsed = parseXml(result.xml);
    expect(parsed.attributes.a).toBe(text);
    expect(parsed.text).toBe(text);
    expect(parsed.children[0].text).toBe(text);
    expect(result.xml).toContain(']]]]><![CDATA[>');
    expect(result.xml).toContain('&#xD;');
    expect(result.xml).toContain('&#xA;');
    expect(result.xml).toContain('&#x9;');
  });
  test.each(['\u0000', '\u0001', '\u000b', '\ud800', '\udfff', '\ufffe', '\uffff'])(
    'rejects invalid XML characters %j without replacement',
    async (value) => {
      const f = await fixture({ type: 'string' });
      unavailable(await f.run(value), 'INVALID_XML_CHARACTER');
    },
  );
  test.each([
    ['string', '', ''],
    ['boolean', false, 'false'],
    ['integer', 0, '0'],
    ['number', 1.25, '1.25'],
    ['number', 1e-7, '1e-7'],
  ])('serializes scalar %s/%j using explicit JSON text', async (type, value, text) => {
    const f = await fixture({ type });
    expect(parseXml(output(await f.run(value)).xml).text).toBe(text);
  });
  test('nil elements and omitted null attributes have explicit, separate semantics', async () => {
    const f = await fixture({
      type: 'object',
      properties: {
        element: { type: 'null' },
        attribute: { type: ['string', 'null'], xml: { nodeType: 'attribute' } },
        text: { type: 'null', xml: { nodeType: 'text' } },
        cdata: { type: 'null', xml: { nodeType: 'cdata' } },
      },
    });
    const data = { element: null, attribute: null, text: null, cdata: null };
    expect((await f.session.evaluate('#/components/schemas/Root', data)).valid).toBe(true);
    const result = output(await f.run(data));
    const parsed = parseXml(result.xml);
    expect(parsed.attributes).toEqual({});
    expect(parsed.children[0]).toMatchObject({
      tag: 'element',
      attributes: { '{http://www.w3.org/2001/XMLSchema-instance}nil': 'true' },
      text: '',
    });
    expect(result.roundTrip).toBe('ambiguous');
    expect(result.xml).toContain('xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"');
  });
  test('a nil element cannot silently rebind its own xsi prefix', async () => {
    const f = await fixture({ type: 'null', xml: { prefix: 'xsi', namespace: 'urn:wrong' } });
    unavailable(await f.run(null), 'NAMESPACE_CONFLICT');
  });
  test.each([
    [{ type: 'object' }, {}, '<Root/>'],
    [{ type: 'array', xml: { nodeType: 'element' }, items: { type: 'string', xml: { name: 'item' } } }, [], '<Root/>'],
    [{ type: 'null' }, null, '<Root xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:nil="true"/>'],
  ])('distinguishes empty and null containers %j', async (schema, value, xml) => {
    const f = await fixture(schema);
    expect(output(await f.run(value)).xml).toBe(xml);
    expect(parseXml(xml).tag).toBe('Root');
  });
  test.each(['attribute', 'text', 'cdata'])('does not JSON.stringify complex %s content', async (nodeType) => {
    const f = await fixture({ type: 'object', xml: { nodeType }, properties: { x: { type: 'string' } } });
    unavailable(await f.run({ x: 'y' }), 'COMPLEX_TEXT_VALUE');
  });
  test('none forwards object/array children but never discards a bare scalar', async () => {
    const f = await fixture({ type: 'string', xml: { nodeType: 'none', name: 'ignored' } });
    unavailable(await f.run('lost'), 'UNMAPPED_DATA');
  });
  test.each([Infinity, -Infinity, NaN, Number.MAX_SAFE_INTEGER + 1, undefined, 1n, new Date(0)])(
    'rejects non-JSON or unsafe logical data %s',
    async (value) => {
      const f = await fixture({});
      unavailable(await f.run(value), 'INVALID_DATA');
    },
  );
  test('detects nonunique adjacent text and different properties sharing one element name', async () => {
    const f = await fixture({
      type: 'object',
      properties: {
        a: { type: 'string', xml: { nodeType: 'text' } },
        b: { type: 'string', xml: { nodeType: 'text' } },
        x: { type: 'string', xml: { name: 'same' } },
        y: { type: 'string', xml: { name: 'same' } },
      },
    });
    const result = output(await f.run({ b: 'B', a: 'A', y: 'Y', x: 'X' }));
    expect(result.xml).toBe('<Root>AB<same>X</same><same>Y</same></Root>');
    expect(result.roundTrip).toBe('ambiguous');
    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === 'ROUND_TRIP_AMBIGUOUS')).toHaveLength(2);
  });
  test('round-trips a defined scalar object subset through a standard parser, without claiming a generic decoder', async () => {
    const f = await fixture({
      type: 'object',
      required: ['id', 'ok', 'value'],
      additionalProperties: false,
      properties: {
        id: { type: 'integer', xml: { nodeType: 'attribute' } },
        ok: { type: 'boolean' },
        value: { type: 'string' },
      },
    });
    const data = { id: 3, ok: false, value: '<A>\r\n&B' };
    const result = output(await f.run(data));
    const parsed = parseXml(result.xml);
    const decoded = {
      id: Number(parsed.attributes.id),
      ok: parsed.children[0].text === 'true',
      value: parsed.children[1].text,
    };
    expect(decoded).toEqual(data);
    expect((await f.session.evaluate('#/components/schemas/Root', decoded)).valid).toBe(true);
    expect(result.roundTrip).toBe('unverified');
  });
  test.each([
    { nodeType: 'element', attribute: false },
    { nodeType: 'none', wrapped: false },
    { nodeType: 'unknown' },
    { wrapped: true },
    { mystery: 'declaration' },
  ])('diagnoses invalid XML declarations by presence %j', async (xml) => {
    const f = await fixture({ type: 'string', xml }, { invalid: true });
    unavailable(await f.run('x'), 'mystery' in xml ? 'UNKNOWN_XML_DECLARATION' : 'INVALID_XML_DECLARATION');
  });
  test('supports legal deprecated attribute fields and ignores opaque XML extensions', async () => {
    const f = await fixture({
      type: 'object',
      properties: {
        id: {
          type: 'integer',
          xml: { attribute: true, 'x-extra': { nodeType: 'cdata', $ref: 'https://never.example/' } },
        },
        normal: { type: 'string', xml: { attribute: false } },
      },
    });
    expect(output(await f.run({ normal: 'N', id: 1 })).xml).toBe('<Root id="1"><normal>N</normal></Root>');
  });

  test('handles finite recursive data and reports a same-instance reference cycle', async () => {
    const f = await fixture({
      type: 'object',
      properties: { value: { type: 'string' }, child: { $ref: '#/components/schemas/Root' } },
    });
    expect(output(await f.run({ value: 'one', child: { value: 'two' } })).xml).toBe(
      '<Root><Root><value>two</value></Root><value>one</value></Root>',
    );
    const cycle = await fixture(
      { $ref: '#/components/schemas/Again' },
      { schemas: { Again: { $ref: '#/components/schemas/Root' } } },
    );
    unavailable(await cycle.run('x'), 'REFERENCE_CYCLE');
  });
  test('resolves $dynamicRef only through actual registered C/D scope anchors', async () => {
    const f = await fixture(
      {
        $id: 'https://schema.example/outer',
        $dynamicAnchor: 'node',
        xml: { nodeType: 'none' },
        type: 'object',
        properties: { text: { type: 'string', xml: { name: 'outer' } } },
      },
      {
        schemas: {
          Base: { $id: 'https://schema.example/base', $dynamicAnchor: 'node', type: 'string', xml: { name: 'base' } },
          Use: { $dynamicRef: 'https://schema.example/base#node' },
        },
      },
    );
    const use = f.snapshot.objectLocations.find((location) => location.pointer === '#/components/schemas/Use')!;
    const dynamic = output(await f.run({ text: 'x' }, { schemaLocation: use, dynamicScope: [f.schemaLocation] }));
    expect(dynamic.xml).toBe('<outer>x</outer>');
    expect(dynamic.provenance[0].referenceTarget?.pointer).toBe('#/components/schemas/Root');
    expect(output(await f.run('x', { schemaLocation: use })).xml).toBe('<base>x</base>');
  });
  test('static anchor references do not select a same-named dynamic anchor', async () => {
    const f = await fixture(
      { $id: 'https://schema.example/outer', $dynamicAnchor: 'node', xml: { name: 'outer' }, type: 'string' },
      {
        schemas: {
          Base: { $id: 'https://schema.example/base', $anchor: 'node', type: 'string', xml: { name: 'base' } },
          Use: { $dynamicRef: 'https://schema.example/base#node' },
        },
      },
    );
    const use = f.snapshot.objectLocations.find((location) => location.pointer === '#/components/schemas/Use')!;
    expect(output(await f.run('x', { schemaLocation: use, dynamicScope: [f.schemaLocation] })).xml).toBe(
      '<base>x</base>',
    );
  });
  test('derives dynamic scope along a real nested reference path without an injected override', async () => {
    const f = await fixture(
      {
        $id: 'https://schema.example/outer',
        $dynamicAnchor: 'node',
        type: 'object',
        xml: { nodeType: 'none' },
        properties: {
          text: { type: 'string', xml: { name: 'outerText' } },
          child: { $ref: 'https://schema.example/base#/$defs/Use' },
        },
      },
      {
        schemas: {
          Base: {
            $id: 'https://schema.example/base',
            $dynamicAnchor: 'node',
            type: 'string',
            xml: { name: 'baseText' },
            $defs: { Use: { $dynamicRef: '#node' } },
          },
        },
      },
    );
    const data = { child: { text: 'outer scope' } };
    expect((await f.session.evaluate('#/components/schemas/Root', data)).valid).toBe(true);
    const result = output(await f.run(data));
    expect(result.xml).toBe('<outerText>outer scope</outerText>');
    expect(result.provenance.find((source) => source.schemaLocation.pointer.endsWith('/$defs/Use'))).toMatchObject({
      referenceTarget: { ownerRetrievalUri: uri, pointer: '#/components/schemas/Root' },
    });
    const base = f.snapshot.objectLocations.find((location) => location.pointer.endsWith('/Base/$defs/Use'))!;
    expect(output(await f.run('static fallback', { schemaLocation: base })).xml).toBe(
      '<baseText>static fallback</baseText>',
    );
  });
  test('uses loaded physical owners across $self, fragments and embedded $id with zero serializer fetches', async () => {
    const externalUri = 'https://logical.example/library.json';
    const document = {
      ...documentFor({ Root: { $ref: './library.json#/components/schemas/Envelope' } }),
      $self: 'https://logical.example/openapi.json#identity',
    } as SwaggerDoc;
    const external = documentFor({
      Envelope: { $ref: 'urn:source:Value' },
      Value: { $id: 'urn:source:Value', type: 'object', properties: { text: { type: 'string' } } },
    });
    validDocuments.push(document, external);
    expect(collectOas32DocumentDiagnostics(document)).toEqual([]);
    expect(collectOas32DocumentDiagnostics(external)).toEqual([]);
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify(external), { headers: { 'content-type': 'application/json' } }),
    );
    const loader = new ExternalResourceLoader(document, uri, { fetchImpl, pageUri: uri });
    loaders.push(loader);
    const snapshot = await loader.load([
      { scope: 'generation', documentScope: loader.documentScope, resourceKey: sha256Hex(externalUri) },
    ]);
    expect(snapshot.complete).toBe(true);
    const session = await sessionFor(document, snapshot);
    const schemaLocation = snapshot.objectLocations.find(
      (location) => location.pointer === '#/components/schemas/Root',
    )!;
    const before = JSON.stringify([...snapshot.nodes]);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('No network during serialization'));
    const result = output(
      await serializeOas32Xml({
        snapshot,
        session,
        schemaLocation,
        data: { kind: 'known', source: 'candidate', value: { text: 'X' } },
      }),
    );
    expect(result.xml).toBe('<Value><text>X</text></Value>');
    expect(result.provenance[2]).toMatchObject({
      resourceUri: 'urn:source:Value',
      schemaLocation: { ownerRetrievalUri: externalUri, pointer: '#/components/schemas/Value' },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(JSON.stringify([...snapshot.nodes])).toBe(before);
  });
  test('missing, wrong-kind and ambiguous reference contexts are unavailable without fetching', async () => {
    const f = await fixture({ $ref: 'https://never.example/missing.xml' });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('No network'));
    unavailable(await f.run('x'), 'REFERENCE_UNAVAILABLE');
    const two = await fixture(
      { $ref: '#/components/schemas/Value', $dynamicRef: '#/components/schemas/Value' },
      { schemas: { Value: { type: 'string' } } },
    );
    unavailable(await two.run('x'), 'AMBIGUOUS_MAPPING');
    const overlap = await fixture(
      { $ref: '#/components/schemas/Value', properties: { x: { type: 'string' } } },
      { schemas: { Value: { type: 'object' } } },
    );
    unavailable(await overlap.run({ x: 'x' }), 'AMBIGUOUS_MAPPING');
    const wrongDocument = documentFor({ Root: { $ref: '#/components/examples/Opaque' } });
    wrongDocument.components!.examples = { Opaque: { dataValue: { type: 'string', xml: { name: 'fake' } } } };
    const wrongKind = await fixture(undefined, { document: wrongDocument });
    unavailable(await wrongKind.run('x'), 'REFERENCE_UNAVAILABLE');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  test('reports composition and boolean mapping boundaries without changing JSON Schema validity', async () => {
    const f = await fixture({ oneOf: [{ type: 'integer' }, { type: 'string' }] });
    expect((await f.session.evaluate('#/components/schemas/Root', 'x')).valid).toBe(true);
    unavailable(await f.run('x'), 'UNSUPPORTED_MAPPING');
    expect((await f.session.evaluate('#/components/schemas/Root', 'x')).valid).toBe(true);
    const boolean = await fixture(true);
    unavailable(await boolean.run('x'), 'UNSUPPORTED_MAPPING');
  });
  test.each([
    ['allOf', { allOf: [{ type: 'string' }] }, 'x'],
    ['anyOf', { anyOf: [{ const: 'x' }, { const: 'y' }] }, 'x'],
    ['oneOf', { oneOf: [{ type: 'string' }, { type: 'integer' }] }, 'x'],
    ['conditional', { if: { type: 'string' }, then: { minLength: 1 }, else: { type: 'integer' } }, 'x'],
    [
      'dependentSchemas',
      { type: 'object', dependentSchemas: { x: { required: ['x'] } }, properties: { x: { type: 'string' } } },
      { x: 'x' },
    ],
  ])(
    'classifies valid %s as a phase implementation boundary, not an invalid or ambiguous Schema',
    async (_label, schema, data) => {
      const f = await fixture(schema);
      expect((await f.session.evaluate('#/components/schemas/Root', data)).valid).toBe(true);
      const result = await f.run(data);
      unavailable(result, 'UNSUPPORTED_MAPPING');
      expect(result.diagnostics[0].message).toContain('not implemented');
      expect((await f.session.evaluate('#/components/schemas/Root', data)).valid).toBe(true);
    },
  );
  test('does not consume fake xml/$ref in data, examples, extensions or unknown annotations', async () => {
    const fake = { xml: { nodeType: 'attribute' }, $ref: 'https://never.example/fake' };
    const f = await fixture({
      type: 'object',
      examples: [fake],
      dataValue: fake,
      unknownAnnotation: fake,
      'x-data': fake,
      properties: { xml: { type: 'string' }, $ref: { type: 'string', xml: { name: 'reference' } } },
    });
    expect(f.snapshot.edges).toEqual([]);
    expect(output(await f.run({ xml: 'attribute', $ref: 'https://never.example/data' })).xml).toBe(
      '<Root><reference>https://never.example/data</reference><xml>attribute</xml></Root>',
    );
    for (const pointer of [
      '#/components/schemas/Root/examples/0',
      '#/components/schemas/Root/unknownAnnotation',
      '#/components/schemas/Root/dataValue',
      '#/components/schemas/Root/x-data',
    ])
      unavailable(await f.run('x', { schemaLocation: { ownerRetrievalUri: uri, pointer } }), 'SCHEMA_UNAVAILABLE');
  });
  test('retains escaped physical property locations and __proto__ as ordinary data', async () => {
    const f = await fixture({
      type: 'object',
      properties: Object.fromEntries([
        ['a~/% b', { type: 'string', xml: { name: 'safe' } }],
        ['__proto__', { type: 'string' }],
      ]),
    });
    const result = output(
      await f.run(
        Object.fromEntries([
          ['a~/% b', 'X'],
          ['__proto__', 'P'],
        ]),
      ),
    );
    expect(result.xml).toBe('<Root><__proto__>P</__proto__><safe>X</safe></Root>');
    expect(result.provenance.some((source) => source.schemaLocation.pointer.endsWith('/a~0~1% b'))).toBe(true);
  });
  test('G keeps authored XML verbatim and external-only examples outside this explicit serializer', async () => {
    const authored = '<Root>\n  <value>A</value>\n</Root>';
    const document = {
      ...documentFor({ Root: { type: 'object', properties: { value: { type: 'string' } } } }),
      paths: {
        '/xml': {
          post: {
            requestBody: {
              content: {
                'application/xml': {
                  schema: { $ref: '#/components/schemas/Root' },
                  examples: {
                    pair: { dataValue: { value: 'A' }, serializedValue: authored },
                    data: { dataValue: { value: 'A' } },
                    remote: { externalValue: 'https://never.example/example.xml' },
                  },
                },
              },
            },
            responses: { '204': { description: 'ok' } },
          },
        },
      },
    } as SwaggerDoc;
    const f = await fixture(undefined, { document });
    const operation = parseMenuTags(document, { retrievalUri: uri, resourceSnapshot: f.snapshot }).flatMap(
      (tag) => tag.operations,
    )[0];
    const catalog = locateOperationExampleCatalog(document, operation);
    const paired = await evaluateOperationExample(
      catalog.targets.find((target) => target.name === 'pair')!,
      f.session,
    );
    expect(paired.representation.text).toBe(authored);
    const generated = output(
      await f.run(paired.representation.data, { schemaLocation: paired.target.schemaLocation! }),
    );
    expect(generated.xml).toBe('<Root><value>A</value></Root>');
    expect(paired.representation.text).toBe(authored);
    // G is still unconnected to this helper: XML data-only serialization remains unavailable in this phase.
    const data = await evaluateOperationExample(
      catalog.targets.find((target) => target.name === 'data')!,
      f.session,
    );
    expect(data.representation.serialization).toBe('unavailable');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('No external example fetching'));
    const remote = await evaluateOperationExample(
      catalog.targets.find((target) => target.name === 'remote')!,
      f.session,
    );
    expect(remote.representation).not.toHaveProperty('data');
    expect(
      await f.run(undefined, {
        data: {
          kind: 'external',
          value: remote.representation.external,
        } as unknown as Oas32XmlSerializationOptions['data'],
      }),
    ).toMatchObject({ status: 'not-applicable' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test.each(['maxDepth', 'maxNodes', 'maxReferences', 'maxOutputBytes'] as const)(
    'enforces the %s hard budget without partial XML',
    async (limit) => {
      const f = await fixture(
        { $ref: '#/components/schemas/Value' },
        { schemas: { Value: { type: 'object', properties: { value: { type: 'string' } } } } },
      );
      unavailable(await f.run({ value: '中文' }, { limits: { [limit]: 0 } }), 'BUDGET_EXCEEDED');
      const result = output(await f.run({ value: '中文' }, { limits: { [limit]: Number.MAX_SAFE_INTEGER } }));
      expect(result.limits[limit]).toBe(OAS32_XML_LIMITS[limit]);
    },
  );
  test('counts actual UTF-8 output bytes including escaping and namespace declarations', async () => {
    const f = await fixture({ type: 'string', xml: { namespace: 'urn:中', prefix: 'p' } });
    const result = output(await f.run('中文&'));
    expect(result.usage.outputBytes).toBe(Buffer.byteLength(result.xml));
    expect(output(await f.run('中文&', { limits: { maxOutputBytes: result.usage.outputBytes } })).xml).toBe(result.xml);
    unavailable(await f.run('中文&', { limits: { maxOutputBytes: result.usage.outputBytes - 1 } }), 'BUDGET_EXCEEDED');
  });
  test('bounds deep logical input, large strings and cyclic data before output', async () => {
    const f = await fixture({ type: 'string' });
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    unavailable(await f.run(cyclic), 'INVALID_DATA');
    unavailable(await f.run('x'.repeat(OAS32_XML_LIMITS.maxOutputBytes + 1)), 'BUDGET_EXCEEDED');
    let nested: unknown = 'x';
    for (let index = 0; index < 35; index++) nested = { nested };
    unavailable(await f.run(nested), 'BUDGET_EXCEEDED');
  });
  test('honors cancellation both before work and while an async registered lookup is pending', async () => {
    const f = await fixture({ type: 'string' });
    const early = new AbortController();
    early.abort();
    unavailable(await f.run('x', { signal: early.signal }), 'CANCELLED');
    const controller = new AbortController();
    const pending = f.run('x', { session: { resolve: () => new Promise(() => undefined) }, signal: controller.signal });
    controller.abort();
    unavailable(await pending, 'CANCELLED');
  });
  test('rejects a mismatched C/D generation rather than using stale annotations', async () => {
    const f = await fixture({ type: 'string', xml: { name: 'current' } });
    const staleDocument = documentFor({ Root: { type: 'string', xml: { name: 'stale' } } });
    f.session.dispose();
    const stale = await createSchemaDocumentSession(staleDocument, uri);
    sessions.push(stale);
    unavailable(await f.run('x', { session: stale }), 'SCHEMA_CONTEXT_MISMATCH');
  });
  test('accepts equal C/D content despite key order, then rejects both directions of a genuine mismatch', async () => {
    const f = await fixture({ type: 'object', properties: { value: { type: 'string' } }, xml: { name: 'current' } });
    const node = await f.session.resolve('#/components/schemas/Root');
    const raw = (f.snapshot.nodes.get(uri)!.document as SwaggerDoc).components!.schemas!.Root;
    expect(JSON.stringify(raw)).not.toBe(JSON.stringify(node.schema));
    expect(raw).toEqual(node.schema);
    expect(output(await f.run({ value: 'x' })).xml).toBe('<current><value>x</value></current>');
    const currentSnapshot = f.snapshot;
    const old = await fixture({ type: 'object', xml: { name: 'old' }, properties: { value: { type: 'string' } } });
    unavailable(await old.run({ value: 'x' }, { snapshot: currentSnapshot }), 'SCHEMA_CONTEXT_MISMATCH');
    const oldSnapshot = old.snapshot;
    const current = await fixture({
      type: 'object',
      properties: { value: { type: 'string' } },
      xml: { name: 'current' },
    });
    unavailable(await current.run({ value: 'x' }, { snapshot: oldSnapshot }), 'SCHEMA_CONTEXT_MISMATCH');
  });
  test('reconstructed missing attributes use explicit Schema nullability rules in the limited round-trip example', async () => {
    const f = await fixture({
      type: 'object',
      properties: {
        optional: { type: 'string', xml: { nodeType: 'attribute' } },
        nullable: { type: ['string', 'null'], xml: { nodeType: 'attribute' } },
      },
    });
    const result = output(await f.run({ nullable: null }));
    const parsed = parseXml(result.xml);
    const decoded = {
      ...(parsed.attributes.optional === undefined ? {} : { optional: parsed.attributes.optional }),
      nullable: parsed.attributes.nullable ?? null,
    };
    expect(decoded).toEqual({ nullable: null });
    expect((await f.session.evaluate('#/components/schemas/Root', decoded)).valid).toBe(true);
    // Absent nullable and explicit null collide, even though this decoder convention chooses null.
    expect(output(await f.run({})).xml).toBe(result.xml);
    expect(result.roundTrip).toBe('ambiguous');
  });
  test('does not invoke getters or accept sparse/annotated arrays as logical JSON', async () => {
    const f = await fixture({ type: 'array', items: { type: 'string', xml: { name: 'item' } } });
    const getter = vi.fn(() => 'x');
    const accessor = Object.defineProperty([], '0', { get: getter, enumerable: true });
    unavailable(await f.run(accessor), 'INVALID_DATA');
    unavailable(await f.run(Array(1)), 'INVALID_DATA');
    const annotated = Object.assign(['x'], { extra: 'y' });
    unavailable(await f.run(annotated), 'INVALID_DATA');
    expect(getter).not.toHaveBeenCalled();
  });
  test('namespace prefixes with ordinary prototype property names remain safe', async () => {
    const f = await fixture({ type: 'string', xml: { prefix: '__proto__', namespace: 'urn:safe' } });
    const result = output(await f.run('x'));
    expect(parseXml(result.xml)).toMatchObject({ tag: '{urn:safe}Root', text: 'x' });
    expect(result.xml).toContain('xmlns:__proto__="urn:safe"');
  });
  test('the standard-parser harness never resolves DTD or external entity payloads', () => {
    expect(() => parseXml('<!DOCTYPE root SYSTEM "https://never.example/dtd"><root/>')).toThrow();
    expect(() =>
      parseXml('<!DOCTYPE root [<!ENTITY secret SYSTEM "file:///never/read">]><root>&secret;</root>'),
    ).toThrow();
  });
});
