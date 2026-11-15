import type { GlobalParamValues } from 'knife4j-core';
import type { GlobalParamScope, ScopedGlobalParamItem } from '../../context/GlobalParamContext';
import type { DebugCacheRawMode } from './debugCache';

export const METHOD_COLORS: Record<string, string> = {
  GET: 'green',
  POST: 'blue',
  PUT: 'orange',
  DELETE: 'red',
  PATCH: 'purple',
  HEAD: 'cyan',
  OPTIONS: 'default',
  TRACE: 'magenta',
};

export type RawMode = DebugCacheRawMode;

/** raw mode → Content-Type 映射 */
export const RAW_CONTENT_TYPES: Record<RawMode, string> = {
  text: 'text/plain',
  json: 'application/json',
  javascript: 'application/javascript',
  xml: 'application/xml',
  html: 'text/html',
};

export function globalParamValuesForScope(
  params: ScopedGlobalParamItem[],
  scope: GlobalParamScope,
): GlobalParamValues | undefined {
  const headers: Record<string, string> = {};
  const queries: Record<string, string> = {};
  for (const param of params) {
    if (param.scope !== scope || !param.enabled || param.value === undefined || param.value === '') continue;
    if (param.in === 'header') headers[param.name] = param.value;
    else if (param.in === 'query') queries[param.name] = param.value;
  }
  if (Object.keys(headers).length === 0 && Object.keys(queries).length === 0) return undefined;
  return { headers, queries };
}
