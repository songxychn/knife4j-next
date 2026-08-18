import JSZip from 'jszip';
import { describe, expect, test, vi } from 'vitest';
import type { MenuOperation, MenuTag, SwaggerDoc } from '../../types/swagger';
import { buildDocx, buildWordDoc, type OfficeDocLabels } from './OfficeDoc';
import { buildOfficeDocOutline, formatOfficeDocOutlineNumber } from './officeDocOutline';

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
  responses: 'Responses',
  response: 'Response',
  statusCode: 'Status code',
  schema: 'Schema',
  deprecated: 'Deprecated',
  parameters: 'Parameters',
  circularReference: 'Circular reference',
  fallbackTitle: 'API documentation',
  markdown: {} as OfficeDocLabels['markdown'],
};

const doc: SwaggerDoc = {
  openapi: '3.0.1',
  info: { title: 'Demo API', version: '1.0.0' },
  paths: {},
};

function operation(path: string, method: string, summary?: string): MenuOperation {
  return {
    key: `${method}:${path}:${summary ?? ''}`,
    path,
    method,
    summary: summary ?? path,
    operation: { summary, responses: {} },
  };
}

const tags: MenuTag[] = [
  {
    tag: 'Users',
    operations: [operation('/users', 'get', 'List users'), operation('/users', 'post', '   ')],
  },
  {
    tag: 'Orders',
    operations: [operation('/orders', 'get', 'List orders')],
  },
];

function paragraphContaining(documentXml: string, text: string): string {
  const paragraph = (documentXml.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g) ?? []).find((candidate) =>
    candidate.includes(`>${text}<`),
  );
  expect(paragraph, `paragraph containing ${text}`).toBeDefined();
  return paragraph!;
}

function paragraphNumberId(paragraph: string): string {
  const match = paragraph.match(/<w:numId w:val="(\d+)"\/>/);
  expect(match).not.toBeNull();
  return match![1];
}

async function readDocxParts(blob: Blob): Promise<{ documentXml: string; numberingXml: string }> {
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const documentPart = zip.file('word/document.xml');
  const numberingPart = zip.file('word/numbering.xml');
  expect(documentPart).not.toBeNull();
  expect(numberingPart).not.toBeNull();
  return {
    documentXml: await documentPart!.async('text'),
    numberingXml: await numberingPart!.async('text'),
  };
}

describe('office document outline', () => {
  test('keeps tag order and builds two-level numbers with a method/path fallback', () => {
    const outline = buildOfficeDocOutline(tags);

    expect(
      outline.map((tag) => ({
        number: formatOfficeDocOutlineNumber(tag.numberPath),
        title: tag.tag.tag,
        operations: tag.operations.map((item) => ({
          number: formatOfficeDocOutlineNumber(item.numberPath),
          title: item.title,
        })),
      })),
    ).toEqual([
      {
        number: '1',
        title: 'Users',
        operations: [
          { number: '1.1', title: 'List users' },
          { number: '1.2', title: 'POST /users' },
        ],
      },
      {
        number: '2',
        title: 'Orders',
        operations: [{ number: '2.1', title: 'List orders' }],
      },
    ]);
  });

  test('keeps empty tags in the outline and handles an empty document', () => {
    const outline = buildOfficeDocOutline([
      { tag: 'Empty', operations: [] },
      { tag: 'Users', operations: [operation('/users', 'get', 'List users')] },
    ]);

    expect(formatOfficeDocOutlineNumber(outline[0].numberPath)).toBe('1');
    expect(formatOfficeDocOutlineNumber(outline[1].operations[0].numberPath)).toBe('2.1');
    expect(buildOfficeDocOutline([])).toEqual([]);
  });

  test('HTML-based Word export uses escaped numbered headings without putting the title in Heading 1', () => {
    const output = buildWordDoc(
      doc,
      [{ tag: 'Users <Admin>', operations: [operation('/users', 'get', 'List & "users"')] }],
      labels,
    );

    expect(output).toContain('<p class="document-title">Demo API</p>');
    expect(output).not.toContain('<h1>Demo API</h1>');
    expect(output).toMatch(/<h1[^>]*>1 Users &lt;Admin&gt;<\/h1>/);
    expect(output).toMatch(/<h2[^>]*>1\.1 List &amp; &quot;users&quot;<\/h2>/);
  });

  test('DOCX export writes native two-level numbering on Heading 1 and Heading 2 paragraphs', async () => {
    const { documentXml, numberingXml } = await readDocxParts(await buildDocx(doc, tags, labels));
    const abstractNumberings = numberingXml.match(/<w:abstractNum\b[\s\S]*?<\/w:abstractNum>/g) ?? [];
    const outlineNumbering = abstractNumberings.find((part) => part.includes('<w:lvlText w:val="%1.%2"/>'));

    expect(outlineNumbering).toBeDefined();
    expect(outlineNumbering).toContain('<w:numFmt w:val="decimal"/>');
    expect(outlineNumbering).toContain('<w:lvlText w:val="%1"/>');
    expect(outlineNumbering).toContain('<w:lvlText w:val="%1.%2"/>');
    expect(outlineNumbering).toContain('<w:suff w:val="space"/>');
    const outlineAbstractNumberId = outlineNumbering!.match(/<w:abstractNum w:abstractNumId="(\d+)"/)?.[1];
    expect(outlineAbstractNumberId).toBeDefined();
    const outlineNumberingInstance = (numberingXml.match(/<w:num\b[\s\S]*?<\/w:num>/g) ?? []).find((part) =>
      part.includes(`<w:abstractNumId w:val="${outlineAbstractNumberId}"/>`),
    );
    expect(outlineNumberingInstance).toBeDefined();
    const outlineNumberId = outlineNumberingInstance!.match(/<w:num w:numId="(\d+)"/)?.[1];
    expect(outlineNumberId).toBeDefined();

    const titleParagraph = paragraphContaining(documentXml, 'Demo API');
    expect(titleParagraph).toContain('<w:pStyle w:val="Title"/>');
    expect(titleParagraph).not.toContain('<w:numPr>');

    const expectedParagraphs = [
      { text: 'Users', style: 'Heading1', level: '0' },
      { text: 'List users', style: 'Heading2', level: '1' },
      { text: 'POST /users', style: 'Heading2', level: '1' },
      { text: 'Orders', style: 'Heading1', level: '0' },
      { text: 'List orders', style: 'Heading2', level: '1' },
    ];
    const numberIds = expectedParagraphs.map(({ text, style, level }) => {
      const paragraph = paragraphContaining(documentXml, text);
      expect(paragraph).toContain(`<w:pStyle w:val="${style}"/>`);
      expect(paragraph).toContain(`<w:ilvl w:val="${level}"/>`);
      return paragraphNumberId(paragraph);
    });

    expect(new Set(numberIds)).toEqual(new Set([outlineNumberId]));
  });
});
