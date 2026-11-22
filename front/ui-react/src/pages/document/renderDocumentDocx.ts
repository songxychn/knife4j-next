import type {
  ExportNote,
  ExportParameter,
  ExportRequestBody,
  ExportResponse,
  ExportSchema,
  ExportSchemaField,
  ExportSecurityRequirement,
  ExportSecurityScheme,
  ExportServer,
} from 'knife4j-core';
import {
  Document,
  Packer,
  Paragraph as DocxParagraph,
  TextRun,
  Table as DocxTable,
  TableRow as DocxTableRow,
  TableCell as DocxTableCell,
  WidthType,
  AlignmentType,
  BorderStyle,
  HeadingLevel,
  LevelFormat,
  LevelSuffix,
  ShadingType,
} from 'docx';
import type { MenuTag, SwaggerDoc } from '../../types/swagger';
import type { OfflineDocumentSnapshot } from './offlineDocumentSnapshot';
import {
  buildDocumentSnapshot,
  fieldPath,
  fieldType,
  formatEncodings,
  formatNote,
  incompleteExportSummary,
  incompleteExportTitle,
  methodColor,
  renderedExportIssueLines,
  type OfficeDocLabels,
} from './offlineDocumentPresentation';

function docxMethodColor(method: string): string {
  const hex = methodColor(method).replace('#', '');
  if (/^[0-9a-fA-F]{6}$/.test(hex)) return hex;
  if (/^[0-9a-fA-F]{3}$/.test(hex)) {
    return hex
      .split('')
      .map((digit) => `${digit}${digit}`)
      .join('');
  }
  return '999999';
}

const THIN_BORDER = {
  top: { style: BorderStyle.SINGLE, size: 1, color: '999999' },
  bottom: { style: BorderStyle.SINGLE, size: 1, color: '999999' },
  left: { style: BorderStyle.SINGLE, size: 1, color: '999999' },
  right: { style: BorderStyle.SINGLE, size: 1, color: '999999' },
};

function docxNotes(notes: readonly ExportNote[] | undefined): DocxParagraph[] {
  return (notes ?? []).map(
    (note) =>
      new DocxParagraph({
        children: [new TextRun({ text: `• ${formatNote(note)}`, size: 20, color: '555555' })],
        spacing: { after: 20 },
      }),
  );
}

function docxBullet(text: string): DocxParagraph {
  return new DocxParagraph({
    children: [new TextRun({ text: `• ${text}`, size: 20, color: '555555' })],
    spacing: { after: 20 },
  });
}

function docxHeadingLine(text: string): DocxParagraph {
  return new DocxParagraph({
    children: [new TextRun({ text, bold: true, size: 22 })],
    spacing: { before: 80, after: 20 },
  });
}

function docxOas32SchemaExtras(
  schema: ExportSchema | undefined,
  labels: OfficeDocLabels,
): (DocxParagraph | DocxTable)[] {
  if (!schema) return [];
  const children: (DocxParagraph | DocxTable)[] = [];
  if (schema.discriminator) {
    const mapping = schema.discriminator.mapping
      ? Object.entries(schema.discriminator.mapping)
          .map(([key, value]) => `${key} → ${value}`)
          .join(', ')
      : '';
    children.push(
      docxBullet(
        [
          'Discriminator',
          schema.discriminator.propertyName ? `propertyName=${schema.discriminator.propertyName}` : undefined,
          schema.discriminator.defaultMapping ? `defaultMapping=${schema.discriminator.defaultMapping}` : undefined,
          mapping ? `mapping: ${mapping}` : undefined,
        ]
          .filter(Boolean)
          .join(' · '),
      ),
    );
  }
  if (schema.xml && Object.values(schema.xml).some((value) => value !== undefined)) {
    const xml = Object.entries(schema.xml)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => `${key}=${String(value)}`)
      .join(' ');
    children.push(docxBullet(`XML ${xml}`));
  }
  const encodings = formatEncodings(schema.encodings);
  if (encodings.length) {
    children.push(docxHeadingLine(labels.encoding ?? 'Encoding'));
    encodings.forEach((encoding) => children.push(docxBullet(encoding)));
  }
  children.push(...docxNotes(schema.notes));
  if (schema.itemSchema) {
    children.push(
      docxHeadingLine(
        `${labels.itemSchema ?? 'itemSchema'} (${schema.itemSchema.mediaType}) ${labels.type}: ${schema.itemSchema.typeDisplay}`,
      ),
    );
    if (schema.itemSchema.fields.length) children.push(docxFieldTable(schema.itemSchema.fields, labels));
    children.push(...docxOas32SchemaExtras(schema.itemSchema, labels));
  }
  return children;
}

