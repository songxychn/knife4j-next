import { ParameterObject, ReferenceObject, SchemaObject } from './types';
import KUtils from '../knife4j/utils/KUtils';

const OpenAPI3TypeUtils = {
  /**
   * 判断是否ParameterObject类型
   * @param obj 对象
   * @returns
   */
  isParameterObject(obj: any): obj is ParameterObject {
    return !KUtils.isEmpty(obj);
  },
  /**
   * 判断是否ReferenceObject类型
   * @param obj 对象
   * @returns
   */
  isReferenceObject(obj: any): obj is ReferenceObject {
    return !KUtils.isEmpty(obj);
  },
  isSchemaObject(obj: any): obj is SchemaObject {
    return !KUtils.isEmpty(obj);
  },
};

export default OpenAPI3TypeUtils;
