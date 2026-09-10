import type { FormBodyEncodingPlan, MultipartFilePart, MultipartNestedPart, MultipartPart } from 'knife4j-core';

export interface MaterializedMultipartBody {
  readonly body: FormData | Blob;
  /** Undefined means the browser must generate multipart/form-data + boundary. */
  readonly contentType?: string;
  readonly mode: 'form-data' | 'encoded';
}

export interface MaterializeMultipartBodyOptions {
  readonly boundaryFactory?: () => string;
  readonly signal?: AbortSignal;
}

type FileMap = Readonly<Record<string, readonly File[]>>;

function normalizedMediaType(value: string): string {
  return value.trim().toLowerCase();
}

function hasHeaders(part: MultipartPart): boolean {
  return Object.keys(part.headers).length > 0;
}

function fileForPart(part: MultipartFilePart, files: FileMap): File {
  const file = files[part.sourceField]?.[part.fileIndex];
  if (!file) throw new Error(`Multipart file snapshot is unavailable for ${part.sourceField}[${part.fileIndex}].`);
  return file;
}

function canUseNativeFormData(plan: Extract<FormBodyEncodingPlan, { kind: 'multipart' }>, files: FileMap): boolean {
  if (plan.specFamily === '3.2' || plan.wire === 'authored') return false;
  if (normalizedMediaType(plan.mediaType) !== 'multipart/form-data') return false;
  for (const part of plan.parts) {
    if (part.kind === 'nested' || !part.name) return false;
    if (hasHeaders(part)) return false;
    if (part.kind === 'text') {
      if (normalizedMediaType(part.contentType) !== 'text/plain') return false;
      continue;
    }
    const file = fileForPart(part, files);
    const actualType = normalizedMediaType(file.type || 'application/octet-stream');
    if (actualType !== normalizedMediaType(part.contentType)) return false;
  }
  return true;
}

function safeQuotedHeaderParameter(value: string): string {
  if (/\r|\n/.test(value)) throw new Error('Multipart disposition metadata contains a forbidden line break.');
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function safeHeaderLine(name: string, value: string): string {
  if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || /\r|\n/.test(value)) {
    throw new Error(`Multipart header ${name} contains unsafe framing characters.`);
  }
  return `${name}: ${value}\r\n`;
}

function defaultBoundary(): string {
  const random = globalThis.crypto?.randomUUID?.().replace(/-/g, '') ?? Math.random().toString(36).slice(2);
  return `----Knife4jFormBoundary${random}`;
}

function mediaTypeParameters(value: string): string[] {
  const segments: string[] = [];
  let start = 0;
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === ';') {
      segments.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  segments.push(value.slice(start).trim());
  return segments;
}

function topLevelContentType(mediaType: string, boundary: string): string {
  const withoutBoundary = mediaTypeParameters(mediaType)
    .filter((part, index) => index === 0 || !/^boundary\s*=/i.test(part))
    .filter(Boolean)
    .join('; ');
  return `${withoutBoundary}; boundary=${boundary}`;
}

function partContainsBoundary(part: MultipartPart, boundary: string): boolean {
  if (part.kind === 'text') return part.value.includes(`--${boundary}`);
  if (part.kind === 'nested') return part.parts.some((child) => partContainsBoundary(child, boundary));
  return part.fileName.includes(`--${boundary}`);
}