function docxOas32MediaExtras(
  body: ExportRequestBody | ExportResponse | undefined,
  labels: OfficeDocLabels,
): (DocxParagraph | DocxTable)[] {
  if (!body) return [];
  const children: (DocxParagraph | DocxTable)[] = [];
  if (body.sequentialKind)
    children.push(docxBullet(`${labels.sequentialKind ?? 'Sequential media'} ${body.sequentialKind}`));
  const encodings = formatEncodings(body.encodings);
  if (encodings.length) {
    children.push(docxHeadingLine(labels.encoding ?? 'Encoding'));
    encodings.forEach((encoding) => children.push(docxBullet(encoding)));
  }
  children.push(...docxNotes(body.notes));
  children.push(...docxOas32SchemaExtras(body.schema, labels));
  if (body.itemSchema) {
    children.push(
      docxHeadingLine(
        `${labels.itemSchema ?? 'itemSchema'} (${body.itemSchema.mediaType}) ${labels.type}: ${body.itemSchema.typeDisplay}`,
      ),
    );
    if (body.itemSchema.fields.length) children.push(docxFieldTable(body.itemSchema.fields, labels));
    children.push(...docxOas32SchemaExtras(body.itemSchema, labels));
  }
  return children;
}

function docxSecurity(
  security: readonly ExportSecurityRequirement[] | undefined,
  labels: OfficeDocLabels,
): DocxParagraph[] {
  if (!security?.length) return [];
  const children = [docxHeadingLine(labels.security ?? 'Security')];
  for (const requirement of security) {
    if (requirement.anonymous) {
      children.push(docxBullet('anonymous'));
      continue;
    }
    const schemes = requirement.schemes
      .map((scheme) => (scheme.scopes.length ? `${scheme.name} (${scheme.scopes.join(', ')})` : scheme.name))
      .join(', ');
    children.push(docxBullet(schemes || '_'));
    children.push(...docxNotes(requirement.notes));
  }
  return children;
}

function docxServers(servers: readonly ExportServer[] | undefined, labels: OfficeDocLabels): DocxParagraph[] {
  if (!servers?.length) return [];
  const children = [docxHeadingLine(labels.servers ?? 'Servers')];
  for (const server of servers) {
    const meta = [server.name, server.level, server.description].filter(Boolean).join(' · ');
    children.push(docxBullet(meta ? `${server.url} — ${meta}` : server.url));
    children.push(...docxNotes(server.notes));
  }
  return children;
}

function docxSecuritySchemes(
  schemes: readonly ExportSecurityScheme[] | undefined,
  labels: OfficeDocLabels,
): DocxParagraph[] {
  if (!schemes?.length) return [];
  const children = [docxHeadingLine(labels.security ?? 'Security')];
  for (const scheme of schemes) {
    const meta = [
      scheme.type,
      scheme.scheme,
      scheme.in,
      scheme.bearerFormat,
      scheme.oauth2MetadataUrl,
      scheme.openIdConnectUrl,
    ]
      .filter(Boolean)
      .join(' · ');
    children.push(docxBullet(meta ? `${scheme.name}: ${meta}` : scheme.name));
    children.push(...docxNotes(scheme.notes));
  }
  return children;
}

function docxTextCell(text: string, opts?: { bold?: boolean; shading?: string }): DocxTableCell {
  return new DocxTableCell({
    borders: THIN_BORDER,
    shading: opts?.shading ? { type: ShadingType.SOLID, color: opts.shading } : undefined,
    children: [
      new DocxParagraph({
        children: [new TextRun({ text, bold: opts?.bold, size: 20 })],
        spacing: { before: 40, after: 40 },
      }),
    ],
  });
}

