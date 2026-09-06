import { isUriReference, normalizeUri, parseUri, resolveUri } from 'knife4j-schema-engine/uri';
import {
  parseOas32UrlTemplate,
  substituteOas32ServerVariables,
  type Oas32UrlDiagnostic,
  type Oas32UrlLocation,
  type Oas32UrlTemplate,
  type Oas32ServerVariableValue,
} from 'knife4j-core';

export type Oas32ServerLevel = 'operation' | 'path-item' | 'root' | 'default';

/** A servers field location, not the owning operation/path-item wrapper. */
export interface Oas32ServerListLocation extends Oas32UrlLocation {
  readonly value?: unknown;
}

export interface Oas32SelectedServer extends Oas32UrlLocation {
  /** Physical source + scope + array index. Equal URL/name values are not identity. */
  readonly key: string;
  readonly level: Oas32ServerLevel;
  readonly value: unknown;
}

export interface Oas32ServerDiagnostic extends Oas32UrlLocation {
  readonly code:
    | 'invalid-server-list'
    | 'invalid-server-object'
    | 'invalid-server-url'
    | 'invalid-server-metadata'
    | 'server-retrieval-unavailable'
    | 'invalid-server-uri-reference'
    | 'server-http-host-required'
    | 'server-query-or-fragment'
    | 'server-scheme-not-supported'
    | 'server-credentials-not-supported'
    | 'server-url-not-browser-executable';
  readonly category: 'invalid' | 'unavailable' | 'unsupported';
  readonly reason: string;
}

export type Oas32ServerResolutionDiagnostic = Oas32ServerDiagnostic | Oas32UrlDiagnostic;

/**
 * Operation > Path Item > root is replacement, not concatenation. A supplied
 * invalid/empty override remains the effective layer. Only absent or empty root
 * servers receive the OpenAPI Object's default [{ url: '/' }] (OAS 3.2 4.1.1).
 * The adapter passes E's physical owner for each field; there is no URI lookup here.
 */
export function selectOas32Servers({
  root,
  pathItem,
  operation,
}: {
  root: Oas32ServerListLocation;
  pathItem?: Oas32ServerListLocation;
  operation?: Oas32ServerListLocation;
}): {
  level: Oas32ServerLevel;
  source: Oas32ServerListLocation;
  servers: readonly Oas32SelectedServer[];
  diagnostics: readonly Oas32ServerDiagnostic[];
} {
  const source = operation ?? pathItem ?? root;
  let level: Oas32ServerLevel = operation ? 'operation' : pathItem ? 'path-item' : 'root';
  let value = source.value;
  if (level === 'root' && (value === undefined || (Array.isArray(value) && value.length === 0))) {
    level = 'default';
    value = [{ url: '/' }];
  }
  if (!Array.isArray(value))
    return {
      level,
      source,
      servers: [],
      diagnostics: [
        {
          ownerRetrievalUri: source.ownerRetrievalUri,
          pointer: source.pointer,
          code: 'invalid-server-list',
          category: 'invalid',
          reason: 'servers 必须是数组；不回退到其他层',
        },
      ],
    };
  const servers = value.map((server: unknown, index): Oas32SelectedServer => ({
    key: JSON.stringify([level, source.ownerRetrievalUri, source.pointer, index]),
    level,
    value: server,
    ownerRetrievalUri: source.ownerRetrievalUri,
    pointer: `${source.pointer}/${index}`,
  }));
  return { level, source, servers, diagnostics: [] };
}

export interface Oas32ResolvedServer {
  readonly source: Oas32SelectedServer;
  readonly name?: string;
  readonly description?: string;
  readonly rawUrl?: string;
  readonly template?: Oas32UrlTemplate;
  readonly variables: readonly Oas32ServerVariableValue[];
  readonly substitutedUrl?: string;
  /** RFC URI resolution against the actual owner retrieval, independent of $self and UI origin. */
  readonly resolvedUrl?: string;
  /** Browser URL only after grammar, substitution, URI and execution-boundary checks. */
  readonly requestUrl?: string;
  readonly valid: boolean;
  readonly executable: boolean;
  readonly diagnostics: readonly Oas32ServerResolutionDiagnostic[];
}

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const hasScheme = (value: string) => /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(value);

/** Preserve reserved percent encodings; encode only non-ASCII literal code points for RFC3986. */
function encodeUnicodeLiterals(value: string): string {
  return Array.from(value, (character) =>
    character.codePointAt(0)! > 0x7f ? encodeURIComponent(character) : character,
  ).join('');
}

/**
 * Pure declaration resolution. No host/gateway overrides, same-host HTTPS rewrite,
 * URI aliases, $self, resource loads or UI origin fallback are accepted here.
 * A browser-supported URL does not itself authorize sending a request or bypass CORS.
 */
