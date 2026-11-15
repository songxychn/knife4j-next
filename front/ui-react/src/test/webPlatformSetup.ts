export {};

// Bun 1.4 appends charset=utf-8 to native Blob/File MIME types. Browser unit
// tests must retain the File API's ASCII lowercase type, without changing any
// product MIME assertions. Keep native storage so object URLs still work.
const NativeBlob = globalThis.Blob;
const blobType = (type: string | undefined) => {
  const value = type === undefined ? '' : String(type);
  return /^[\x20-\x7e]*$/.test(value) ? value.toLowerCase() : '';
};
class BrowserBlob extends NativeBlob {
  readonly #type: string;
  constructor(parts: BlobPart[] = [], options: BlobPropertyBag = {}) {
    super(parts, options);
    this.#type = blobType(options.type);
  }
  get type() {
    return this.#type;
  }
  slice(start?: number, end?: number, type?: string) {
    return new BrowserBlob([super.slice(start, end, type)], { type });
  }
}
class BrowserFile extends BrowserBlob implements File {
  readonly name: string;
  readonly lastModified: number;
  readonly webkitRelativePath = '';
  constructor(parts: BlobPart[], name: string, options: FilePropertyBag = {}) {
    super(parts, options);
    this.name = String(name);
    this.lastModified = options.lastModified ?? Date.now();
  }
  get [Symbol.toStringTag]() {
    return 'File';
  }
}
Object.assign(globalThis, { Blob: BrowserBlob, File: BrowserFile });
// Use the actual npm implementation: Bun's Response.blob() loses stream MIME
// types. Loading by file path avoids Bun's built-in undici replacement.
const { Response, Request, Headers, FormData } = await import('undici/index.js');
Object.assign(globalThis, { Response, Request, Headers, FormData });