function docxFieldTable(rows: readonly ExportSchemaField[], labels: OfficeDocLabels): DocxTable {
  const header = new DocxTableRow({
    children: [
      docxTextCell(labels.field, { bold: true, shading: 'f5f5f5' }),
      docxTextCell(labels.type, { bold: true, shading: 'f5f5f5' }),
      docxTextCell(labels.required, { bold: true, shading: 'f5f5f5' }),
      docxTextCell(labels.description, { bold: true, shading: 'f5f5f5' }),
    ],
  });
  const dataRows = rows.map(
    (r) =>
      new DocxTableRow({
        children: [
          docxTextCell(fieldPath(r, labels)),
          docxTextCell(fieldType(r, labels)),
          docxTextCell(r.required ? labels.yes : labels.no),
          docxTextCell(r.description),
        ],
      }),
  );
  return new DocxTable({ rows: [header, ...dataRows], width: { size: 100, type: WidthType.PERCENTAGE } });
}

function docxParamRows(params: readonly ExportParameter[], labels: OfficeDocLabels): DocxTableRow[] {
  return params.map(
    (p) =>
      new DocxTableRow({
        children: [
          docxTextCell(p.name),
          docxTextCell(p.location),
          docxTextCell(p.required ? labels.yes : labels.no),
          docxTextCell(p.typeDisplay),
          docxTextCell(p.description),
        ],
      }),
  );
}

function docxExampleSection(label: string, mediaType: string, value: string, statusCode?: string): DocxParagraph[] {
  const lines = value.split(/\r\n|\n|\r/);
  return [
    new DocxParagraph({
      children: [
        new TextRun({
          text: `${label}${statusCode !== undefined ? ` ${statusCode}` : ''}${mediaType ? ` (${mediaType})` : ''}`,
          bold: true,
          size: 22,
        }),
      ],
      spacing: { before: 120, after: 40 },
    }),
    new DocxParagraph({
      children: lines.map(
        (line, index) =>
          new TextRun({
            text: line,
            break: index === 0 ? undefined : 1,
            font: 'Courier New',
            size: 20,
          }),
      ),
      spacing: { after: 80 },
    }),
  ];
}

function docxParameterDetails(
  parameters: readonly ExportParameter[],
  labels: OfficeDocLabels,
): (DocxParagraph | DocxTable)[] {
  return parameters.flatMap((parameter) => {
    const fields = parameter.schema?.fields ?? [];
    const example = parameter.example;
    if (fields.length === 0 && example?.value === undefined && !parameter.encodings?.length && !parameter.notes?.length)
      return [];
    const metadata = parameter.schema
      ? `${parameter.schema.mediaType ? `${labels.mediaType}: ${parameter.schema.mediaType}  ` : ''}${labels.type}: ${
          parameter.schema.typeDisplay
        }`
      : '';
    const children: (DocxParagraph | DocxTable)[] = [
      new DocxParagraph({
        children: [
          new TextRun({ text: `${labels.parameters} ${parameter.name}  `, bold: true, size: 22 }),
          ...(metadata ? [new TextRun({ text: metadata, size: 22 })] : []),
        ],
        spacing: { before: 120, after: 40 },
      }),
    ];
    if (fields.length) children.push(docxFieldTable(fields, labels));
    if (example?.value !== undefined) {
      children.push(
        ...docxExampleSection(`${labels.requestExample}: ${parameter.name}`, example.mediaType, example.value),
      );
    }
    children.push(
      ...docxOas32MediaExtras(
        {
          description: '',
          required: false,
          encodings: parameter.encodings,
          notes: parameter.notes,
          schema: parameter.schema,
        },
        labels,
      ),
    );
    return children;
  });
}

function docxRequestBodySection(
  requestBody: ExportRequestBody | undefined,
  labels: OfficeDocLabels,
): (DocxParagraph | DocxTable)[] {
  const schema = requestBody?.schema;
  const example = requestBody?.example;
  if (
    !schema &&
    example?.value === undefined &&
    !requestBody?.notes?.length &&
    !requestBody?.itemSchema &&
    !requestBody?.sequentialKind &&
    !requestBody?.encodings?.length
  )
    return [];
  const mediaType = schema?.mediaType ?? example?.mediaType ?? requestBody?.itemSchema?.mediaType ?? '';
  const children: (DocxParagraph | DocxTable)[] = [
    new DocxParagraph({
      children: [
        new TextRun({ text: `${labels.requestBody} (${mediaType})  `, bold: true, size: 22 }),
        new TextRun({
          text: `${schema ? `${labels.type}: ${schema.typeDisplay}  ` : ''}${labels.required}: ${
            requestBody?.required ? labels.yes : labels.no
          }`,
          size: 22,
        }),
      ],
      spacing: { before: 120, after: 40 },
    }),
  ];
  if (requestBody?.description) {
    children.push(
      new DocxParagraph({
        children: [new TextRun({ text: requestBody.description, color: '666666', size: 22 })],
        spacing: { after: 40 },
      }),
    );
  }
  if (schema?.fields.length) children.push(docxFieldTable(schema.fields, labels));
  if (example?.value !== undefined) {
    children.push(...docxExampleSection(labels.requestExample, example.mediaType, example.value));
  }
  children.push(...docxOas32MediaExtras(requestBody, labels));
  return children;
}

