import { SpecType } from './SpecType';
import { ISpecParser } from './knife4j/ISpecParser';
import { OpenAPIParser } from './openapi3/parse';

/**
 * 工厂类
 */
export class SpecParserFactory {
  /**
   * 工厂Map
   */
  private parsers: Map<SpecType, ISpecParser> = new Map();

  constructor() {
    this.registerParser(SpecType.OpenAPI, new OpenAPIParser());
  }

  /**
   * 注册实例
   * @param specType 规范类型
   * @param parser 转换器
   */
  public registerParser(specType: SpecType, parser: ISpecParser): void {
    this.parsers.set(specType, parser);
  }

  /**
   * 获取parse实例对象
   * @param parserType 规范类型
   * @returns
   */
  public getParser(parserType: SpecType): ISpecParser {
    const parser = this.parsers.get(parserType);

    if (!parser) {
      throw new Error(`Parser not found`);
    }
    return parser;
  }
}
