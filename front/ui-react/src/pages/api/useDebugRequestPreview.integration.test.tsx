import { buildOperationDebugModel } from 'knife4j-core';
import { StrictMode, act, useLayoutEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, test } from 'vitest';
import { resolveSendPreview } from './requestPreviewBuild';
import type { RequestPreviewBuildResult } from './requestPreviewBuild';
import type { DebugFormState } from './useDebugFormState';
import { useDebugRequestPreview } from './useDebugRequestPreview';

const baseUrl = 'https://api.example.test';
const mediaType = 'multipart/mixed';
const form: DebugFormState = {
  baseUrl,
  path: '/submit',
  method: 'POST',
  cookieParameterSource: 'explicit',
  paramValues: {},
  paramEnabled: {},
  oas32ParameterEntries: {},
  serializedBodyMedia32: undefined,
  body: '',
  selectedContentType: mediaType,
  formFields: {},
  formPartHeaders: {},
  formPartContentTypes: {},
  rawMode: 'text',
  customQueryParams: [],
  customBodyParams: [],
  customHeaders: [],
  customCookies: [],
};

const debugModel = buildOperationDebugModel({
  doc: {
    openapi: '3.2.0',
    info: { title: 'File upload', version: '1' },
    paths: {
      '/submit': {
        post: {
          requestBody: {
            content: {
              [mediaType]: {
                schema: { type: 'array', prefixItems: [{ type: 'string', format: 'binary' }] },
                prefixEncoding: [{ contentType: 'application/octet-stream' }],
              },
            },
          },
          responses: { '204': { description: 'Saved' } },
        },
      },
    },
  },
  path: form.path,
  method: form.method,
});

function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

test('commits one matching cURL and MIME body, and refreshes the bytes when a file is replaced', async () => {
  const root = createRoot(document.createElement('div'));
  const commits: (RequestPreviewBuildResult | null)[] = [];
  function Preview({ files }: { files: Record<string, File[]> }) {
    const preview = useDebugRequestPreview({
      enabled: true,
      baseUrl,
      form,
      debugModel,
      preserveMethodCase: false,
      isOas32: true,
      enableDynamicParameter: false,
      serverUnavailable: false,
      serverUnavailableMessage: 'Unavailable',
      unrepresentableMultipartMessage: 'Cannot encode multipart',
      effectiveCookieSource: 'explicit',
      credentials: 'same-origin',
      sessionCurlNote: '',
      fileFields: files,
      binaryBodyFile: null,
      editRevision: 0,
      exampleSession32: undefined,
      proxyOrigin: baseUrl,
    });
    useLayoutEffect(() => {
      commits.push(preview);
    });
    return null;
  }

  async function render(files: Record<string, File[]>) {
    await act(async () =>
      root.render(
        <StrictMode>
          <Preview files={files} />
        </StrictMode>,
      ),
    );
    const preview = commits.at(-1);
    if (!preview?.ok) throw new Error(preview?.error ?? 'Missing preview');
    return preview;
  }

  const fileOptions = { type: 'application/octet-stream', lastModified: 1 };
  const originalFiles = { '0': [new File(['first'], 'upload.bin', fileOptions)] };
  try {
    const first = await render(originalFiles);
    const envelope = first.value.materializedMultipart;
    if (!envelope?.contentType || !(envelope.body instanceof Blob)) throw new Error('Missing encoded multipart');
    expect(first.value.curl).toContain(envelope.contentType);
    expect(first.value.built.headers['Content-Type']).toBe(envelope.contentType);
    expect(await readBlob(envelope.body)).toContain('\r\nfirst\r\n');
    expect(resolveSendPreview(undefined, first)).toBe(first);
    expect(await render(originalFiles)).toBe(first);

    const second = await render({ '0': [new File(['other'], 'upload.bin', fileOptions)] });
    expect(second.value.materializedMultipart).not.toBe(envelope);
    expect(await readBlob(second.value.materializedMultipart!.body as Blob)).toContain('\r\nother\r\n');
    expect(resolveSendPreview(first.value, second)).toEqual({ ok: true, value: first.value });
  } finally {
    await act(async () => root.unmount());
  }
});
