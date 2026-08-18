import type { MenuOperation, MenuTag } from '../../types/swagger';

export interface OfficeDocOutlineOperation {
  operation: MenuOperation;
  numberPath: readonly [number, number];
  title: string;
}

export interface OfficeDocOutlineTag {
  tag: MenuTag;
  numberPath: readonly [number];
  operations: OfficeDocOutlineOperation[];
}

export function formatOfficeDocOutlineNumber(numberPath: readonly number[]): string {
  return numberPath.join('.');
}

export function buildOfficeDocOutline(tags: readonly MenuTag[]): OfficeDocOutlineTag[] {
  return tags.map((tag, tagIndex) => {
    const tagNumber = tagIndex + 1;
    return {
      tag,
      numberPath: [tagNumber],
      operations: tag.operations.map((operation, operationIndex) => ({
        operation,
        numberPath: [tagNumber, operationIndex + 1],
        title: operation.operation.summary?.trim() || `${operation.method.toUpperCase()} ${operation.path}`,
      })),
    };
  });
}
