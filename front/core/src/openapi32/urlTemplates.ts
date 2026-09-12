import { escapeJsonPointerSegment } from '../openapi31/document';
import type { OpenApiObjectLocation, OpenApiOperationSource } from '../openapiOperations';

export type Oas32UrlLocation = Pick<OpenApiObjectLocation, 'ownerRetrievalUri' | 'pointer'>;
export type Oas32UrlTemplateKind = 'server' | 'path';

export interface Oas32UrlDiagnostic extends Oas32UrlLocation {
  readonly code:
    | 'empty-url-template'
    | 'invalid-template-literal'
    | 'invalid-template-percent-encoding'
    | 'template-query-or-fragment'
    | 'unclosed-template-variable'
    | 'nested-template-variable'
    | 'empty-template-variable'
    | 'duplicate-template-variable'
    | 'path-leading-slash-required'
    | 'empty-path-segment'
    | 'identical-templated-path'
    | 'invalid-server-variables'
    | 'invalid-server-variable-default'
    | 'invalid-server-variable-enum'
    | 'server-default-outside-enum'
    | 'invalid-server-variable-input'
    | 'unknown-server-variable-input'
    | 'server-value-outside-enum'
    | 'undefined-server-variable'
    | 'missing-path-parameter'
    | 'unmatched-path-parameter'
    | 'path-parameter-not-required'
    | 'path-parameters-unresolved';
  readonly category: 'invalid' | 'unavailable';
  readonly reason: string;
  /** Original field text, or the explicit substitution result when stage is substitution. */
  readonly value?: string;
  readonly stage?: 'template' | 'substitution' | 'binding';
  /** UTF-16 offset into value; never an offset into a decoded or normalized string. */
  readonly offset?: number;
  readonly variable?: string;
  readonly relatedPointer?: string;
}

export interface Oas32UrlTemplateToken {
  readonly type: 'literal' | 'variable';
  readonly value: string;
  readonly start: number;
  readonly end: number;
}

