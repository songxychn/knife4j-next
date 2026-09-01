import type { FormBodyEncodingPlan, MultipartFilePart, MultipartPart } from 'knife4j-core';

export interface MaterializedMultipartBody {
  readonly body: FormData | Blob;
  /** Undefined means the browser must generate multipart/form-data + boundary. */
  readonly contentType?: string;
  readonly mode: 'form-data' | 'encoded';
}

export interface MaterializeMultipartBodyOptions {
  readonly boundaryFactory?: () => string;
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
  if (normalizedMediaType(plan.mediaType) !== 'multipart/form-data') return false;
  for (const part of plan.parts) {
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

/**
 * Materialize the immutable core plan without inspecting file bytes.
 * Native FormData is used when it can express the plan exactly; typed/custom
 * parts use a Blob MIME envelope so per-part headers remain truthful.
 */
export function materializeMultipartBody(
  plan: Extract<FormBodyEncodingPlan, { kind: 'multipart' }>,
  files: FileMap,
  options: MaterializeMultipartBodyOptions = {},
): MaterializedMultipartBody {
  if (canUseNativeFormData(plan, files)) {
    const formData = new FormData();
    for (const part of plan.parts) {
      if (part.kind === 'text') formData.append(part.name, part.value);
      else formData.append(part.name, fileForPart(part, files));
    }
    return { body: formData, mode: 'form-data' };
  }

  const boundary = (options.boundaryFactory ?? defaultBoundary)();
  if (!boundary || /[\r\n"]/u.test(boundary)) throw new Error('Multipart boundary is invalid.');
  const chunks: BlobPart[] = [];
  for (const part of plan.parts) {
    let header = `--${boundary}\r\nContent-Disposition: form-data; name="${safeQuotedHeaderParameter(part.name)}"`;
    if (part.kind === 'file') {
      header += `; filename="${safeQuotedHeaderParameter(part.fileName)}"`;
    }
    header += '\r\n';
    if (part.contentType) header += safeHeaderLine('Content-Type', part.contentType);
    for (const [name, value] of Object.entries(part.headers)) header += safeHeaderLine(name, value);
    header += '\r\n';
    chunks.push(header);
    chunks.push(part.kind === 'file' ? fileForPart(part, files) : part.value);
    chunks.push('\r\n');
  }
  chunks.push(`--${boundary}--\r\n`);
  return {
    body: new Blob(chunks),
    contentType: topLevelContentType(plan.mediaType, boundary),
    mode: 'encoded',
  };
}
