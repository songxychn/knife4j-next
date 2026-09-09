import type { OpenApiObjectLocation } from 'knife4j-core';
import type { MenuOperation, SwaggerDoc } from '../types/swagger';
import { resolveOas32Server, selectOas32Servers } from './oas32ServerResolution';

const owns = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);

/** C/E provide physical owners; the entry root alone participates in inheritance. */
export function resolveOas32OperationServers(
  document: SwaggerDoc,
  operation?: MenuOperation | null,
  retrievalUri = '',
) {
  const identity = operation?.identity;
  const rootUri = operation?.resourceSnapshot?.entryRetrievalUri ?? retrievalUri;
  const raw = identity?.rawOperation;
  const pathServers = identity?.pathItemMembers.servers;
  const operationServers: OpenApiObjectLocation | undefined =
    raw && raw.value && typeof raw.value === 'object' && owns(raw.value, 'servers')
      ? {
          ownerRetrievalUri: raw.ownerRetrievalUri,
          pointer: `${raw.pointer}/servers`,
          value: (raw.value as Record<string, unknown>).servers,
        }
      : undefined;
  const selected = selectOas32Servers({
    root: { ownerRetrievalUri: rootUri, pointer: '#/servers', value: document.servers },
    ...(pathServers ? { pathItem: pathServers } : {}),
    ...(operationServers ? { operation: operationServers } : {}),
  });
  return { ...selected, resolutions: selected.servers.map((server) => resolveOas32Server(server)) };
}

/** A mount is appended to the Server base path by the existing request builder. */
export function oas32RequestBaseUrl(url: string | undefined): string {
  return url?.replace(/\/+$/, '') ?? '';
}