export function resolveOas32Server(
  source: Oas32SelectedServer,
  values: Readonly<Record<string, unknown>> = {},
): Oas32ResolvedServer {
  const diagnostics: Oas32ServerResolutionDiagnostic[] = [];
  const result: {
    -readonly [Key in keyof Oas32ResolvedServer]: Oas32ResolvedServer[Key];
  } = { source, variables: [], valid: false, executable: false, diagnostics };
  const add = (
    code: Oas32ServerDiagnostic['code'],
    category: Oas32ServerDiagnostic['category'],
    reason: string,
    field = 'url',
  ) =>
    diagnostics.push({
      ownerRetrievalUri: source.ownerRetrievalUri,
      pointer: field ? `${source.pointer}/${field}` : source.pointer,
      code,
      category,
      reason,
    });
  if (!record(source.value)) {
    add('invalid-server-object', 'invalid', 'Server 必须是对象', '');
    return result;
  }
  const server = source.value;
  if (typeof server.url !== 'string') {
    add('invalid-server-url', 'invalid', 'Server url 必须是字符串');
    return result;
  }
  result.rawUrl = server.url;
  for (const field of ['name', 'description'] as const) {
    if (server[field] !== undefined && typeof server[field] !== 'string')
      add('invalid-server-metadata', 'invalid', 'Server 的 name 和 description 必须是字符串', field);
    else if (typeof server[field] === 'string') result[field] = server[field];
  }
  const urlLocation = { ownerRetrievalUri: source.ownerRetrievalUri, pointer: `${source.pointer}/url` };
  result.template = parseOas32UrlTemplate(server.url, 'server', urlLocation);
  const substituted = substituteOas32ServerVariables({
    template: result.template,
    variables: server.variables,
    values,
    variablesLocation: { ownerRetrievalUri: source.ownerRetrievalUri, pointer: `${source.pointer}/variables` },
  });
  result.variables = substituted.variables;
  result.substitutedUrl = substituted.value;
  substituted.diagnostics.forEach((diagnostic) => diagnostics.push(diagnostic));
  if (!substituted.valid || diagnostics.length || substituted.value === undefined) return result;

  // The shared RFC library validates the reference BEFORE WHATWG URL sees it;
  // e.g. backslashes, spaces, invalid ports or brackets cannot be silently repaired.
  const reference = encodeUnicodeLiterals(substituted.value);
  if (!isUriReference(reference)) {
    add('invalid-server-uri-reference', 'invalid', '变量替换后的 Server URL 不是合法的 URI reference');
    return result;
  }
  result.valid = true;
  try {
    if (hasScheme(reference)) {
      result.resolvedUrl = normalizeUri(reference);
    } else {
      const retrieval = source.ownerRetrievalUri;
      if (!retrieval || !hasScheme(retrieval) || /\s/.test(retrieval) || !isUriReference(retrieval)) {
        add('server-retrieval-unavailable', 'unavailable', '相对 Server URL 需要实际所属文档的绝对 retrieval URI');
        return result;
      }
      // Retrieval fragments do not participate in the base URL; query retention,
      // dot segments and component merging follow the existing RFC resolver.
      result.resolvedUrl = resolveUri(reference, retrieval.split('#', 1)[0]);
    }
  } catch {
    add('server-retrieval-unavailable', 'unavailable', '无法依据实际所属文档的 retrieval URI 解析 Server URL');
    return result;
  }
  const parsed = parseUri(result.resolvedUrl);
  if (parsed.query !== undefined || parsed.fragment !== undefined) {
    result.valid = false;
    add('server-query-or-fragment', 'invalid', '解析后的 Server URL 不能包含 query 或 fragment');
    return result;
  }
  if (parsed.scheme !== 'http' && parsed.scheme !== 'https') {
    add('server-scheme-not-supported', 'unsupported', '此 Server URI 的 scheme 不在浏览器 HTTP(S) 调试范围内');
    return result;
  }
  if (!parsed.authority || !parsed.host) {
    result.valid = false;
    add('server-http-host-required', 'invalid', 'HTTP(S) Server URL 必须包含 // 和非空 host');
    return result;
  }
  if (parsed.userinfo !== undefined) {
    add('server-credentials-not-supported', 'unsupported', '浏览器请求不支持 URL userinfo；保留该声明用于展示');
    return result;
  }
  try {
    result.requestUrl = new URL(result.resolvedUrl).href;
    result.executable = true;
  } catch {
    add('server-url-not-browser-executable', 'unsupported', '此合法 URI 不能构造浏览器可发送的 URL');
  }
  return result;
}
