import type {
  ExportNote,
  ExportOperation,
  ExportParameter,
  ExportRequestBody,
  ExportResponse,
  ExportSchema,
  ExportSchemaField,
  ExportSecurityRequirement,
  ExportSecurityScheme,
  ExportServer,
} from 'knife4j-core';
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

function escapeHtml(s: string | undefined | null): string {
  if (s === undefined || s === null) return '';
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderIncompleteHtml(snapshot: OfflineDocumentSnapshot, labels: OfficeDocLabels): string {
  if (snapshot.complete) return '';
  const issues = renderedExportIssueLines(snapshot, labels)
    .map((issue) => `<li>${escapeHtml(issue)}</li>`)
    .join('');
  return `<div class="export-incomplete" role="alert">
    <strong>${escapeHtml(incompleteExportTitle(labels))}</strong>
    <p>${escapeHtml(incompleteExportSummary(snapshot, labels))}</p>
    <ul>${issues}</ul>
  </div>`;
}

function formatOutlineNumber(numberPath: readonly number[]): string {
  return numberPath.join('.');
}

function renderNotes(notes: readonly ExportNote[] | undefined): string {
  if (!notes?.length) return '';
  const items = notes.map((note) => `<li>${escapeHtml(formatNote(note))}</li>`).join('');
  return `<ul class="export-notes" style="margin:6px 0;padding-left:20px;font-size:13px;color:#555;">${items}</ul>`;
}

function renderOas32SchemaExtras(
  schema: ExportSchema | undefined,
  labels: OfficeDocLabels,
  borderStyle: string,
): string {
  if (!schema) return '';
  const parts: string[] = [];
  if (schema.discriminator) {
    const mapping = schema.discriminator.mapping
      ? Object.entries(schema.discriminator.mapping)
          .map(([key, value]) => `${key} → ${value}`)
          .join(', ')
      : '';
    parts.push(
      `<p style="margin:4px 0;font-size:13px;"><strong>Discriminator</strong> ${escapeHtml(
        [
          schema.discriminator.propertyName ? `propertyName=${schema.discriminator.propertyName}` : undefined,
          schema.discriminator.defaultMapping ? `defaultMapping=${schema.discriminator.defaultMapping}` : undefined,
          mapping ? `mapping: ${mapping}` : undefined,
        ]
          .filter(Boolean)
          .join(' · '),
      )}</p>`,
    );
  }
  if (schema.xml && Object.values(schema.xml).some((value) => value !== undefined)) {
    const xml = Object.entries(schema.xml)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => `${key}=${String(value)}`)
      .join(' ');
    parts.push(`<p style="margin:4px 0;font-size:13px;"><strong>XML</strong> <code>${escapeHtml(xml)}</code></p>`);
  }
  const encodings = formatEncodings(schema.encodings);
  if (encodings.length) {
    parts.push(
      `<p style="margin:4px 0;font-size:13px;"><strong>${escapeHtml(labels.encoding ?? 'Encoding')}</strong></p><ul style="margin:4px 0;padding-left:20px;font-size:13px;">${encodings
        .map((encoding) => `<li><code>${escapeHtml(encoding)}</code></li>`)
        .join('')}</ul>`,
    );
  }
  parts.push(renderNotes(schema.notes));
  if (schema.itemSchema) {
    parts.push(
      `<p style="margin:8px 0 2px;font-size:13px;font-weight:600;">${escapeHtml(labels.itemSchema ?? 'itemSchema')} (${escapeHtml(
        schema.itemSchema.mediaType,
      )}) &nbsp;<span style="font-weight:400;color:#555;">${labels.type}: <code>${escapeHtml(
        schema.itemSchema.typeDisplay,
      )}</code></span></p>`,
    );
    if (schema.itemSchema.fields.length) parts.push(renderFieldTable(schema.itemSchema.fields, borderStyle, labels));
    parts.push(renderOas32SchemaExtras(schema.itemSchema, labels, borderStyle));
  }
  return parts.join('');
}

