import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import JsonViewer from '../../components/JsonViewer';
import ResizableBox from '../../components/ResizableBox';
import { DEBUG_PANEL_DEFAULT_MAX_HEIGHT, DEBUG_PANEL_MAX_HEIGHT, DEBUG_PANEL_MIN_HEIGHT } from './debugPanelLayout';
import { prepareResponseJson } from './responseJsonFolding';
import CodeBlock from './CodeBlock';

export default function ResponseJsonViewer({
  response,
  descMap,
  showDescription,
  bodyHeight,
  onBodyHeightChange,
}: {
  response: { readonly rawText: string };
  descMap: Map<string, string>;
  showDescription: boolean;
  bodyHeight?: number;
  onBodyHeightChange?: (height: number | undefined) => void;
}) {
  const { t } = useTranslation();
  const model = useMemo(() => prepareResponseJson(response.rawText), [response.rawText]);
  if (!model.valid) {
    const fallback = (
      <CodeBlock
        code={model.text}
        language="text"
        height={bodyHeight !== undefined ? '100%' : undefined}
        maxHeight={DEBUG_PANEL_DEFAULT_MAX_HEIGHT}
      />
    );
    if (!onBodyHeightChange) return fallback;
    return (
      <ResizableBox
        height={bodyHeight}
        defaultMaxHeight={DEBUG_PANEL_DEFAULT_MAX_HEIGHT}
        minHeight={DEBUG_PANEL_MIN_HEIGHT}
        maxHeight={DEBUG_PANEL_MAX_HEIGHT}
        onHeightChange={onBodyHeightChange}
        handleLabel={t('apiDebug.response.resizeHandle')}
        resetTitle={t('apiDebug.panel.resizeResetTitle')}
      >
        {fallback}
      </ResizableBox>
    );
  }
  return (
    <div data-response-json-viewer>
      <JsonViewer
        model={model}
        lineWrapping={false}
        resetKey={response}
        descMap={descMap}
        showDescription={showDescription}
        height={bodyHeight !== undefined ? '100%' : undefined}
        maxHeight={DEBUG_PANEL_DEFAULT_MAX_HEIGHT}
        ariaLabel={t('apiDebug.response.jsonViewer')}
        wrapEditor={
          onBodyHeightChange
            ? (editor) => (
                <ResizableBox
                  height={bodyHeight}
                  defaultMaxHeight={DEBUG_PANEL_DEFAULT_MAX_HEIGHT}
                  minHeight={DEBUG_PANEL_MIN_HEIGHT}
                  maxHeight={DEBUG_PANEL_MAX_HEIGHT}
                  onHeightChange={onBodyHeightChange}
                  handleLabel={t('apiDebug.response.resizeHandle')}
                  resetTitle={t('apiDebug.panel.resizeResetTitle')}
                >
                  {editor}
                </ResizableBox>
              )
            : undefined
        }
      />
    </div>
  );
}
