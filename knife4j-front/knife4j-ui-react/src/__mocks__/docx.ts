// @ts-nocheck
const noop = () => ({});
module.exports = {
  Document: noop,
  Packer: { toBlob: async () => new Blob() },
  Paragraph: noop,
  TextRun: noop,
  Table: noop,
  TableRow: noop,
  TableCell: noop,
  WidthType: { PERCENTAGE: 'pct' },
  AlignmentType: { CENTER: 'center' },
  BorderStyle: { SINGLE: 'single' },
  HeadingLevel: { TITLE: 'title', HEADING_2: 'heading2' },
  ShadingType: { SOLID: 'solid' },
};
