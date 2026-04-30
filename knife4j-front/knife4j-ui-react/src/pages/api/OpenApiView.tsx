import { useMemo } from 'react';
import { Alert, Spin, message } from 'antd';
import { useTranslation } from 'react-i18next';
import { useCurrentOperation } from './useCurrentOperation';
import { OperationModeTabs } from './useCurrentOperation';
import CodeBlock from './CodeBlock';
import { copyToClipboard } from '../../utils/clipboard';
import type { OperationObject } from '../../types/swagger';

export default function OpenApiView() {
  const { t } = useTranslation();
  const { loading, swaggerDoc, operation } = useCurrentOperation();

  const openApiJson = useMemo(() => {
    if (!swaggerDoc || !operation) return null;
    const op = operation.operation;
    const method = operation.method.toLowerCase();
    const path = operation.path;

    // Build a minimal OpenAPI path item for this operation
    const pathItem: Record<string, OperationObject> = {
      [method]: op,
    };

    // Collect referenced schemas
    const referencedSchemas: Record<string, unknown> = {};
    const allSchemas = swaggerDoc.components?.schemas ?? swaggerDoc.definitions ?? {};

    function collectRefs(obj: unknown, seen = new Set<string>()) {
      if (!obj || typeof obj !== 'object') return;
      if (Array.isArray(obj)) {
        obj.forEach((item) => collectRefs(item, seen));
        return;
      }
      const record = obj as Record<string, unknown>;
      if (typeof record['$ref'] === 'string') {
        const ref = record['$ref'] as string;
        const match = ref.match(/^#\/components\/schemas\/(.+)$/) ?? ref.match(/^#\/definitions\/(.+)$/);
        if (match) {
          const name = match[1];
          if (!seen.has(name) && allSchemas[name]) {
            seen.add(name);
            referencedSchemas[name] = allSchemas[name];
            collectRefs(allSchemas[name], seen);
          }
        }
      }
      Object.values(record).forEach((v) => collectRefs(v, seen));
    }

    collectRefs(op);

    const fragment: Record<string, unknown> = {
      openapi: swaggerDoc.openapi ?? '3.0.0',
      info: swaggerDoc.info,
      paths: {
        [path]: pathItem,
      },
    };

    if (Object.keys(referencedSchemas).length > 0) {
      if (swaggerDoc.components?.schemas) {
        fragment['components'] = { schemas: referencedSchemas };
      } else {
        fragment['definitions'] = referencedSchemas;
      }
    }

    try {
      return JSON.stringify(fragment, null, 2);
    } catch {
      return null;
    }
  }, [swaggerDoc, operation]);

  if (loading) {
    return <Spin style={{ display: 'block', margin: '80px auto' }} />;
  }

  if (!swaggerDoc || !operation) {
    return (
      <Alert
        type="warning"
        showIcon
        message={t('apiOpenApi.notFound.title')}
        description={t('apiOpenApi.notFound.desc')}
      />
    );
  }

  const handleCopy = () => {
    if (!openApiJson) return;
    copyToClipboard(
      openApiJson,
      () => message.success(t('apiOpenApi.copied')),
      () => message.error(t('apiDoc.copy.failed')),
    );
  };

  return (
    <div style={{ padding: '0 24px 24px', maxWidth: 1080 }}>
      <OperationModeTabs activeKey="openapi" />

      {openApiJson ? (
        <CodeBlock code={openApiJson} language="json" maxHeight={600} onCopy={handleCopy} />
      ) : (
        <Alert type="info" showIcon message={t('apiOpenApi.noData')} />
      )}
    </div>
  );
}
