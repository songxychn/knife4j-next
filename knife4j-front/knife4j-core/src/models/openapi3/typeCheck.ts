import { ParameterObject, ReferenceObject } from "./types"
import lodash from 'lodash'
//SchemaObject
import { SchemaObject } from "./types";

const OpenAPI3TypeUtils = {

    /**
     * 判断是否ParameterObject类型
     * @param obj 对象
     * @returns 
     */
    isParameterObject(obj: any): obj is ParameterObject {
        return !lodash.isEmpty(obj);
    },
    /**
     * 判断是否ReferenceObject类型
     * @param obj 对象
     * @returns 
     */
    isReferenceObject(obj: any): obj is ReferenceObject {
        return !lodash.isEmpty(obj);
    },
    isSchemaObject(obj: any): obj is SchemaObject {
        return !lodash.isEmpty(obj);
    }
}


export default OpenAPI3TypeUtils
