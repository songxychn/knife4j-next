export type DocumentTool = 'globalParam' | 'cookieSession' | 'authorize';

export interface DocumentToolRoute {
  group: string;
  tool: DocumentTool;
}

const DOCUMENT_TOOL_ROUTE_PATTERN = /^\/([^/]+)\/(globalParam|cookieSession|authorize)$/;

export function matchDocumentToolRoute(pathname: string): DocumentToolRoute | null {
  const match = pathname.match(DOCUMENT_TOOL_ROUTE_PATTERN);
  if (!match) return null;

  return {
    group: match[1],
    tool: match[2] as DocumentTool,
  };
}

export function buildDocumentToolRoute(group: string, tool: DocumentTool): string {
  return `/${group}/${tool}`;
}
