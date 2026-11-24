import { JSONPath } from 'jsonpath-plus';
import { isRecord } from 'knife4j-core';
import type { GlobalParamLocation, GlobalParamScope } from '../../context/globalParamState';
import type { DebugResponsePayload } from './ResponsePanel';
import { createClientId } from '../../utils/id';

export const RESPONSE_EXTRACTION_MAX_RULES = 20;
export const RESPONSE_EXTRACTION_MAX_EXPRESSION_LENGTH = 512;
export const RESPONSE_EXTRACTION_MAX_PREFIX_LENGTH = 128;
export const RESPONSE_EXTRACTION_MAX_TARGET_NAME_LENGTH = 256;
export const RESPONSE_EXTRACTION_MAX_VALUE_LENGTH = 16 * 1024;
export const RESPONSE_EXTRACTION_MAX_BODY_BYTES = 2 * 1024 * 1024;
export const MASKED_VALUE_PREVIEW = '••••••';

export type ResponseExtractionSource = 'json-body' | 'header';

export interface ResponseExtractionRule {
  id: string;
  enabled: boolean;
  source: ResponseExtractionSource;
  expression: string;
  prefix: string;
  targetScope: GlobalParamScope;
  targetIn: GlobalParamLocation;
  targetName: string;
  masked: boolean;
}

export type SafeJsonPathErrorCode =
  'empty-path' | 'path-too-long' | 'no-match' | 'multiple-matches' | 'non-scalar' | 'eval-error';

export class SafeJsonPathError extends Error {
  readonly code: SafeJsonPathErrorCode;

  constructor(code: SafeJsonPathErrorCode, message: string) {
    super(message);
    this.name = 'SafeJsonPathError';
    this.code = code;
  }
}

export function extractSingleJsonPathScalar(json: unknown, path: string, options?: { maxPathLength?: number }): string {
  const trimmed = path.trim();
  if (!trimmed) {
    throw new SafeJsonPathError('empty-path', 'JSONPath 不能为空');
  }
  const maxPathLength = options?.maxPathLength ?? RESPONSE_EXTRACTION_MAX_EXPRESSION_LENGTH;
  if (trimmed.length > maxPathLength) {
    throw new SafeJsonPathError('path-too-long', `JSONPath 长度超过限制（最大 ${maxPathLength} 字符）`);
  }

  let matches: unknown[];
  try {
    // Keep eval explicitly disabled so JSONPath never executes arbitrary script expressions.
    matches = JSONPath({
      path: trimmed,
      json: json as null | boolean | number | string | object,
      wrap: true,
      eval: false,
    }) as unknown[];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new SafeJsonPathError('eval-error', message);
  }

  if (matches.length !== 1) {
    throw new SafeJsonPathError(
      matches.length === 0 ? 'no-match' : 'multiple-matches',
      matches.length === 0 ? 'JSONPath 没有匹配到值' : 'JSONPath 匹配到多个值',
    );
  }

  const value = matches[0];
  if (value === null || !['string', 'number', 'boolean'].includes(typeof value)) {
    throw new SafeJsonPathError('non-scalar', 'JSONPath 结果必须是字符串、数字或布尔值');
  }
  return String(value);
}

export function createEmptyExtractionRule(): ResponseExtractionRule {
  return {
    id: createClientId(),
    enabled: true,
    source: 'json-body',
    expression: '',
    prefix: '',
    targetScope: 'group',
    targetIn: 'header',
    targetName: '',
    masked: true,
  };
}