function docxResponseSection(
  responses: readonly ExportResponse[],
  labels: OfficeDocLabels,
): (DocxParagraph | DocxTable)[] {
  if (!responses.length) return [];

  const children: (DocxParagraph | DocxTable)[] = [
    new DocxParagraph({
      children: [new TextRun({ text: labels.responses, bold: true, size: 22 })],
      spacing: { before: 160, after: 40 },
    }),
  ];

  const summaryHeader = new DocxTableRow({
    children: [
      docxTextCell(labels.statusCode, { bold: true, shading: 'f5f5f5' }),
      docxTextCell(labels.description, { bold: true, shading: 'f5f5f5' }),
      docxTextCell(labels.schema, { bold: true, shading: 'f5f5f5' }),
    ],
  });
  const summaryRows = responses.map(
    (response) =>
      new DocxTableRow({
        children: [
          docxTextCell(response.statusCode),
          docxTextCell([response.summary, response.description].filter(Boolean).join(' — ')),
          docxTextCell(response.schema?.typeDisplay ?? '—'),
        ],
      }),
  );
  children.push(
    new DocxTable({
      rows: [summaryHeader, ...summaryRows],
      width: { size: 100, type: WidthType.PERCENTAGE },
    }),
  );

  for (const response of responses) {
    const schema = response.schema;
    if (schema?.fields.length) {
      children.push(
        new DocxParagraph({
          children: [
            new TextRun({
              text: `${labels.response} ${response.statusCode} (${schema.mediaType})  `,
              bold: true,
              size: 22,
            }),
            new TextRun({ text: `${labels.type}: ${schema.typeDisplay}`, size: 22 }),
          ],
          spacing: { before: 120, after: 40 },
        }),
        docxFieldTable(schema.fields, labels),
      );
    }
    children.push(...docxOas32MediaExtras(response, labels));
    if (response.example?.value !== undefined) {
      children.push(
        ...docxExampleSection(
          labels.responseExample,
          response.example.mediaType,
          response.example.value,
          response.statusCode,
        ),
      );
    }
  }

  return children;
}

