import { SchemaDocumentWorkerHandler } from './schemaDocumentWorkerRuntime';
import type { SchemaWorkerRequest } from './schemaDocumentWorkerProtocol';

const port = globalThis as unknown as {
  onmessage: ((event: MessageEvent<SchemaWorkerRequest>) => void) | null;
  postMessage(value: unknown): void;
};
const handler = new SchemaDocumentWorkerHandler((response) => port.postMessage(response));

// Defense in depth: even another protocol caller cannot run two realm-global registry operations concurrently.
let tail = Promise.resolve();
port.onmessage = (event) => {
  tail = tail.then(async () => port.postMessage(await handler.handle(event.data)));
};
