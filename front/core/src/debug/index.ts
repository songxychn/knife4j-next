/**
 * knife4j-core debug 模块统一导出
 *
 * 此模块提供 OpenAPI 调试所需的纯函数和类型：
 * - resolveRef: $ref 引用解析
 * - buildOperationDebugModel: 从 operation 解析调试模型
 * - requestBuilder: 构造请求 + curl + 校验
 * - buildSchemaExample: schema 示例生成（占位，TASK-030 完整实现）
 */

// 类型
export type {
  ParamIn,
  ParameterInstance,
  Oas31ParameterSerialization,
  ParameterDocumentDiagnostic,
  DebugParam,
  BodyContentType,
  BodyContent,
  FormBodyDiagnostic,
  Oas31FormPartHeader,
  Oas31FormFieldEncoding,
  Oas31FormField,
  Oas31FormBodyModel,
  OperationDebugModel,
  DebugFormValues,
  SerializedExampleParameter,
  QueryParamValue,
  GlobalParamValues,
  SchemeValue,
  AuthValues,
  BuiltRequest,
  BuiltRequestSourceMap,
  ParamSource,
  ValidationError,
  BuiltParameterInstance,
  ParameterInputDiagnostic,
  FormFileMetadata,
  FormBodyInputLimits,
  SerializeOas31FormBodyInput,
  UrlencodedFormEntry,
  MultipartTextPart,
  MultipartFilePart,
  MultipartPart,
  FormBodyEncodingPlan,
  SchemaResolveContext,
  SchemaValue,
  SchemaFieldNode,
  BuildSchemaExampleFn,
  BuildSchemaFieldTreeFn,
} from './types';

export type {
  Oas32ParamIn,
  Oas32ParameterDiagnostic,
  Oas32ParameterContext,
  Oas32Parameter,
  Oas32ParameterCollection,
  Oas32ParameterProvenance,
  Oas32ParameterInput,
  Oas32CookiePair,
  Oas32ParameterResult,
  Oas32ParameterPlan,
} from './oas32ParameterTypes';
export { buildOas32ParameterCollection } from './oas32ParameterModel';
export {
  encodeOas32ParameterValue,
  serializeOas32Parameter,
  serializeOas32Parameters,
} from './oas32ParameterSerialization';
export {
  Oas32ParameterRequestError,
  replaceOas32PathParameters,
  oas32ParameterInputs,
  validateOas32Required,
  oas32BrowserRequestDiagnostics,
  assertOas32BrowserRequest,
} from './oas32ParameterRequest';

// OAS 3.1 form request bodies
export { analyzeOas31FormBody, serializeOas31FormBody } from './formBodyEncoding';
export type { AnalyzeOas31FormBodyOptions } from './formBodyEncoding';

// resolveRef
export {
  resolveRef,
  resolveRefMeta,
  dereference,
  dereferenceReferenceObject,
  normalizeAllOfSchema,
} from './resolveRef';

// operationDebugModel
export { buildOperationDebugModel, analyzeOas31Parameter } from './operationDebugModel';
export type { BuildDebugModelOptions } from './operationDebugModel';

// requestBuilder
export {
  replacePathParams,
  buildQueryString,
  mergeHeaders,
  authToHeaders,
  splitGlobalParams,
  validateRequired,
  buildRequest,
  buildCurl,
  buildUrlencodedBody,
} from './requestBuilder';
export type { BuildRequestOptions } from './requestBuilder';

// OAS 3.1 parameter conversion + serialization
export {
  encodeParameterComponent,
  encodeReservedQueryValue,
  isJsonMediaType,
  isTextMediaType,
  isSupportedParameterContentType,
  parameterKey,
  parseJsonParameterValue,
  parseOas31ParameterValue,
  replaceSerializedPathParams,
  serializeOas31Parameters,
} from './parameterSerialization';

export {
  interpretExampleObject,
  serializeExampleData,
  exampleParameterInput,
  exampleHasOwn,
  isExampleData,
} from './exampleRepresentation';
export type {
  ExampleLayer,
  ExampleCheck,
  ExampleDiagnostic,
  ExampleRepresentation,
  ExampleRepresentationContext,
} from './exampleRepresentation';
export type {
  SerializedCookieParameter,
  SerializedOas31Parameters,
  SerializedQueryParameter,
} from './parameterSerialization';

// schemaExample
export { buildSchemaExample, buildSchemaFieldTree } from './schemaExample';

// mediaTypeExample
export { buildMediaTypeExampleValue } from './mediaTypeExample';

// operationExamples
export {
  buildSchemaExampleValue,
  selectFirstMediaType,
  selectRequestBodyExample,
  selectResponseExamples,
} from './operationExamples';
export type {
  OperationMediaTypeObject,
  RequestBodyExampleSource,
  ResponseExampleSource,
  SelectedMediaType,
  SelectedOperationExample,
  SelectedResponseExample,
} from './operationExamples';
