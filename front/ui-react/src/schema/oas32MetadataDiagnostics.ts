import {
  getOpenApiSpecificationFeatures,
  validateOas32PathBindings,
  type OpenApiObjectLocation,
  type Oas32DocumentDiagnostic,
} from 'knife4j-core';
import type { MenuTag, SwaggerDoc } from '../types/swagger';
import { resolveOperationReference } from './operationRegistry';

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/** Bind only E's executable entry Paths mounts, using C-resolved effective Parameters. */
export function oas32MetadataDiagnostics(
  document: SwaggerDoc | null,
  groups: readonly MenuTag[],
): Oas32DocumentDiagnostic[] {
  if (getOpenApiSpecificationFeatures(document?.openapi)?.family !== '3.2') return [];
  const diagnostics: Oas32DocumentDiagnostic[] = [];
  const seen = new Set<string>();
  for (const menu of groups.flatMap((group) => group.operations)) {
    const operation = menu.identity;
    const snapshot = menu.resourceSnapshot;
    if (!operation || !snapshot || seen.has(operation.identity) || operation.source !== 'path') continue;
    seen.add(operation.identity);
    let complete = true;
    const parameters = new Map<
      string,
      { name: string; in: string; required?: boolean; location: OpenApiObjectLocation }
    >();
    const raw = record(operation.rawOperation.value) ? operation.rawOperation.value : {};
    const arrays = [
      operation.pathItemMembers.parameters,
      ...(Object.prototype.hasOwnProperty.call(raw, 'parameters')
        ? [
            {
              value: raw.parameters,
              ownerRetrievalUri: operation.rawOperation.ownerRetrievalUri,
              pointer: `${operation.rawOperation.pointer}/parameters`,
            },
          ]
        : []),
    ];
    for (const array of arrays) {
      if (!array) continue;
      if (!Array.isArray(array.value)) {
        complete = false;
        continue;
      }
      array.value.forEach((value, index) => {
        let site: OpenApiObjectLocation | null = { ...array, value, pointer: `${array.pointer}/${index}` };
        const visited = new Set<string>();
        for (let depth = 0; site && record(site.value) && typeof site.value.$ref === 'string'; depth++) {
          const key = JSON.stringify([site.ownerRetrievalUri, site.pointer]);
          if (depth >= 20 || visited.has(key)) {
            site = null;
            break;
          }
          visited.add(key);
          site = resolveOperationReference(snapshot, site, 'parameter');
        }
        if (!site || !record(site.value) || typeof site.value.name !== 'string' || typeof site.value.in !== 'string') {
          complete = false;
          return;
        }
        parameters.set(`${site.value.in}:${site.value.name}`, {
          name: site.value.name,
          in: site.value.in,
          required: site.value.required === true,
          location: site,
        });
      });
    }
    const checked = validateOas32PathBindings({
      source: operation.source,
      path: operation.path,
      location: { ownerRetrievalUri: snapshot.entryRetrievalUri, pointer: operation.mountPointer },
      parameters: [...parameters.values()],
      parametersComplete: complete,
    });
    diagnostics.push(
      ...checked.diagnostics.map((diagnostic) => ({
        code: diagnostic.code,
        path: diagnostic.pointer,
        reason: `${diagnostic.reason} (${diagnostic.ownerRetrievalUri})`,
      })),
    );
  }
  return [
    ...new Map(
      diagnostics.map((diagnostic) => [`${diagnostic.code}:${diagnostic.path}:${diagnostic.reason}`, diagnostic]),
    ).values(),
  ];
}