function renderOas32MediaExtras(
  body: ExportRequestBody | ExportResponse | undefined,
  labels: OfficeDocLabels,
  borderStyle: string,
): string {
  if (!body) return '';
  const parts: string[] = [];
  if ('summary' in body && body.summary) {
    parts.push(`<p style="margin:4px 0;font-size:13px;color:#666;">${escapeHtml(body.summary)}</p>`);
  }
  if (body.sequentialKind) {
    parts.push(
      `<p style="margin:4px 0;font-size:13px;"><strong>${escapeHtml(
        labels.sequentialKind ?? 'Sequential media',
      )}</strong> <code>${escapeHtml(body.sequentialKind)}</code></p>`,
    );
  }
  const encodings = formatEncodings(body.encodings);
  if (encodings.length) {
    parts.push(
      `<p style="margin:4px 0;font-size:13px;"><strong>${escapeHtml(labels.encoding ?? 'Encoding')}</strong></p><ul style="margin:4px 0;padding-left:20px;font-size:13px;">${encodings
        .map((encoding) => `<li><code>${escapeHtml(encoding)}</code></li>`)
        .join('')}</ul>`,
    );
  }
  parts.push(renderNotes(body.notes));
  parts.push(renderOas32SchemaExtras(body.schema, labels, borderStyle));
  if (body.itemSchema) {
    parts.push(
      `<p style="margin:8px 0 2px;font-size:13px;font-weight:600;">${escapeHtml(labels.itemSchema ?? 'itemSchema')} (${escapeHtml(
        body.itemSchema.mediaType,
      )}) &nbsp;<span style="font-weight:400;color:#555;">${labels.type}: <code>${escapeHtml(
        body.itemSchema.typeDisplay,
      )}</code></span></p>`,
    );
    if (body.itemSchema.fields.length) parts.push(renderFieldTable(body.itemSchema.fields, borderStyle, labels));
    parts.push(renderOas32SchemaExtras(body.itemSchema, labels, borderStyle));
  }
  return parts.join('');
}

function renderSecurity(security: readonly ExportSecurityRequirement[] | undefined, labels: OfficeDocLabels): string {
  if (!security?.length) return '';
  const items = security
    .map((requirement) => {
      if (requirement.anonymous) return '<li><em>anonymous</em></li>';
      const schemes = requirement.schemes
        .map((scheme) =>
          scheme.scopes.length
            ? `<code>${escapeHtml(scheme.name)}</code> (${escapeHtml(scheme.scopes.join(', '))})`
            : `<code>${escapeHtml(scheme.name)}</code>`,
        )
        .join(', ');
      return `<li>${schemes}${renderNotes(requirement.notes)}</li>`;
    })
    .join('');
  return `<p style="margin:8px 0 2px;font-size:13px;font-weight:600;">${escapeHtml(
    labels.security ?? 'Security',
  )}</p><ul style="margin:4px 0;padding-left:20px;font-size:13px;">${items}</ul>`;
}

function renderServers(servers: readonly ExportServer[] | undefined, labels: OfficeDocLabels): string {
  if (!servers?.length) return '';
  const items = servers
    .map((server) => {
      const meta = [server.name, server.level, server.description].filter(Boolean).join(' · ');
      return `<li><code>${escapeHtml(server.url)}</code>${meta ? ` — ${escapeHtml(meta)}` : ''}${renderNotes(server.notes)}</li>`;
    })
    .join('');
  return `<p style="margin:8px 0 2px;font-size:13px;font-weight:600;">${escapeHtml(
    labels.servers ?? 'Servers',
  )}</p><ul style="margin:4px 0;padding-left:20px;font-size:13px;">${items}</ul>`;
}

function renderSecuritySchemes(schemes: readonly ExportSecurityScheme[] | undefined, labels: OfficeDocLabels): string {
  if (!schemes?.length) return '';
  const items = schemes
    .map((scheme) => {
      const meta = [
        scheme.type,
        scheme.scheme,
        scheme.in,
        scheme.bearerFormat,
        scheme.oauth2MetadataUrl ? `oauth2MetadataUrl=${scheme.oauth2MetadataUrl}` : undefined,
        scheme.openIdConnectUrl ? `openIdConnectUrl=${scheme.openIdConnectUrl}` : undefined,
        scheme.deprecated ? 'deprecated' : undefined,
      ]
        .filter(Boolean)
        .join(' · ');
      return `<li><code>${escapeHtml(scheme.name)}</code>${meta ? `: ${escapeHtml(meta)}` : ''}${renderNotes(scheme.notes)}</li>`;
    })
    .join('');
  return `<p style="margin:8px 0 2px;font-size:13px;font-weight:600;">${escapeHtml(
    labels.security ?? 'Security',
  )}</p><ul style="margin:4px 0;padding-left:20px;font-size:13px;">${items}</ul>`;
}

