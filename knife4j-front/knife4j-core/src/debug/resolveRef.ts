/**
 * resolveRef — 统一处理 OAS2 definitions 与 OAS3 components.schemas 的 $ref 引用
 *
 * 规则：
 * - OAS3: #/components/schemas/{name}
 * - OAS2: #/definitions/{name}
 * - 支持 $ref 在数组/对象/嵌套结构中出现的场景
 * - 返回 undefined 表示引用不存在
 */

/**
 * 从 OpenAPI 文档中解析 $ref 指向的对象
 *
 * @param ref  引用路径，如 "#/components/schemas/User" 或 "#/definitions/User"
 * @param doc  完整的 OpenAPI 文档对象（OAS2 或 OAS3）
 * @returns    被引用的 schema 对象；找不到时返回 undefined
 */
export function resolveRef(ref: string, doc: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!ref || !ref.startsWith('#/')) return undefined;

  const parts = ref.slice(2).split('/');
  let current: unknown = doc;

  for (const part of parts) {
    if (current === null || typeof current !== 'object') return undefined;
    // JSON Pointer 允许 ~1 → / 和 ~0 → ~
    const key = part.replace(/~1/g, '/').replace(/~0/g, '~');
    current = (current as Record<string, unknown>)[key];
  }

  if (current === null || typeof current !== 'object') return undefined;
  return current as Record<string, unknown>;
}

/**
 * 如果对象含 $ref，则解析为实际对象；否则原样返回。
 * 递归解析直到不再出现 $ref 或达到最大深度。
 *
 * @param maxResolveDepth  防止 $ref 循环，默认 10
 */
export function dereference(
  obj: Record<string, unknown>,
  doc: Record<string, unknown>,
  maxResolveDepth = 10,
): Record<string, unknown> {
  let current = obj;
  let depth = 0;
  while (current.$ref && typeof current.$ref === 'string' && depth < maxResolveDepth) {
    const resolved = resolveRef(String(current.$ref), doc);
    if (!resolved) break;
    current = resolved;
    depth++;
  }
  return current;
}

/**
 * 解析 $ref 并将目标的 description / title 透传到结果中。
 * 父字段自身的 description / title 优先，不会被 ref 目标覆盖。
 *
 * 使用场景：字段类型是 $ref 时，调用方可以把 ref 目标的 description/title
 * 作为二级说明展示，而不丢失父字段自身的描述。
 *
 * @returns 包含 refDescription / refTitle 的对象（若 ref 目标有对应字段）
 */
export function resolveRefMeta(
  ref: string,
  doc: Record<string, unknown>,
): { refDescription?: string; refTitle?: string } {
  const target = resolveRef(ref, doc);
  if (!target) return {};
  const result: { refDescription?: string; refTitle?: string } = {};
  if (typeof target.description === 'string' && target.description) {
    result.refDescription = target.description;
  }
  if (typeof target.title === 'string' && target.title) {
    result.refTitle = target.title;
  }
  return result;
}


