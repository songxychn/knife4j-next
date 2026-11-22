import { stringify } from 'yaml';

export {
  buildOperationOpenApiDocument,
  buildOperationOpenApiPreviewDocument,
  serializeOperationOpenApiDocument,
  supportsOperationOpenApiDownload,
} from 'knife4j-core/lib/openApiOperationExport';

const ILLEGAL_FILENAME_CHARACTERS = new Set('/\\:*?"<>|');

export function serializeOperationOpenApiYaml(document: unknown): string {
  const serialized = stringify(document, { aliasDuplicateObjects: false });
  if (typeof serialized !== 'string' || serialized.length === 0) {
    throw new TypeError('Unable to serialize the OpenAPI document as YAML');
  }
  return serialized;
}

export function buildOperationOpenApiFilename(
  method: string,
  path: string,
  operationId?: string,
  format: 'json' | 'yaml' = 'json',
): string {
  const identity = operationId?.trim() || path.trim() || 'operation';
  let safeCharacters = '';
  let previousCharacterWasIllegal = false;
  Array.from(`${method.toUpperCase()}-${identity}`).forEach((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    const illegal = codePoint <= 0x1f || codePoint === 0x7f || ILLEGAL_FILENAME_CHARACTERS.has(character);
    if (illegal) {
      if (!previousCharacterWasIllegal) safeCharacters += '_';
    } else {
      safeCharacters += character;
    }
    previousCharacterWasIllegal = illegal;
  });
  const stem = safeCharacters.replace(/\s+/g, '_').replace(/^[. ]+|[. ]+$/g, '');
  return `${stem || 'operation'}.openapi.${format === 'yaml' ? 'yaml' : 'json'}`;
}

/**
 * Start a browser download. Returns false when the required browser APIs are
 * unavailable; runtime failures are left to the caller to report.
 */
export function downloadOperationOpenApiJson(
  content: string,
  filename: string,
  mimeType = 'application/json;charset=utf-8',
): boolean {
  if (
    typeof Blob === 'undefined' ||
    typeof document === 'undefined' ||
    !document.body ||
    typeof URL === 'undefined' ||
    typeof URL.createObjectURL !== 'function' ||
    typeof URL.revokeObjectURL !== 'function' ||
    typeof globalThis.setTimeout !== 'function'
  ) {
    return false;
  }

  const anchor = document.createElement('a');
  if (!('download' in anchor) || typeof anchor.click !== 'function') return false;

  const blob = new Blob([content], { type: mimeType });
  const objectUrl = URL.createObjectURL(blob);
  const revokeObjectURL = URL.revokeObjectURL.bind(URL);

  try {
    anchor.href = objectUrl;
    anchor.download = filename;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    return true;
  } finally {
    try {
      anchor.remove();
    } finally {
      globalThis.setTimeout(() => revokeObjectURL(objectUrl), 100);
    }
  }
}
