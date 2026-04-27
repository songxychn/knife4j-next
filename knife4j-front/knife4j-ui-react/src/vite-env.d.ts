/// <reference types="vite/client" />

declare module 'react-syntax-highlighter/dist/esm/light' {
  import { ComponentType, CSSProperties } from 'react';
  interface SyntaxHighlighterProps {
    language?: string;
    style?: Record<string, CSSProperties>;
    customStyle?: CSSProperties;
    wrapLongLines?: boolean;
    children: string;
    [key: string]: unknown;
  }
  const SyntaxHighlighter: ComponentType<SyntaxHighlighterProps> & {
    registerLanguage: (name: string, language: unknown) => void;
  };
  export default SyntaxHighlighter;
}

declare module 'react-syntax-highlighter/dist/esm/languages/hljs/json' {
  const json: unknown;
  export default json;
}

declare module 'react-syntax-highlighter/dist/esm/styles/hljs' {
  import { CSSProperties } from 'react';
  const styles: Record<string, Record<string, CSSProperties>>;
  export const githubGist: Record<string, CSSProperties>;
  export default styles;
}
