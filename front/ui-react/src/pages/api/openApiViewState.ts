import { isOpenApi31Version } from 'knife4j-core';
import type { ResourceGraphSnapshot } from '../../schema/externalResourceGraph';
import type { MenuOperation, SwaggerDoc } from '../../types/swagger';
import {
  buildOperationOpenApiPreviewDocument,
  serializeOperationOpenApiDocument,
  supportsOperationOpenApiDownload,
} from './operationOpenApiDocument';
import { buildOas31OperationOpenApiDocument, type Oas31OperationExportBlocker } from './oas31OperationOpenApiDocument';

type JsonRecord = Record<string, unknown>;

export type Oas31ExportAvailability =
  | {
      readonly status: 'ready';
      readonly retrievalUri: string;
      readonly snapshot: ResourceGraphSnapshot;
    }
  | { readonly status: 'loading' }
  | { readonly status: 'unavailable' };

export type OpenApiDownloadNotice =
  | { readonly kind: 'version-unsupported' }
  | { readonly kind: 'oas31-loading' }
  | { readonly kind: 'oas31-unavailable' }
  | { readonly kind: 'oas31-blocked'; readonly blockers: readonly Oas31OperationExportBlocker[] };

export type OpenApiViewState =
  | { readonly status: 'empty' }
  | { readonly status: 'error' }
  | {
      readonly status: 'ready';
      readonly downloadable: boolean;
      readonly json: string;
      readonly notice: OpenApiDownloadNotice | null;
    };

function oas31FallbackPreview(swaggerDoc: SwaggerDoc, operation: MenuOperation): JsonRecord {
  const source = swaggerDoc as unknown as JsonRecord;
  const output: JsonRecord = {
    openapi: source.openapi,
    info: source.info,
  };
  if (Object.prototype.hasOwnProperty.call(source, 'jsonSchemaDialect')) {
    output.jsonSchemaDialect = source.jsonSchemaDialect;
  }
  const pathItem = { [operation.method.toLowerCase()]: operation.operation };
  output[operation.source === 'webhook' ? 'webhooks' : 'paths'] = { [operation.path]: pathItem };
  return output;
}

function previewDocument(swaggerDoc: SwaggerDoc, operation: MenuOperation): JsonRecord | null {
  const preview = buildOperationOpenApiPreviewDocument(
    swaggerDoc,
    operation.path,
    operation.method,
    operation.source ?? 'path',
  );
  if (preview || !isOpenApi31Version(swaggerDoc.openapi)) return preview;
  return oas31FallbackPreview(swaggerDoc, operation);
}

export function buildOpenApiViewState(
  swaggerDoc: SwaggerDoc | null,
  operation: MenuOperation | undefined,
  oas31Availability: Oas31ExportAvailability,
): OpenApiViewState {
  if (!swaggerDoc || !operation) return { status: 'empty' };

  try {
    if (isOpenApi31Version(swaggerDoc.openapi)) {
      if (oas31Availability.status === 'ready') {
        const portable = buildOas31OperationOpenApiDocument(
          swaggerDoc,
          operation.path,
          operation.method,
          operation.source ?? 'path',
          {
            retrievalUri: oas31Availability.retrievalUri,
            snapshot: oas31Availability.snapshot,
          },
        );
        if (portable?.status === 'ready') {
          return {
            status: 'ready',
            downloadable: true,
            json: serializeOperationOpenApiDocument(portable.document),
            notice: null,
          };
        }

        const preview = previewDocument(swaggerDoc, operation);
        if (!preview) return { status: 'empty' };
        return {
          status: 'ready',
          downloadable: false,
          json: serializeOperationOpenApiDocument(preview),
          notice: portable ? { kind: 'oas31-blocked', blockers: portable.blockers } : { kind: 'oas31-unavailable' },
        };
      }

      const preview = previewDocument(swaggerDoc, operation);
      if (!preview) return { status: 'empty' };
      return {
        status: 'ready',
        downloadable: false,
        json: serializeOperationOpenApiDocument(preview),
        notice: { kind: oas31Availability.status === 'loading' ? 'oas31-loading' : 'oas31-unavailable' },
      };
    }

    const preview = previewDocument(swaggerDoc, operation);
    if (!preview) return { status: 'empty' };
    const downloadable = operation.source !== 'webhook' && supportsOperationOpenApiDownload(swaggerDoc);
    return {
      status: 'ready',
      downloadable,
      json: serializeOperationOpenApiDocument(preview),
      notice: downloadable ? null : { kind: 'version-unsupported' },
    };
  } catch {
    return { status: 'error' };
  }
}
