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
  DebugParam,
  BodyContentType,
  BodyContent,
  OperationDebugModel,
  DebugFormValues,
  GlobalParamValues,
  SchemeValue,
  AuthValues,
  BuiltRequest,
  BuiltRequestSourceMap,
  ParamSource,
  ValidationError,
  SchemaResolveContext,
  SchemaFieldNode,
  BuildSchemaExampleFn,
  BuildSchemaFieldTreeFn,
} from './types';

// resolveRef
export { resolveRef, resolveRefMeta, dereference } from './resolveRef';

// operationDebugModel
export { buildOperationDebugModel } from './operationDebugModel';
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

// schemaExample
export { buildSchemaExample, buildSchemaFieldTree } from './schemaExample';
