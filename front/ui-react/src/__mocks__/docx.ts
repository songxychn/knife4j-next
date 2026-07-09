// Mock docx for testing
const noop = (): Record<string, unknown> => ({});

export const Document = noop;
export const Packer = { toBlob: async (): Promise<Blob> => new Blob() };
export const Paragraph = noop;
export const TextRun = noop;
export const Table = noop;
export const TableRow = noop;
export const TableCell = noop;
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