function pickBoundary(
  parts: readonly MultipartPart[],
  factory: () => string,
  signal: AbortSignal | undefined,
  reserved: ReadonlySet<string> = new Set(),
): string {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (signal?.aborted) throw new Error('Multipart materialization was cancelled.');
    const generated = factory();
    if (!generated || /[\r\n"]/u.test(generated)) throw new Error('Multipart boundary is invalid.');
    const boundary = reserved.has(generated) ? `${generated}-${attempt + 1}` : generated;
    if (reserved.has(boundary) || /[\r\n"]/u.test(boundary)) continue;
    if (parts.some((part) => partContainsBoundary(part, boundary))) {
      if (!reserved.has(generated)) throw new Error('Multipart boundary collides with part contents.');
      continue;
    }
    return boundary;
  }
  throw new Error('Multipart boundary collides with part contents.');
}

function dispositionHeader(part: MultipartPart): string | undefined {
  const declared = Object.entries(part.headers).find(([name]) => name.toLowerCase() === 'content-disposition');
  if (declared) return declared[1];
  if (part.kind === 'file' && !part.name) {
    return `attachment; filename="${safeQuotedHeaderParameter(part.fileName)}"`;
  }
  if (!part.name) return undefined;
  let value = `form-data; name="${safeQuotedHeaderParameter(part.name)}"`;
  if (part.kind === 'file') value += `; filename="${safeQuotedHeaderParameter(part.fileName)}"`;
  return value;
}

function encodeParts(
  parts: readonly MultipartPart[],
  files: FileMap,
  boundary: string,
  boundaryFactory: () => string,
  signal: AbortSignal | undefined,
  reserved: ReadonlySet<string>,
): BlobPart[] {
  const chunks: BlobPart[] = [];
  for (const part of parts) {
    if (signal?.aborted) throw new Error('Multipart materialization was cancelled.');
    let header = `--${boundary}\r\n`;
    const disposition = dispositionHeader(part);
    if (disposition) header += safeHeaderLine('Content-Disposition', disposition);
    let contentType = part.contentType;
    let nestedChunks: BlobPart[] | undefined;
    if (part.kind === 'nested') {
      const innerReserved = new Set(reserved);
      innerReserved.add(boundary);
      const innerBoundary = pickBoundary(part.parts, boundaryFactory, signal, innerReserved);
      contentType = topLevelContentType(part.contentType || 'multipart/mixed', innerBoundary);
      nestedChunks = encodeParts(part.parts, files, innerBoundary, boundaryFactory, signal, innerReserved);
    }
    if (contentType) header += safeHeaderLine('Content-Type', contentType);
    for (const [name, value] of Object.entries(part.headers)) {
      if (name.toLowerCase() === 'content-disposition' || name.toLowerCase() === 'content-type') continue;
      header += safeHeaderLine(name, value);
    }
    header += '\r\n';
    chunks.push(header);
    if (part.kind === 'nested' && nestedChunks) chunks.push(...nestedChunks);
    else if (part.kind === 'file') chunks.push(fileForPart(part, files));
    else if (part.kind === 'text') chunks.push(part.value);
    chunks.push('\r\n');
  }
  chunks.push(`--${boundary}--\r\n`);
  return chunks;
}

/**
 * Materialize the immutable core plan without inspecting file bytes.
 * Native FormData is used when it can express the plan exactly; typed/custom
 * parts use a Blob MIME envelope so per-part headers remain truthful.
 * OAS 3.2 never silently downgrades to a flat FormData envelope.
 */
export function materializeMultipartBody(
  plan: Extract<FormBodyEncodingPlan, { kind: 'multipart' }>,
  files: FileMap,
  options: MaterializeMultipartBodyOptions = {},
): MaterializedMultipartBody {
  if (options.signal?.aborted) throw new Error('Multipart materialization was cancelled.');
  if (plan.wire === 'authored') {
    if (plan.authoredBody === undefined) throw new Error('Authored multipart body is missing.');
    return {
      body: new Blob([plan.authoredBody]),
      contentType: plan.authoredContentType ?? plan.mediaType,
      mode: 'encoded',
    };
  }
  if (canUseNativeFormData(plan, files)) {
    const formData = new FormData();
    for (const part of plan.parts) {
      if (part.kind === 'text') formData.append(part.name, part.value);
      else if (part.kind === 'file') formData.append(part.name, fileForPart(part, files));
    }
    return { body: formData, mode: 'form-data' };
  }

  const factory = options.boundaryFactory ?? defaultBoundary;
  const reserved = new Set<string>();
  const boundary = pickBoundary(plan.parts, factory, options.signal, reserved);
  reserved.add(boundary);
  return {
    body: new Blob(encodeParts(plan.parts, files, boundary, factory, options.signal, reserved)),
    contentType: topLevelContentType(plan.mediaType, boundary),
    mode: 'encoded',
  };
}

export function multipartPlanNeedsEncodedEnvelope(plan: Extract<FormBodyEncodingPlan, { kind: 'multipart' }>): boolean {
  return (
    plan.specFamily === '3.2' ||
    plan.wire === 'authored' ||
    plan.parts.some((part) => part.kind === 'nested' || !part.name)
  );
}

export function nestedPart(part: MultipartPart): part is MultipartNestedPart {
  return part.kind === 'nested';
}