export function normalizeResponseExtractionRule(value: unknown): ResponseExtractionRule | null {
  if (!isRecord(value)) return null;
  const source: ResponseExtractionSource = value.source === 'header' ? 'header' : 'json-body';
  const targetScope: GlobalParamScope = value.targetScope === 'application' ? 'application' : 'group';
  const targetIn: GlobalParamLocation = value.targetIn === 'query' ? 'query' : 'header';
  const expression =
    typeof value.expression === 'string' ? value.expression.slice(0, RESPONSE_EXTRACTION_MAX_EXPRESSION_LENGTH) : '';
  const prefix = typeof value.prefix === 'string' ? value.prefix.slice(0, RESPONSE_EXTRACTION_MAX_PREFIX_LENGTH) : '';
  const targetName =
    typeof value.targetName === 'string' ? value.targetName.slice(0, RESPONSE_EXTRACTION_MAX_TARGET_NAME_LENGTH) : '';

  if (!expression.trim() && !targetName.trim()) {
    return null;
  }

  return {
    id: typeof value.id === 'string' && value.id.trim() ? value.id : createClientId(),
    enabled: value.enabled !== false,
    source,
    expression,
    prefix,
    targetScope,
    targetIn,
    targetName,
    masked: value.masked !== false,
  };
}

export function normalizeResponseExtractionRules(value: unknown): ResponseExtractionRule[] {
  if (!Array.isArray(value)) return [];
  const rules: ResponseExtractionRule[] = [];
  const seenIds = new Set<string>();
  for (const item of value) {
    if (rules.length >= RESPONSE_EXTRACTION_MAX_RULES) break;
    const normalized = normalizeResponseExtractionRule(item);
    if (!normalized) continue;
    if (seenIds.has(normalized.id)) {
      normalized.id = createClientId();
    }
    seenIds.add(normalized.id);
    rules.push(normalized);
  }
  return rules;
}

export interface ResponseExtractionInput {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly rawText: string;
  readonly kind: DebugResponsePayload['kind'];
  readonly isCrossOrigin?: boolean;
  readonly isStreaming?: boolean;
}

export interface ResponseExtractionMutation {
  readonly ruleId: string;
  readonly scope: GlobalParamScope;
  readonly in: GlobalParamLocation;
  readonly name: string;
  readonly value: string;
  readonly masked: boolean;
}

export type ResponseExtractionSkipReason = 'no-enabled-rules' | 'non-2xx' | 'unsupported-response-kind';

export type ResponseExtractionItemReasonCode =
  | 'invalid-target-name'
  | 'empty-expression'
  | 'expression-too-long'
  | 'body-too-large'
  | 'invalid-json'
  | 'no-match'
  | 'multiple-matches'
  | 'non-scalar'
  | 'eval-error'
  | 'header-not-found'
  | 'header-not-found-cors'
  | 'empty-value'
  | 'value-too-long';

export interface ResponseExtractionItemLog {
  readonly ruleId: string;
  readonly source: ResponseExtractionSource;
  readonly expression: string;
  readonly targetScope: GlobalParamScope;
  readonly targetIn: GlobalParamLocation;
  readonly targetName: string;
  readonly masked: boolean;
  readonly status: 'updated' | 'preview' | 'failed';
  /** Redacted when masked is true so logs never store plaintext tokens. */
  readonly valuePreview?: string;
  /** Length of the extracted value (safe metadata for masked preview feedback). */
  readonly valueLength?: number;
  readonly reasonCode?: ResponseExtractionItemReasonCode;
  readonly reasonDetail?: string;
  readonly shadowedByGroup?: boolean;
}

export interface ResponseExtractionRunLog {
  readonly mode: 'auto' | 'dry-run';
  readonly executedAt: number;
  readonly status: 'executed' | 'skipped';
  readonly skipReason?: ResponseExtractionSkipReason;
  readonly httpStatus: number;
  readonly items: readonly ResponseExtractionItemLog[];
}

