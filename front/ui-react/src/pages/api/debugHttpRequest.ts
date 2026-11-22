import type { BodyContent, BuiltRequest, DebugFormValues } from 'knife4j-core';
import { multipartPlanNeedsEncodedEnvelope, type MaterializedMultipartBody } from './formBodyRequest';

export interface DebugHttpRequestOptions {
  built: BuiltRequest;
  formValues: DebugFormValues;
  activeBodyContent?: BodyContent;
  multipartTextFields: Record<string, string>;
  preparedMultipart?: MaterializedMultipartBody;
  binaryFile: File | null;
  credentials: RequestCredentials;
  signal: AbortSignal;
  isOas32: boolean;
  unrepresentableMessage: string;
}

export function applyMaterializedMultipartContentType(
  headers: Record<string, string>,
  contentType: string | undefined,
): void {
  for (const name of Object.keys(headers)) {
    if (name.toLowerCase() === 'content-type') delete headers[name];
  }
  if (contentType) headers['Content-Type'] = contentType;
}

/** Execute the already validated request snapshot; owns no React state or history. */
export async function sendDebugHttpRequest(options: DebugHttpRequestOptions): Promise<Response> {
  const {
    built,
    formValues,
    activeBodyContent,
    multipartTextFields,
    preparedMultipart,
    binaryFile,
    credentials,
    signal,
    isOas32,
    unrepresentableMessage,
  } = options;
  const multipartPlan = built.formBodyPlan?.kind === 'multipart' ? built.formBodyPlan : undefined;
  const isMultipart = Boolean(multipartPlan) || activeBodyContent?.category === 'multipart';
  const isBinaryBody = Boolean(activeBodyContent?.binary);
  const multipartFiles = (formValues.fileFields ?? {}) as Record<string, File[]>;
  const init: RequestInit = {
    method: built.method,
    headers: { ...built.headers },
    credentials,
    signal: signal,
  };

  if (isOas32 && isMultipart && !preparedMultipart && !multipartPlan) {
    throw new Error(unrepresentableMessage);
  }
  if (preparedMultipart) {
    init.body = preparedMultipart.body;
    applyMaterializedMultipartContentType(init.headers as Record<string, string>, preparedMultipart.contentType);
  } else if (multipartPlan && (isOas32 || multipartPlanNeedsEncodedEnvelope(multipartPlan))) {
    throw new Error(unrepresentableMessage);
  } else if (isMultipart) {
    // 构建 FormData
    const fd = new FormData();
    const jsonFieldSet = new Set(formValues.jsonFields ?? []);
    // 添加普通字段（非 JSON part）
    for (const [name, value] of Object.entries(multipartTextFields)) {
      if (jsonFieldSet.has(name)) {
        // JSON-encoded part: append as Blob with application/json content type
        fd.append(name, new Blob([value], { type: 'application/json' }), `${name}.json`);
      } else {
        fd.append(name, value);
      }
    }
    // 添加文件字段
    //
    // issue #251: single-file fields must only append ONE part even if the user
    // (or a Upload control bug) staged multiple. The server-side contract for
    // `@RequestPart("file") MultipartFile file` binds to the first part and
    // silently drops the rest, which is an invisible data-loss bug. We use
    // `fileFieldsMultiple` from knife4j-core to decide, matching the UI control
    // rendered in MultipartForm.
    const multipleFileNames = new Set(activeBodyContent?.fileFieldsMultiple ?? []);
    const files = multipartFiles;
    for (const [name, fileList] of Object.entries(files)) {
      if (fileList.length === 0) continue;
      if (multipleFileNames.has(name)) {
        for (const file of fileList) {
          fd.append(name, file);
        }
      } else {
        // Single-file: only the first staged file is sent. Belt-and-braces alongside
        // <Upload maxCount={1}>.
        fd.append(name, fileList[0]);
      }
    }
    init.body = fd;
    // 不设 Content-Type，让浏览器自动设 boundary
    delete (init.headers as Record<string, string>)['Content-Type'];
  } else if (isBinaryBody && binaryFile) {
    init.body = binaryFile;
  } else {
    if (built.body !== undefined && (built.body !== '' || built.explicitExampleBody === true)) {
      init.body = built.body;
    }
  }

  return fetch(built.url, init);
}