export interface Oas32UrlTemplate {
  readonly source: string;
  readonly kind: Oas32UrlTemplateKind;
  readonly location: Oas32UrlLocation;
  readonly tokens: readonly Oas32UrlTemplateToken[];
  readonly variables: readonly Oas32UrlTemplateToken[];
  readonly valid: boolean;
  readonly diagnostics: readonly Oas32UrlDiagnostic[];
}

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const owns = (value: object, key: string): boolean => Object.prototype.hasOwnProperty.call(value, key);
const child = (location: Oas32UrlLocation, key: string): Oas32UrlLocation => ({
  ...location,
  pointer: `${location.pointer}/${escapeJsonPointerSegment(key)}`,
});
const pchar = /^[a-zA-Z0-9!$&'()*+,;=:@._~-]$/;

/** OAS 3.2 4.6 copies RFC6570 literals including the corrected Unicode ranges. */
function serverLiteral(code: number): boolean {
  if (code < 0x80)
    return (
      code === 0x21 ||
      (code >= 0x23 && code <= 0x24) ||
      (code >= 0x26 && code <= 0x3b) ||
      code === 0x3d ||
      (code >= 0x3f && code <= 0x5b) ||
      code === 0x5d ||
      code === 0x5f ||
      (code >= 0x61 && code <= 0x7a) ||
      code === 0x7e
    );
  if (code <= 0xffff)
    return (code >= 0xa0 && code <= 0xd7ff) || (code >= 0xe000 && code <= 0xfdcf) || (code >= 0xfdf0 && code <= 0xffef);
  if (code > 0x10fffd || (code & 0xffff) > 0xfffd) return false;
  return code <= 0xdfffd || code >= 0xe1000;
}

function literalDiagnostics(
  source: string,
  kind: Oas32UrlTemplateKind,
  location: Oas32UrlLocation,
  start: number,
  end: number,
  stage: 'template' | 'substitution',
): Oas32UrlDiagnostic[] {
  const diagnostics: Oas32UrlDiagnostic[] = [];
  const add = (code: Oas32UrlDiagnostic['code'], offset: number, reason: string) =>
    diagnostics.push({ ...location, code, category: 'invalid', value: source, offset, reason, stage });
  for (let index = start; index < end; index += 1) {
    const code = source.codePointAt(index);
    if (code === undefined) break;
    const character = source[index];
    if (character === '%') {
      if (index + 2 < end && /^[a-fA-F0-9]{2}$/.test(source.slice(index + 1, index + 3))) index += 2;
      else add('invalid-template-percent-encoding', index, 'URL literal 的百分号必须跟随两个十六进制字符');
    } else if (character === '?' || character === '#') {
      add('template-query-or-fragment', index, 'Server URL 和 Path 模板不能包含 literal query 或 fragment');
    } else if (kind === 'server' ? !serverLiteral(code) : character !== '/' && !pchar.test(character)) {
      add('invalid-template-literal', index, '字符不在此 URL 模板的 literal ABNF 范围内');
    }
    if (code > 0xffff) index += 1;
  }
  return diagnostics;
}

/**
 * Parse exactly the OAS 3.2 4.6/4.8.2 grammar, not RFC6570's more restrictive
 * variable-name grammar. Names may contain %, /, ?, #, spaces and controls; only
 * braces delimit them. Literal Unicode is allowed for Servers but not Paths.
 * This function does not resolve a URL, inspect a document or authorize a request.
 */
export function parseOas32UrlTemplate(
  source: string,
  kind: Oas32UrlTemplateKind,
  location: Oas32UrlLocation,
): Oas32UrlTemplate {
  const tokens: Oas32UrlTemplateToken[] = [];
  const variables: Oas32UrlTemplateToken[] = [];
  const diagnostics: Oas32UrlDiagnostic[] = [];
  const seen = new Set<string>();
  const add = (code: Oas32UrlDiagnostic['code'], offset: number, reason: string, variable?: string) =>
    diagnostics.push({
      ...location,
      code,
      category: 'invalid',
      value: source,
      offset,
      reason,
      variable,
      stage: 'template',
    });
  if (!source.length) add('empty-url-template', 0, 'URL 模板不能为空');
  if (kind === 'path' && !source.startsWith('/')) add('path-leading-slash-required', 0, 'Path 模板必须以 / 开头');
  let literalStart = 0;
  let segmentHasContent = false;
  const flushLiteral = (end: number) => {
    if (literalStart === end) return;
    tokens.push({ type: 'literal', value: source.slice(literalStart, end), start: literalStart, end });
    literalDiagnostics(source, kind, location, literalStart, end, 'template').forEach((diagnostic) =>
      diagnostics.push(diagnostic),
    );
  };
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === '{') {
      flushLiteral(index);
      const closing = source.indexOf('}', index + 1);
      if (closing < 0) {
        add('unclosed-template-variable', index, '模板变量缺少闭合的 }');
        literalStart = source.length;
        break;
      }
      const name = source.slice(index + 1, closing);
      if (!name.length) add('empty-template-variable', index, '模板变量名不能为空');
      else if (name.includes('{')) add('nested-template-variable', index, '模板变量名不能包含 { 或 }');
      else {
        if (seen.has(name)) add('duplicate-template-variable', index, '同一 URL 模板内变量名不能重复', name);
        seen.add(name);
        const token: Oas32UrlTemplateToken = { type: 'variable', value: name, start: index, end: closing + 1 };
        variables.push(token);
        tokens.push(token);
      }
      index = closing;
      literalStart = closing + 1;
      segmentHasContent = true;
    } else if (kind === 'path' && source[index] === '/') {
      if (index > 0 && !segmentHasContent) add('empty-path-segment', index, 'Path 模板的 path-segment 不能为空');
      segmentHasContent = false;
    } else {
      segmentHasContent = true;
    }
  }
  flushLiteral(source.length);
  return { source, kind, location, tokens, variables, valid: diagnostics.length === 0, diagnostics };
}