export interface ResponseExtractionEvaluation {
  readonly log: ResponseExtractionRunLog;
  readonly mutations: readonly ResponseExtractionMutation[];
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

function formatPreviewValue(value: string, masked: boolean): string {
  if (masked) return MASKED_VALUE_PREVIEW;
  return value.length > 120 ? `${value.slice(0, 120)}…` : value;
}

function buildNormalizedHeaderMap(headers: Readonly<Record<string, string>>): Map<string, string> {
  const map = new Map<string, string>();
  for (const [key, value] of Object.entries(headers)) {
    map.set(key.trim().toLowerCase(), value);
  }
  return map;
}

export function isCrossOriginUrl(targetUrl: string | undefined, currentOriginValue: string | undefined): boolean {
  if (!targetUrl || !currentOriginValue) return false;
  try {
    const resolved = new URL(targetUrl, currentOriginValue);
    return resolved.origin !== new URL(currentOriginValue).origin;
  } catch {
    return false;
  }
}

export interface ResponseExtractionSummary {
  readonly type: 'success' | 'warning' | 'info';
  readonly key:
    | 'apiDebug.extract.skip.non2xx'
    | 'apiDebug.extract.skip.unsupportedKind'
    | 'apiDebug.extract.summary.dryRun'
    | 'apiDebug.extract.summary.partial'
    | 'apiDebug.extract.summary.updated';
  readonly params?: Record<string, number>;
}

export function summarizeResponseExtractionLog(log: ResponseExtractionRunLog): ResponseExtractionSummary | null {
  if (log.status === 'skipped') {
    if (log.skipReason === 'non-2xx') {
      return { type: 'info', key: 'apiDebug.extract.skip.non2xx', params: { status: log.httpStatus } };
    }
    if (log.skipReason === 'unsupported-response-kind') {
      return { type: 'info', key: 'apiDebug.extract.skip.unsupportedKind' };
    }
    return null;
  }

  const succeeded = log.items.filter((item) => item.status === 'updated' || item.status === 'preview').length;
  const failed = log.items.filter((item) => item.status === 'failed').length;
  const shadowed = log.items.some((item) => item.shadowedByGroup);

  if (log.mode === 'dry-run') {
    return {
      type: failed > 0 ? 'warning' : 'info',
      key: 'apiDebug.extract.summary.dryRun',
      params: { succeeded, failed },
    };
  }
  if (failed > 0 || shadowed) {
    return {
      type: 'warning',
      key: 'apiDebug.extract.summary.partial',
      params: { updated: succeeded, failed },
    };
  }
  if (succeeded > 0) {
    return {
      type: 'success',
      key: 'apiDebug.extract.summary.updated',
      params: { updated: succeeded },
    };
  }
  return null;
}

export function evaluateResponseExtraction(
  rules: readonly ResponseExtractionRule[],
  input: ResponseExtractionInput,
  options?: {
    mode?: 'auto' | 'dry-run';
    executedAt?: number;
  },
): ResponseExtractionEvaluation {
  const mode = options?.mode ?? 'auto';
  const executedAt = options?.executedAt ?? Date.now();
  const enabledRules = rules.filter((rule) => rule.enabled).slice(0, RESPONSE_EXTRACTION_MAX_RULES);

  if (enabledRules.length === 0) {
    return {
      log: {
        mode,
        executedAt,
        status: 'skipped',
        skipReason: 'no-enabled-rules',
        httpStatus: input.status,
        items: [],
      },
      mutations: [],
    };
  }

  if (input.isStreaming || (input.kind !== 'json' && input.kind !== 'text')) {
    return {
      log: {
        mode,
        executedAt,
        status: 'skipped',
        skipReason: 'unsupported-response-kind',
        httpStatus: input.status,
        items: [],
      },
      mutations: [],
    };
  }

  if (input.status < 200 || input.status >= 300) {
    return {
      log: {
        mode,
        executedAt,
        status: 'skipped',
        skipReason: 'non-2xx',
        httpStatus: input.status,
        items: [],
      },
      mutations: [],
    };
  }

  const headerMap = buildNormalizedHeaderMap(input.headers);
  const needsJsonBody = enabledRules.some((rule) => rule.source === 'json-body');
  let parsedJsonReady = false;
  let parsedJson: unknown;
  let jsonBodyError: { code: 'body-too-large' | 'invalid-json'; detail?: string } | null = null;

  if (needsJsonBody) {
    if (byteLength(input.rawText) > RESPONSE_EXTRACTION_MAX_BODY_BYTES) {
      jsonBodyError = { code: 'body-too-large' };
    } else {
      try {
        parsedJson = JSON.parse(input.rawText);
        parsedJsonReady = true;
      } catch (error) {
        jsonBodyError = {
          code: 'invalid-json',
          detail: error instanceof Error ? error.message : String(error),
        };
      }
    }
  }

  const items: ResponseExtractionItemLog[] = [];
  const mutations: ResponseExtractionMutation[] = [];

  for (const rule of enabledRules) {
    const targetName = rule.targetName.trim();
    const expression = rule.expression.trim();
    const baseItem = {
      ruleId: rule.id,
      source: rule.source,
      expression,
      targetScope: rule.targetScope,
      targetIn: rule.targetIn,
      targetName,
      masked: rule.masked,
    } as const;

    if (!targetName || targetName.length > RESPONSE_EXTRACTION_MAX_TARGET_NAME_LENGTH) {
      items.push({ ...baseItem, status: 'failed', reasonCode: 'invalid-target-name' });
      continue;
    }

    if (!expression) {
      items.push({ ...baseItem, status: 'failed', reasonCode: 'empty-expression' });
      continue;
    }

    if (expression.length > RESPONSE_EXTRACTION_MAX_EXPRESSION_LENGTH) {
      items.push({ ...baseItem, status: 'failed', reasonCode: 'expression-too-long' });
      continue;
    }

    let rawExtracted: string;
    if (rule.source === 'header') {
      const headerValue = headerMap.get(expression.toLowerCase());
      if (headerValue === undefined) {
        items.push({
          ...baseItem,
          status: 'failed',
          reasonCode: input.isCrossOrigin ? 'header-not-found-cors' : 'header-not-found',
        });
        continue;
      }
      rawExtracted = headerValue;
    } else {
      if (jsonBodyError) {
        items.push({
          ...baseItem,
          status: 'failed',
          reasonCode: jsonBodyError.code,
          reasonDetail: jsonBodyError.detail,
        });
        continue;
      }
      if (!parsedJsonReady) {
        items.push({ ...baseItem, status: 'failed', reasonCode: 'invalid-json' });
        continue;
      }
      try {
        rawExtracted = extractSingleJsonPathScalar(parsedJson, expression);
      } catch (error) {
        if (error instanceof SafeJsonPathError) {
          const reasonCode: ResponseExtractionItemReasonCode =
            error.code === 'empty-path'
              ? 'empty-expression'
              : error.code === 'path-too-long'
                ? 'expression-too-long'
                : error.code;
          items.push({
            ...baseItem,
            status: 'failed',
            reasonCode,
            reasonDetail: error.code === 'eval-error' ? error.message : undefined,
          });
        } else {
          items.push({
            ...baseItem,
            status: 'failed',
            reasonCode: 'eval-error',
            reasonDetail: error instanceof Error ? error.message : String(error),
          });
        }
        continue;
      }
    }

    if (rawExtracted === '') {
      items.push({ ...baseItem, status: 'failed', reasonCode: 'empty-value' });
      continue;
    }

    const prefix = rule.prefix.slice(0, RESPONSE_EXTRACTION_MAX_PREFIX_LENGTH);
    const finalValue = `${prefix}${rawExtracted}`;
    if (finalValue.length > RESPONSE_EXTRACTION_MAX_VALUE_LENGTH) {
      items.push({ ...baseItem, status: 'failed', reasonCode: 'value-too-long' });
      continue;
    }

    mutations.push({
      ruleId: rule.id,
      scope: rule.targetScope,
      in: rule.targetIn,
      name: targetName,
      value: finalValue,
      masked: rule.masked,
    });
    items.push({
      ...baseItem,
      status: mode === 'dry-run' ? 'preview' : 'updated',
      valuePreview: formatPreviewValue(finalValue, rule.masked),
      valueLength: finalValue.length,
    });
  }

  return {
    log: {
      mode,
      executedAt,
      status: 'executed',
      httpStatus: input.status,
      items,
    },
    mutations,
  };
}
