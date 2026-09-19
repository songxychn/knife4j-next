import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import JsonViewer from '../../components/JsonViewer';
import { prepareResponseJson } from './responseJsonFolding';
import CodeBlock from './CodeBlock';

export default function ResponseJsonViewer({
  response,
  descMap,
  showDescription,
}: {
  response: { readonly rawText: string };
  descMap: Map<string, string>;
  showDescription: boolean;
}) {
  const { t } = useTranslation();
  const model = useMemo(() => prepareResponseJson(response.rawText), [response.rawText]);
  if (!model.valid) return <CodeBlock code={model.text} language="text" />;
  return (
    <div data-response-json-viewer>
      <JsonViewer
        model={model}
        lineWrapping={false}
        resetKey={response}
        descMap={descMap}
        showDescription={showDescription}
        ariaLabel={t('apiDebug.response.jsonViewer')}
      />
    </div>
  );
}