/** Only pass real Paths entries. Similar callback expressions and webhook names are not path templates. */
export function findOas32PathTemplateConflicts(templates: readonly Oas32UrlTemplate[]): Oas32UrlDiagnostic[] {
  const firstByHierarchy = new Map<string, Oas32UrlTemplate>();
  const diagnostics: Oas32UrlDiagnostic[] = [];
  templates.forEach((template) => {
    if (!template.valid || template.kind !== 'path' || !template.variables.length) return;
    const hierarchy = template.tokens.map((token) => (token.type === 'variable' ? '{}' : token.value)).join('');
    const previous = firstByHierarchy.get(hierarchy);
    if (previous)
      diagnostics.push({
        ...template.location,
        code: 'identical-templated-path',
        category: 'invalid',
        value: template.source,
        stage: 'template',
        relatedPointer: previous.location.pointer,
        reason: '不允许存在层级相同而变量名不同的 Path 模板',
      });
    else firstByHierarchy.set(hierarchy, template);
  });
  return diagnostics;
}

export interface Oas32ServerVariableValue {
  readonly name: string;
  readonly definition: unknown;
  readonly location: Oas32UrlLocation;
  readonly used: boolean;
  readonly default?: string;
  readonly enum?: readonly string[];
  readonly value?: string;
  readonly valueSource: 'default' | 'user';
}

export interface Oas32ServerSubstitution {
  readonly valid: boolean;
  /** Present once substitution is possible, even if the resulting URL text is invalid. */
  readonly value?: string;
  readonly variables: readonly Oas32ServerVariableValue[];
  readonly diagnostics: readonly Oas32UrlDiagnostic[];
}

/** Validate all declared variables, including unused ones; substitute each used variable exactly once. */
export function substituteOas32ServerVariables({
  template,
  variables,
  variablesLocation,
  values = {},
}: {
  template: Oas32UrlTemplate;
  variables: unknown;
  variablesLocation: Oas32UrlLocation;
  values?: Readonly<Record<string, unknown>>;
}): Oas32ServerSubstitution {
  const diagnostics = [...template.diagnostics];
  const selections: Oas32ServerVariableValue[] = [];
  const definitions = record(variables) ? variables : {};
  const used = new Set(template.variables.map((token) => token.value));
  const replacements = new Map<string, string>();
  const add = (code: Oas32UrlDiagnostic['code'], location: Oas32UrlLocation, reason: string, variable?: string) =>
    diagnostics.push({ ...location, code, category: 'invalid', reason, variable, stage: 'substitution' });
  if (variables !== undefined && !record(variables))
    add('invalid-server-variables', variablesLocation, 'Server variables 必须是对象');
  Object.entries(definitions).forEach(([name, definition]) => {
    const location = child(variablesLocation, name);
    const defaultValue = record(definition) && typeof definition.default === 'string' ? definition.default : undefined;
    if (defaultValue === undefined)
      add(
        'invalid-server-variable-default',
        child(location, 'default'),
        'Server Variable 必须提供字符串 default',
        name,
      );
    const enumPresent = record(definition) && owns(definition, 'enum');
    const enumeration =
      record(definition) &&
      Array.isArray(definition.enum) &&
      definition.enum.length > 0 &&
      definition.enum.every((value): value is string => typeof value === 'string')
        ? definition.enum
        : undefined;
    if (enumPresent && !enumeration)
      add('invalid-server-variable-enum', child(location, 'enum'), 'Server Variable enum 必须是非空字符串数组', name);
    if (enumeration && defaultValue !== undefined && !enumeration.includes(defaultValue))
      add('server-default-outside-enum', child(location, 'default'), 'Server Variable default 必须属于 enum', name);
    const supplied = owns(values, name);
    const selected: unknown = supplied ? values[name] : defaultValue;
    if (supplied && typeof selected !== 'string')
      add('invalid-server-variable-input', location, 'Server Variable 的用户输入必须是字符串', name);
    if (typeof selected === 'string' && enumeration && !enumeration.includes(selected))
      add('server-value-outside-enum', location, 'Server Variable 的输入必须属于 enum', name);
    if (typeof selected === 'string') replacements.set(name, selected);
    selections.push({
      name,
      definition,
      location,
      used: used.has(name),
      default: defaultValue,
      enum: enumeration,
      value: typeof selected === 'string' ? selected : undefined,
      valueSource: supplied ? 'user' : 'default',
    });
  });
  Object.keys(values).forEach((name) => {
    if (!owns(definitions, name))
      add('unknown-server-variable-input', variablesLocation, '用户输入指向未声明的 Server Variable', name);
  });
  template.variables.forEach((token) => {
    if (!owns(definitions, token.value))
      diagnostics.push({
        ...template.location,
        code: 'undefined-server-variable',
        category: 'invalid',
        stage: 'substitution',
        value: template.source,
        offset: token.start,
        variable: token.value,
        reason: 'URL 模板引用了未声明的 Server Variable',
      });
  });
  if (diagnostics.length) return { valid: false, variables: selections, diagnostics };
  const parts: string[] = [];
  template.tokens.forEach((token) => {
    const replacement = token.type === 'literal' ? token.value : replacements.get(token.value);
    if (replacement === undefined)
      add('undefined-server-variable', template.location, 'URL 模板引用了未声明的 Server Variable', token.value);
    else parts.push(replacement);
  });
  if (diagnostics.length) return { valid: false, variables: selections, diagnostics };
  const value = parts.join('');
  // Do not parse replacements as another template. Braces introduced by a value
  // are literal invalid URL characters; query/fragment are checked after substitution.
  literalDiagnostics(value, 'server', template.location, 0, value.length, 'substitution').forEach((diagnostic) =>
    diagnostics.push(diagnostic),
  );
  return { valid: diagnostics.length === 0, value, variables: selections, diagnostics };
}

