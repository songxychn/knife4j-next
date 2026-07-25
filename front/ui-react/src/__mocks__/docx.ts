// Mock docx for testing
class MockNode {
  constructor(options: Record<string, unknown> = {}) {
    Object.assign(this, options);
  }
}

export const Document = MockNode;
export const Packer = {
  toBlob: async (document: unknown): Promise<Blob> => new Blob([JSON.stringify(document)]),
};
export const Paragraph = MockNode;
export const TextRun = MockNode;
export const Table = MockNode;
export const TableRow = MockNode;
export const TableCell = MockNode;
export const WidthType = { PERCENTAGE: 'pct' };
export const AlignmentType = { CENTER: 'center' };
export const BorderStyle = { SINGLE: 'single' };
export const HeadingLevel = { TITLE: 'title', HEADING_2: 'heading2' };
export const ShadingType = { SOLID: 'solid' };

export default {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  AlignmentType,
  BorderStyle,
  HeadingLevel,
  ShadingType,
};
