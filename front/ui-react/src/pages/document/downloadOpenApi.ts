import { stringify } from 'yaml';
import type { SwaggerDoc } from '../../types/swagger';
import { downloadBlob } from './downloadDocumentBlob';

export function downloadOpenApi(document: SwaggerDoc, format: 'json' | 'yaml'): void {
  const title = document.info.title || 'api-docs';
  const content =
    format === 'json' ? JSON.stringify(document, null, 2) : stringify(document, { aliasDuplicateObjects: false });
  downloadBlob(content, `${title}.openapi.${format}`, `application/${format};charset=utf-8`);
}