export interface Oas32EffectivePathParameter {
  readonly name: string;
  readonly in: string;
  readonly required?: unknown;
  readonly location: Oas32UrlLocation;
}

/**
 * The caller supplies the effective, already resolved parameter set for one
 * mounted operation (Path Item overrides already applied by E). An unresolved
 * dependency must set parametersComplete=false; it cannot prove a missing binding.
 */
export function validateOas32PathBindings({
  source,
  path,
  location,
  parameters,
  parametersComplete,
  emptyPathItem = false,
}: {
  source: OpenApiOperationSource;
  path: string;
  location: Oas32UrlLocation;
  parameters: readonly Oas32EffectivePathParameter[];
  parametersComplete: boolean;
  emptyPathItem?: boolean;
}): {
  status: 'valid' | 'invalid' | 'unavailable' | 'not-applicable';
  template?: Oas32UrlTemplate;
  diagnostics: readonly Oas32UrlDiagnostic[];
} {
  if (source !== 'path') return { status: 'not-applicable', diagnostics: [] };
  const template = parseOas32UrlTemplate(path, 'path', location);
  const diagnostics = [...template.diagnostics];
  if (!template.valid) return { status: 'invalid', template, diagnostics };
  const names = new Set(template.variables.map((token) => token.value));
  const bound = new Set<string>();
  parameters.forEach((parameter) => {
    if (parameter.in !== 'path') return;
    bound.add(parameter.name);
    if (!names.has(parameter.name))
      diagnostics.push({
        ...child(parameter.location, 'name'),
        code: 'unmatched-path-parameter',
        category: 'invalid',
        stage: 'binding',
        variable: parameter.name,
        reason: 'path 参数 name 必须对应此挂载路径的模板变量',
      });
    if (parameter.required !== true)
      diagnostics.push({
        ...child(parameter.location, 'required'),
        code: 'path-parameter-not-required',
        category: 'invalid',
        stage: 'binding',
        variable: parameter.name,
        reason: 'path 参数的 required 必须为 true',
      });
  });
  if (!parametersComplete && !emptyPathItem)
    diagnostics.push({
      ...location,
      code: 'path-parameters-unresolved',
      category: 'unavailable',
      stage: 'binding',
      value: path,
      reason: '有效参数集合尚未完整解析，不能判断缺失的 path 参数',
    });
  if (parametersComplete && !emptyPathItem)
    template.variables.forEach((token) => {
      if (!bound.has(token.value))
        diagnostics.push({
          ...location,
          code: 'missing-path-parameter',
          category: 'invalid',
          stage: 'binding',
          value: path,
          offset: token.start,
          variable: token.value,
          reason: '模板变量必须绑定到 Path Item 或此 Operation 的 path 参数',
        });
    });
  const status = diagnostics.some((diagnostic) => diagnostic.category === 'invalid')
    ? 'invalid'
    : diagnostics.length
      ? 'unavailable'
      : 'valid';
  return { status, template, diagnostics };
}
