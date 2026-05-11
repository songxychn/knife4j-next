export const SUPPORTED_LANGS = ['zh-CN', 'en-US', 'ja-JP'] as const;

export type SupportedLang = (typeof SUPPORTED_LANGS)[number];

export type TagsSorterOverride = 'auto' | 'alpha' | 'preserve';

export type OperationsSorterOverride = 'auto' | 'alpha' | 'method' | 'preserve';

export interface AppSettings {
  /** Backend-provided or user-selected UI language. Undefined keeps i18next detection. */
  language?: SupportedLang;
  /** Whether the sidebar search box is shown. */
  enableSearch: boolean;
  /** Whether the debug tab is shown. This is a UI toggle, not a security boundary. */
  enableDebug: boolean;
  /** Whether the OpenAPI raw-structure tab is shown. */
  enableOpenApi: boolean;
  /** Whether the schema/model entry is shown in the sidebar. */
  enableSwaggerModels: boolean;
  /** Sidebar label for the schema/model entry. */
  swaggerModelName: string;
  /** Whether the group dropdown is shown. */
  enableGroup: boolean;
  /** Whether the default footer is shown. */
  enableFooter: boolean;
  /** Whether Host override is enabled. */
  enableHost: boolean;
  /** Host override text (used when enableHost=true). */
  enableHostText: string;
  /** Whether request parameter cache is enabled. Reserved until the cache behavior is wired. */
  enableRequestCache: boolean;
  /** Whether dynamic parameters are enabled. Reserved until dynamic parameter behavior is wired. */
  enableDynamicParameter: boolean;
  /** Whether multipart/RequestMapping APIs are filtered. Reserved until filtering behavior is wired. */
  enableFilterMultipartApis: boolean;
  /** Filtered method type for multipart/RequestMapping APIs. */
  enableFilterMultipartApiMethodType: string;
  /** tag sorting override (default 'auto': follow springdoc.swagger-ui.tags-sorter). */
  tagsSorter: TagsSorterOverride;
  /** operation sorting override (default 'auto': follow springdoc.swagger-ui.operations-sorter). */
  operationsSorter: OperationsSorterOverride;
  /**
   * Reserved hook for SwaggerBootstrapUi enhancement mode.
   * Current React UI does not wire it.
   */
  enableSwaggerBootstrapUi: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  enableSearch: true,
  enableDebug: true,
  enableOpenApi: true,
  enableSwaggerModels: true,
  swaggerModelName: 'Swagger Models',
  enableGroup: true,
  enableFooter: true,
  enableHost: false,
  enableHostText: '',
  enableRequestCache: true,
  enableDynamicParameter: false,
  enableFilterMultipartApis: false,
  enableFilterMultipartApiMethodType: 'POST',
  tagsSorter: 'auto',
  operationsSorter: 'auto',
  enableSwaggerBootstrapUi: false,
};
