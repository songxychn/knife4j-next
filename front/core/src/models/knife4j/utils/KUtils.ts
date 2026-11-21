let uniqueIdCounter = 0;

const KUtils = {
  isEmpty(value: unknown): value is null | undefined {
    if (value === null || value === undefined) return true;
    if (typeof value === 'string' || Array.isArray(value)) return value.length === 0;
    if (typeof value === 'object') return Object.keys(value).length === 0;
    return true;
  },
  defaultTo<T>(value: T | null | undefined, fallback: T): T {
    return value === null || value === undefined || Number.isNaN(value) ? fallback : value;
  },
  uniqueId(prefix = ''): string {
    uniqueIdCounter += 1;
    return `${prefix}${uniqueIdCounter}`;
  },
  /**
   * 处理换行
   * @param str 换行字符
   */
  wrapLine(str: string): string {
    if (!KUtils.isEmpty(str)) {
      const newLinePattern = /(\r\n|\n\r|\r|\n)/g;
      if (newLinePattern.test(str)) {
        const newDes = str.replace(newLinePattern, '\\n');
        return newDes;
      }
      return str;
    }
    return '';
  },
  /**
   * 校验是否基础类型
   *  ("null","boolean", "object", "array", "number", or "string"), or "integer"
   * @param type 类型
   */
  basicType(type: string): boolean {
    const basicTypes = ['string', 'integer', 'number', 'object', 'boolean', 'int32', 'int64', 'float', 'double'];
    let flag = false;
    if (!KUtils.isEmpty(type)) {
      if (basicTypes.indexOf(type) > -1) {
        flag = true;
      }
    }
    return flag;
  },
  /**
   * 获取基础类型的初始value值
   * @param type 类型
   * @returns
   */
  basicTypeValue(type: string): any {
    let propValue;
    // 是否是基本类型
    if (type === 'integer') {
      propValue = 0;
    }
    if (type === 'boolean') {
      propValue = true;
    }
    if (type === 'object') {
      propValue = {};
    }
    if (type === 'number') {
      propValue = parseFloat('0');
    }
    return propValue;
  },
};

export default KUtils;
