import type { AppSettings, SupportedLang } from '../types/settings';
import { SUPPORTED_LANGS } from '../types/settings';
import type { MarkdownFileGroup, SwaggerDoc } from '../types/swagger';

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeLanguage(value: unknown): SupportedLang | undefined {
  if (typeof value !== 'string') return undefined;
  if ((SUPPORTED_LANGS as readonly string[]).includes(value)) return value as SupportedLang;

  const normalized = value.trim().toLowerCase().replace(/_/g, '-');
  if (normalized === 'zh-cn' || normalized === 'zh') return 'zh-CN';
  if (normalized === 'en-us' || normalized === 'en') return 'en-US';
  if (normalized === 'ja-jp' || normalized === 'ja') return 'ja-JP';
  return undefined;
}

function readBoolean(source: UnknownRecord, key: string): boolean | undefined {
  return typeof source[key] === 'boolean' ? source[key] : undefined;
}

function readString(source: UnknownRecord, key: string): string | undefined {
  return typeof source[key] === 'string' ? source[key] : undefined;
}

function readOpenApiExtension(doc: SwaggerDoc | null | undefined): UnknownRecord | undefined {
  if (!doc) return undefined;
  const direct = (doc as unknown as UnknownRecord)['x-openapi'];
  if (isRecord(direct)) return direct;

  // Defensive fallback for older experiments or gateway transforms.
  const knife4j = (doc as unknown as UnknownRecord)['x-knife4j'];
  if (isRecord(knife4j)) return knife4j;

  return undefined;
}

export function readKnife4jSetting(doc: SwaggerDoc | null | undefined): UnknownRecord | undefined {
  if (!doc) return undefined;
  const root = doc as unknown as UnknownRecord;
  const openApiExtension = readOpenApiExtension(doc);

  const nestedSetting = openApiExtension?.['x-setting'] ?? openApiExtension?.setting;
  if (isRecord(nestedSetting)) return nestedSetting;

  const directSetting = root['x-setting'] ?? root['x-knife4j.setting'];
  return isRecord(directSetting) ? directSetting : undefined;
}

export function extractKnife4jSettings(doc: SwaggerDoc | null | undefined): Partial<AppSettings> {
  const setting = readKnife4jSetting(doc);
  if (!setting) return {};

  const next: Partial<AppSettings> = {};
  const language = normalizeLanguage(setting.language);
  if (language) next.language = language;

  const enableSearch = readBoolean(setting, 'enableSearch');
  if (enableSearch !== undefined) next.enableSearch = enableSearch;

  const enableDebug = readBoolean(setting, 'enableDebug');
  if (enableDebug !== undefined) next.enableDebug = enableDebug;

  const enableOpenApi = readBoolean(setting, 'enableOpenApi');
  if (enableOpenApi !== undefined) next.enableOpenApi = enableOpenApi;

  const enableSwaggerModels = readBoolean(setting, 'enableSwaggerModels');
  if (enableSwaggerModels !== undefined) next.enableSwaggerModels = enableSwaggerModels;

  const swaggerModelName = readString(setting, 'swaggerModelName');
  if (swaggerModelName !== undefined && swaggerModelName.trim()) next.swaggerModelName = swaggerModelName;

  const enableGroup = readBoolean(setting, 'enableGroup');
  if (enableGroup !== undefined) next.enableGroup = enableGroup;

  const enableFooter = readBoolean(setting, 'enableFooter');
  if (enableFooter !== undefined) next.enableFooter = enableFooter;

  const enableHost = readBoolean(setting, 'enableHost');
  if (enableHost !== undefined) next.enableHost = enableHost;

  const enableHostText = readString(setting, 'enableHostText');
  if (enableHostText !== undefined) next.enableHostText = enableHostText;

  return next;
}

export function extractMarkdownFiles(doc: SwaggerDoc | null | undefined): MarkdownFileGroup[] {
  if (!doc) return [];
  const direct = (doc as unknown as UnknownRecord)['x-markdownFiles'];
  if (Array.isArray(direct)) return direct as MarkdownFileGroup[];

  const openApiExtension = readOpenApiExtension(doc);
  const nested = openApiExtension?.['x-markdownFiles'] ?? openApiExtension?.markdownFiles;
  return Array.isArray(nested) ? (nested as MarkdownFileGroup[]) : [];
}