export async function renderDocx(snapshot: OfflineDocumentSnapshot, labels: OfficeDocLabels): Promise<Blob> {
  const children: (DocxParagraph | DocxTable)[] = [];
  const model = snapshot.document;

  children.push(
    new DocxParagraph({
      text: model.title,
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
    }),
  );
  children.push(
    new DocxParagraph({
      children: [new TextRun({ text: `${labels.version}: ${model.version}`, size: 22 })],
    }),
  );
  if (model.description) {
    children.push(
      new DocxParagraph({
        children: [new TextRun({ text: `${labels.description}: ${model.description}`, size: 22 })],
      }),
    );
  }
  if (!snapshot.complete) {
    children.push(
      new DocxParagraph({
        children: [new TextRun({ text: incompleteExportTitle(labels), bold: true, color: 'ad4e00', size: 22 })],
        spacing: { before: 120, after: 40 },
      }),
      new DocxParagraph({
        children: [new TextRun({ text: incompleteExportSummary(snapshot, labels), color: '873800', size: 20 })],
        spacing: { after: 40 },
      }),
      ...renderedExportIssueLines(snapshot, labels).map(
        (issue) =>
          new DocxParagraph({
            children: [new TextRun({ text: `• ${issue}`, color: '873800', size: 20 })],
            spacing: { after: 20 },
          }),
      ),
    );
  }
  children.push(...docxServers(model.servers, labels));
  children.push(...docxSecuritySchemes(model.securitySchemes, labels));
  children.push(new DocxParagraph({ text: '' }));

  for (const tag of model.tags) {
    children.push(
      new DocxParagraph({
        text: tag.name,
        heading: HeadingLevel.HEADING_1,
        numbering: { reference: 'api-outline', level: 0 },
        spacing: { before: 300, after: 100 },
      }),
    );
    if (tag.summary || tag.parent || tag.kind) {
      children.push(
        new DocxParagraph({
          children: [
            new TextRun({
              text: [
                tag.summary,
                tag.parent ? `parent=${tag.parent}` : undefined,
                tag.kind ? `kind=${tag.kind}` : undefined,
              ]
                .filter(Boolean)
                .join(' · '),
              italics: true,
              color: '666666',
              size: 22,
            }),
          ],
          spacing: { after: 40 },
        }),
      );
    }
    if (tag.description) {
      children.push(
        new DocxParagraph({
          children: [new TextRun({ text: tag.description, italics: true, color: '666666', size: 22 })],
          spacing: { after: 80 },
        }),
      );
    }

    for (const operation of tag.operations) {
      children.push(
        new DocxParagraph({
          text: operation.title,
          heading: HeadingLevel.HEADING_2,
          numbering: { reference: 'api-outline', level: 1 },
          spacing: { before: 200, after: 60 },
        }),
        new DocxParagraph({
          children: [
            new TextRun({
              text: `[${operation.method}] `,
              bold: true,
              color: docxMethodColor(operation.method),
              size: 24,
            }),
            new TextRun({ text: operation.path, font: 'Courier New', size: 24 }),
            ...(operation.deprecated
              ? [new TextRun({ text: ` [${labels.deprecated}]`, color: 'f93e3e', size: 22 })]
              : []),
          ],
          spacing: { after: 60 },
        }),
      );

      if (operation.description) {
        children.push(
          new DocxParagraph({
            children: [new TextRun({ text: operation.description, color: '666666', size: 22 })],
            spacing: { after: 60 },
          }),
        );
      }
      children.push(...docxNotes(operation.notes));
      children.push(...docxSecurity(operation.security, labels));
      children.push(...docxServers(operation.servers, labels));

      if (operation.parameters.length) {
        const paramHeader = new DocxTableRow({
          children: [
            docxTextCell(labels.name, { bold: true, shading: 'f5f5f5' }),
            docxTextCell(labels.location, { bold: true, shading: 'f5f5f5' }),
            docxTextCell(labels.required, { bold: true, shading: 'f5f5f5' }),
            docxTextCell(labels.type, { bold: true, shading: 'f5f5f5' }),
            docxTextCell(labels.description, { bold: true, shading: 'f5f5f5' }),
          ],
        });
        children.push(
          new DocxParagraph({
            children: [new TextRun({ text: labels.parameters, bold: true, size: 22 })],
            spacing: { before: 80, after: 40 },
          }),
          new DocxTable({
            rows: [paramHeader, ...docxParamRows(operation.parameters, labels)],
            width: { size: 100, type: WidthType.PERCENTAGE },
          }),
          ...docxParameterDetails(operation.parameters, labels),
        );
      }

      children.push(...docxRequestBodySection(operation.requestBody, labels));
      children.push(...docxResponseSection(operation.responses, labels));
    }
  }

  const document = new Document({
    numbering: {
      config: [
        {
          reference: 'api-outline',
          levels: [
            {
              level: 0,
              format: LevelFormat.DECIMAL,
              text: '%1',
              alignment: AlignmentType.START,
              suffix: LevelSuffix.SPACE,
              style: { style: HeadingLevel.HEADING_1 },
            },
            {
              level: 1,
              format: LevelFormat.DECIMAL,
              text: '%1.%2',
              alignment: AlignmentType.START,
              suffix: LevelSuffix.SPACE,
              style: { style: HeadingLevel.HEADING_2 },
            },
          ],
        },
      ],
    },
    sections: [{ children }],
  });
  return Packer.toBlob(document);
}

export async function buildDocx(doc: SwaggerDoc, tags: MenuTag[], labels: OfficeDocLabels): Promise<Blob> {
  return renderDocx(buildDocumentSnapshot(doc, tags, labels), labels);
}