function renderParamTable(params: readonly ExportParameter[], labels: OfficeDocLabels): string {
  if (!params.length) return '';
  const rows = params
    .map(
      (p) => `
    <tr>
      <td style="border:1px solid #ddd;padding:5px 8px;">${escapeHtml(p.name)}</td>
      <td style="border:1px solid #ddd;padding:5px 8px;">${escapeHtml(p.location)}</td>
      <td style="border:1px solid #ddd;padding:5px 8px;">${p.required ? labels.yes : labels.no}</td>
      <td style="border:1px solid #ddd;padding:5px 8px;">${escapeHtml(p.typeDisplay)}</td>
      <td style="border:1px solid #ddd;padding:5px 8px;">${escapeHtml(p.description)}</td>
    </tr>`,
    )
    .join('');
  return `
    <table style="width:100%;border-collapse:collapse;margin:8px 0;font-size:13px;">
      <thead><tr style="background:#f5f5f5;">
        <th style="border:1px solid #ddd;padding:5px 8px;text-align:left;">${labels.name}</th>
        <th style="border:1px solid #ddd;padding:5px 8px;text-align:left;">${labels.location}</th>
        <th style="border:1px solid #ddd;padding:5px 8px;text-align:left;">${labels.required}</th>
        <th style="border:1px solid #ddd;padding:5px 8px;text-align:left;">${labels.type}</th>
        <th style="border:1px solid #ddd;padding:5px 8px;text-align:left;">${labels.description}</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function renderFieldTable(rows: readonly ExportSchemaField[], borderStyle: string, labels: OfficeDocLabels): string {
  if (!rows.length) return '';
  const body = rows
    .map(
      (r) => `
    <tr>
      <td style="${borderStyle}">${escapeHtml(fieldPath(r, labels))}</td>
      <td style="${borderStyle}">${escapeHtml(fieldType(r, labels))}</td>
      <td style="${borderStyle}">${r.required ? labels.yes : labels.no}</td>
      <td style="${borderStyle}">${escapeHtml(r.description)}</td>
    </tr>`,
    )
    .join('');
  return `
    <table style="width:100%;border-collapse:collapse;margin:4px 0;font-size:13px;">
      <thead><tr style="background:#f5f5f5;">
        <th style="${borderStyle}text-align:left;">${labels.field}</th>
        <th style="${borderStyle}text-align:left;">${labels.type}</th>
        <th style="${borderStyle}text-align:left;">${labels.required}</th>
        <th style="${borderStyle}text-align:left;">${labels.description}</th>
      </tr></thead>
      <tbody>${body}</tbody>
    </table>`;
}

function renderHtmlExample(label: string, mediaType: string, value: string, statusCode?: string): string {
  return `
    <p style="margin:8px 0 2px;font-size:13px;font-weight:600;">${escapeHtml(label)}${
      statusCode !== undefined ? ` <code>${escapeHtml(statusCode)}</code>` : ''
    }${mediaType ? ` (${escapeHtml(mediaType)})` : ''}</p>
    <pre style="margin:4px 0;padding:8px;background:#f5f5f5;white-space:pre-wrap;overflow-wrap:anywhere;font-family:monospace;font-size:12px;">${escapeHtml(
      value,
    )}</pre>`;
}

function renderParameterDetails(
  parameters: readonly ExportParameter[],
  borderStyle: string,
  labels: OfficeDocLabels,
): string {
  return parameters
    .flatMap((parameter) => {
      const fields = parameter.schema?.fields ?? [];
      const example = parameter.example;
      if (
        fields.length === 0 &&
        example?.value === undefined &&
        !parameter.encodings?.length &&
        !parameter.notes?.length
      )
        return [];
      const metadata = parameter.schema
        ? ` &nbsp;<span style="font-weight:400;color:#555;">${
            parameter.schema.mediaType
              ? `${labels.mediaType}: <code>${escapeHtml(parameter.schema.mediaType)}</code> &nbsp;`
              : ''
          }${labels.type}: <code>${escapeHtml(parameter.schema.typeDisplay)}</code></span>`
        : '';
      return [
        `<p style="margin:8px 0 2px;font-size:13px;font-weight:600;">${labels.parameters} <code>${escapeHtml(
          parameter.name,
        )}</code>${metadata}</p>
        ${fields.length ? renderFieldTable(fields, borderStyle, labels) : ''}
        ${
          example?.value === undefined
            ? ''
            : renderHtmlExample(`${labels.requestExample}: ${parameter.name}`, example.mediaType, example.value)
        }
        ${renderOas32MediaExtras(
          {
            description: '',
            required: false,
            encodings: parameter.encodings,
            notes: parameter.notes,
            schema: parameter.schema,
          },
          labels,
          borderStyle,
        )}`,
      ];
    })
    .join('');
}

function renderRequestBodySection(
  requestBody: ExportRequestBody | undefined,
  borderStyle: string,
  labels: OfficeDocLabels,
): string {
  const schema = requestBody?.schema;
  const example = requestBody?.example;
  if (
    !schema &&
    example?.value === undefined &&
    !requestBody?.notes?.length &&
    !requestBody?.itemSchema &&
    !requestBody?.sequentialKind &&
    !requestBody?.encodings?.length
  ) {
    return '';
  }
  const mediaType = schema?.mediaType ?? example?.mediaType ?? requestBody?.itemSchema?.mediaType ?? '';
  return `
    <p style="margin:6px 0 2px;font-size:13px;font-weight:600;">${labels.requestBody} (${escapeHtml(
      mediaType,
    )}) &nbsp;<span style="font-weight:400;color:#555;">${
      schema ? `${labels.type}: <code>${escapeHtml(schema.typeDisplay)}</code> &nbsp;` : ''
    }${labels.required}: ${requestBody?.required ? labels.yes : labels.no}</span></p>
    ${
      requestBody?.description
        ? `<p style="margin:2px 0 4px;font-size:13px;color:#666;">${escapeHtml(requestBody.description)}</p>`
        : ''
    }
    ${schema?.fields.length ? renderFieldTable(schema.fields, borderStyle, labels) : ''}
    ${example?.value !== undefined ? renderHtmlExample(labels.requestExample, example.mediaType, example.value) : ''}
    ${renderOas32MediaExtras(requestBody, labels, borderStyle)}`;
}

function renderResponseSection(
  responses: readonly ExportResponse[],
  borderStyle: string,
  labels: OfficeDocLabels,
): string {
  if (!responses.length) return '';

  const parts: string[] = [`<p style="margin:8px 0 2px;font-size:13px;font-weight:600;">${labels.responses}</p>`];
  parts.push(`
    <table style="width:100%;border-collapse:collapse;margin:4px 0 10px;font-size:13px;">
      <thead><tr style="background:#f5f5f5;">
        <th style="${borderStyle}text-align:left;width:90px;">${labels.statusCode}</th>
        <th style="${borderStyle}text-align:left;">${labels.description}</th>
        <th style="${borderStyle}text-align:left;width:220px;">${labels.schema}</th>
      </tr></thead>
      <tbody>
        ${responses
          .map(
            (response) => `<tr>
              <td style="${borderStyle}"><code>${escapeHtml(response.statusCode)}</code></td>
              <td style="${borderStyle}">${escapeHtml(
                [response.summary, response.description].filter(Boolean).join(' — '),
              )}</td>
              <td style="${borderStyle}"><code>${escapeHtml(response.schema?.typeDisplay ?? '—')}</code></td>
            </tr>`,
          )
          .join('')}
      </tbody>
    </table>`);

  for (const response of responses) {
    const schema = response.schema;
    if (schema?.fields.length) {
      parts.push(`
        <p style="margin:8px 0 2px;font-size:13px;font-weight:600;">${labels.response} <code>${escapeHtml(
          response.statusCode,
        )}</code> (${escapeHtml(schema.mediaType)}) &nbsp;<span style="font-weight:400;color:#555;">${
          labels.type
        }: <code>${escapeHtml(schema.typeDisplay)}</code></span></p>
        ${renderFieldTable(schema.fields, borderStyle, labels)}`);
    }
    if (response.example?.value !== undefined) {
      parts.push(
        renderHtmlExample(
          labels.responseExample,
          response.example.mediaType,
          response.example.value,
          response.statusCode,
        ),
      );
    }
    parts.push(renderOas32MediaExtras(response, labels, borderStyle));
  }

  return parts.join('');
}

function renderOperation(operation: ExportOperation, labels: OfficeDocLabels): string {
  const color = methodColor(operation.method);
  const bodyHtml = renderRequestBodySection(operation.requestBody, 'border:1px solid #ddd;padding:5px 8px;', labels);
  const responseHtml = renderResponseSection(operation.responses, 'border:1px solid #ddd;padding:5px 8px;', labels);
  return `
    <div style="margin:14px 0;border:1px solid #e8e8e8;border-radius:4px;overflow:hidden;">
      <div style="padding:8px 12px;background:#fafafa;display:flex;align-items:center;gap:10px;">
        <span style="background:${color};color:#fff;padding:2px 8px;border-radius:3px;font-size:12px;font-weight:600;min-width:56px;text-align:center;">${escapeHtml(
          operation.method,
        )}</span>
        <span style="font-family:monospace;font-size:14px;">${escapeHtml(operation.path)}</span>
        ${operation.deprecated ? `<span style="color:#f93e3e;font-size:12px;margin-left:8px;">[${labels.deprecated}]</span>` : ''}
      </div>
      ${operation.summary ? `<div style="padding:5px 12px;font-size:14px;">${escapeHtml(operation.summary)}</div>` : ''}
      ${
        operation.description
          ? `<div style="padding:3px 12px;font-size:13px;color:#666;">${escapeHtml(operation.description)}</div>`
          : ''
      }
      ${operation.notes?.length ? `<div style="padding:5px 12px;">${renderNotes(operation.notes)}</div>` : ''}
      ${
        operation.security?.length || operation.servers?.length
          ? `<div style="padding:5px 12px;">${renderSecurity(operation.security, labels)}${renderServers(
              operation.servers,
              labels,
            )}</div>`
          : ''
      }
      ${
        operation.parameters.length
          ? `<div style="padding:5px 12px;">${renderParamTable(operation.parameters, labels)}${renderParameterDetails(
              operation.parameters,
              'border:1px solid #ddd;padding:5px 8px;',
              labels,
            )}</div>`
          : ''
      }
      ${bodyHtml ? `<div style="padding:5px 12px;">${bodyHtml}</div>` : ''}
      ${responseHtml ? `<div style="padding:5px 12px;">${responseHtml}</div>` : ''}
    </div>`;
}

export function renderHtmlDoc(snapshot: OfflineDocumentSnapshot, labels: OfficeDocLabels): string {
  const model = snapshot.document;
  const sections = model.tags
    .map((tag) => {
      const ops = tag.operations.map((operation) => renderOperation(operation, labels)).join('');
      return `
      <div style="margin-bottom:28px;">
        <h2 style="border-left:4px solid #00ab6d;padding-left:10px;margin:20px 0 10px;">${escapeHtml(tag.name)}</h2>
        ${
          tag.summary || tag.parent || tag.kind
            ? `<p style="color:#666;margin-bottom:6px;font-size:13px;">${escapeHtml(
                [
                  tag.summary,
                  tag.parent ? `parent=${tag.parent}` : undefined,
                  tag.kind ? `kind=${tag.kind}` : undefined,
                ]
                  .filter(Boolean)
                  .join(' · '),
              )}</p>`
            : ''
        }
        ${tag.description ? `<p style="color:#666;margin-bottom:10px;">${escapeHtml(tag.description)}</p>` : ''}
        ${ops}
      </div>`;
    })
    .join('');

  return `<!DOCTYPE html>
<html lang="${labels.language}">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>${escapeHtml(model.title)}</title>
  <style>
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;margin:0;padding:0;color:#333;}
    .wrap{max-width:960px;margin:0 auto;padding:24px;}
    h1{text-align:center;color:#00ab6d;}
    .info{background:#f9f9f9;border:1px solid #e8e8e8;border-radius:4px;padding:14px;margin-bottom:20px;}
    .export-incomplete{background:#fff7e6;border:1px solid #ffd591;border-radius:4px;padding:12px 14px;margin-bottom:20px;color:#873800;}
    .export-incomplete p{margin:6px 0;}
    .export-incomplete ul{margin:6px 0 0;padding-left:20px;}
    code{background:#f5f5f5;padding:1px 4px;border-radius:3px;font-size:12px;}
  </style>
</head>
<body>
  <div class="wrap">
    <h1>${escapeHtml(model.title)}</h1>
    <div class="info">
      <p><strong>${labels.version}:</strong> ${escapeHtml(model.version)}</p>
      ${model.description ? `<p><strong>${labels.description}:</strong> ${escapeHtml(model.description)}</p>` : ''}
      ${renderServers(model.servers, labels)}
      ${renderSecuritySchemes(model.securitySchemes, labels)}
    </div>
    ${renderIncompleteHtml(snapshot, labels)}
    ${sections}
  </div>
</body>
</html>`;
}

export function buildHtmlDoc(doc: SwaggerDoc, tags: MenuTag[], labels: OfficeDocLabels): string {
  return renderHtmlDoc(buildDocumentSnapshot(doc, tags, labels), labels);
}

export function renderWordDoc(snapshot: OfflineDocumentSnapshot, labels: OfficeDocLabels): string {
  const border = 'border:1px solid #000;padding:4px 6px;';
  const model = snapshot.document;
  const sections = model.tags
    .map((tag) => {
      const ops = tag.operations
        .map((operation) => {
          const paramRows = operation.parameters
            .map(
              (p) => `
        <tr>
          <td style="${border}">${escapeHtml(p.name)}</td>
          <td style="${border}">${escapeHtml(p.location)}</td>
          <td style="${border}">${p.required ? labels.yes : labels.no}</td>
          <td style="${border}">${escapeHtml(p.typeDisplay)}</td>
          <td style="${border}">${escapeHtml(p.description)}</td>
        </tr>`,
            )
            .join('');
          const paramTable = operation.parameters.length
            ? `
        <table style="width:100%;border-collapse:collapse;margin:6px 0;font-size:12px;">
          <thead><tr style="background:#e8e8e8;">
            <th style="${border}">${labels.name}</th>
            <th style="${border}">${labels.location}</th>
            <th style="${border}">${labels.required}</th>
            <th style="${border}">${labels.type}</th>
            <th style="${border}">${labels.description}</th>
          </tr></thead>
          <tbody>${paramRows}</tbody>
            </table>${renderParameterDetails(operation.parameters, border, labels)}`
            : '';
          const bodyHtml = renderRequestBodySection(operation.requestBody, border, labels);
          const responseHtml = renderResponseSection(operation.responses, border, labels);
          return `
        <h2 style="margin:14px 0 6px;">${formatOutlineNumber(operation.numberPath)} ${escapeHtml(operation.title)}</h2>
        <div style="margin:10px 0;padding:8px;border:1px solid #ccc;">
          <p style="margin:0 0 4px;"><strong style="color:${methodColor(operation.method)};">[${escapeHtml(
            operation.method,
          )}]</strong> <code>${escapeHtml(operation.path)}</code>${
            operation.deprecated ? ` <em style="color:red;">[${labels.deprecated}]</em>` : ''
          }</p>
          ${
            operation.description
              ? `<p style="margin:2px 0;font-size:13px;color:#666;">${escapeHtml(operation.description)}</p>`
              : ''
          }
          ${renderNotes(operation.notes)}
          ${renderSecurity(operation.security, labels)}
          ${renderServers(operation.servers, labels)}
          ${paramTable}
          ${bodyHtml}
          ${responseHtml}
        </div>`;
        })
        .join('');
      return `
      <h1 style="border-left:4px solid #00ab6d;padding-left:8px;margin:20px 0 8px;">${formatOutlineNumber(
        tag.numberPath,
      )} ${escapeHtml(tag.name)}</h1>
      ${
        tag.summary || tag.parent || tag.kind
          ? `<p style="color:#666;margin-bottom:6px;font-size:13px;">${escapeHtml(
              [tag.summary, tag.parent ? `parent=${tag.parent}` : undefined, tag.kind ? `kind=${tag.kind}` : undefined]
                .filter(Boolean)
                .join(' · '),
            )}</p>`
          : ''
      }
      ${tag.description ? `<p style="color:#666;margin-bottom:8px;">${escapeHtml(tag.description)}</p>` : ''}
      ${ops}`;
    })
    .join('');

  return `<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.0 Transitional//EN">
<html lang="${labels.language}">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=utf-8"/>
  <title>${escapeHtml(model.title)}</title>
  <style>
    body{font-family:Arial,"Yu Gothic","Microsoft YaHei",sans-serif;font-size:14px;margin:20px;}
    .document-title{text-align:center;font-size:28px;font-weight:bold;margin:0.67em 0;}
    .export-incomplete{background:#fff7e6;border:1px solid #ffd591;padding:10px 12px;margin:12px 0;color:#873800;}
    code{font-family:monospace;}
  </style>
</head>
<body>
  <p class="document-title">${escapeHtml(model.title)}</p>
  <p><strong>${labels.version}:</strong> ${escapeHtml(model.version)}</p>
  ${model.description ? `<p><strong>${labels.description}:</strong> ${escapeHtml(model.description)}</p>` : ''}
  ${renderServers(model.servers, labels)}
  ${renderSecuritySchemes(model.securitySchemes, labels)}
  ${renderIncompleteHtml(snapshot, labels)}
  <hr/>
  ${sections}
</body>
</html>`;
}

export function buildWordDoc(doc: SwaggerDoc, tags: MenuTag[], labels: OfficeDocLabels): string {
  return renderWordDoc(buildDocumentSnapshot(doc, tags, labels), labels);
}
