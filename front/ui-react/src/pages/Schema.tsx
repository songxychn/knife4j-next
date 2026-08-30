import { Alert, Collapse, Empty, Input, Result, Space, Spin, Tag, Typography } from 'antd';
import type { TFunction } from 'i18next';
import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import SchemaFieldTable from '../components/schema/SchemaFieldTable';
import { useGroup } from '../context/GroupContext';
import { useSchemaEngine } from '../context/SchemaEngineContext';
import { useSettings } from '../context/SettingsContext';
import DescriptionText from '../components/DescriptionText';
import { isOas31SchemaDocument } from '../schema/schemaDocumentSession';
import { createSchemaDisplayProjector } from '../schema/schemaDisplayProjection';
import { buildLegacySchemaModels, projectSchemaModels } from '../schema/schemaModelProjection';
import {
  selectSchemaModelView,
  type SchemaModelViewNotice,
  type SchemaModelsProjectionState,
} from '../schema/schemaModelViewState';
import { resolveSchemaActiveKeys } from './schemaActiveKeys';

const { Title, Text } = Typography;

const IDLE_PROJECTION_STATE: SchemaModelsProjectionState = Object.freeze({ status: 'idle' });

function modelDomId(name: string): string {
  return `schema-${encodeURIComponent(name)}`;
}

function projectionErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unable to project OAS 3.1 data models.';
}

function projectionNoticeContent(notice: SchemaModelViewNotice, t: TFunction) {
  if (notice.kind === 'loading') {
    return {
      type: 'info' as const,
      title: t('schema.projection.loading.title'),
      description: t('schema.projection.loading.description'),
    };
  }
  if (notice.kind === 'fallback') {
    return {
      type: 'warning' as const,
      title: t('schema.projection.degraded.title'),
      description: t(
        notice.reason === 'engine'
          ? 'schema.projection.engineFallback.description'
          : 'schema.projection.projectionFallback.description',
      ),
    };
  }
  const visibleModels = notice.models.slice(0, 5);
  const modelNames = `${visibleModels.join(', ')}${notice.models.length > visibleModels.length ? ', …' : ''}`;
  const visibleKeywords = notice.keywords.slice(0, 5);
  const keywords = `${visibleKeywords.join(', ')}${notice.keywords.length > visibleKeywords.length ? ', …' : ''}`;
  return {
    type: 'warning' as const,
    title: t('schema.projection.degraded.title'),
    description: t('schema.projection.degraded.description', {
      count: notice.issueCount,
      modelCount: notice.modelCount,
      models: modelNames,
      keywords,
    }),
  };
}

export default function Schema() {
  const { t } = useTranslation();
  const { group: routeGroup, schemaName } = useParams<{ group?: string; schemaName?: string }>();
  const { schemas, swaggerDoc, loading, activeGroup } = useGroup();
  const schemaEngine = useSchemaEngine();
  const { settings } = useSettings();
  const navigate = useNavigate();
  const selectedSchemaName = schemaName ? decodeURIComponent(schemaName) : undefined;
  const [searchText, setSearchText] = useState('');
  const [projectionState, setProjectionState] = useState<SchemaModelsProjectionState>(IDLE_PROJECTION_STATE);

  // Route guard: when enableSwaggerModels=false, redirect away from schema page.
  // Prefer the route's :group param (always present on /:group/schema), then fall
  // back to a loaded activeGroup. If neither yields a non-empty group (e.g. a hard
  // refresh while groups are still loading and activeGroup falls back to
  // EMPTY_GROUP with value=''), navigate to '/' so the index <Home /> route can
  // take over instead of constructing an invalid '//home' URL.
  useEffect(() => {
    if (settings.enableSwaggerModels !== false) return;
    const targetGroup = routeGroup ?? (activeGroup.value || '');
    if (targetGroup) {
      navigate(`/${targetGroup}/home`, { replace: true });
    } else {
      navigate('/', { replace: true });
    }
  }, [settings.enableSwaggerModels, routeGroup, activeGroup.value, navigate]);

  const legacyModels = useMemo(() => {
    if (loading || !swaggerDoc || settings.enableSwaggerModels === false) return [];
    return buildLegacySchemaModels(schemas, swaggerDoc);
  }, [loading, schemas, swaggerDoc, settings.enableSwaggerModels]);

  const isOas31 = isOas31SchemaDocument(swaggerDoc);
  useEffect(() => {
    if (!isOas31 || !swaggerDoc || settings.enableSwaggerModels === false || schemaEngine.status !== 'ready') {
      setProjectionState(IDLE_PROJECTION_STATE);
      return;
    }

    const controller = new AbortController();
    const retrievalUri = schemaEngine.retrievalUri;
    const projector = createSchemaDisplayProjector(schemaEngine.session);
    setProjectionState({ status: 'loading', retrievalUri });
    projectSchemaModels(schemas, swaggerDoc, projector, { signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted) setProjectionState({ status: 'ready', retrievalUri, result });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')) return;
        setProjectionState({ status: 'error', retrievalUri, message: projectionErrorMessage(error) });
      });

    return () => controller.abort();
  }, [isOas31, schemaEngine, schemas, settings.enableSwaggerModels, swaggerDoc]);

  const { models, notice: projectionNotice } = useMemo(
    () =>
      selectSchemaModelView({
        isOas31,
        engineStatus: schemaEngine.status,
        retrievalUri: schemaEngine.retrievalUri,
        projectionState,
        legacyModels,
      }),
    [isOas31, legacyModels, projectionState, schemaEngine.retrievalUri, schemaEngine.status],
  );
  const noticeContent = projectionNotice ? projectionNoticeContent(projectionNotice, t) : null;

  const filteredModels = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    if (!q) return models;
    return models.filter(
      (model) =>
        model.name.toLowerCase().includes(q) ||
        (model.title ?? '').toLowerCase().includes(q) ||
        (model.description ?? '').toLowerCase().includes(q),
    );
  }, [models, searchText]);

  const [activeKeys, setActiveKeys] = useState<string[]>([]);
  const selectedModelVisible = useMemo(
    () => Boolean(selectedSchemaName && filteredModels.some((model) => model.name === selectedSchemaName)),
    [filteredModels, selectedSchemaName],
  );

  useEffect(() => {
    setActiveKeys(resolveSchemaActiveKeys(selectedSchemaName));
    if (selectedSchemaName) {
      if (!selectedModelVisible) return;
      window.setTimeout(() => {
        document.getElementById(modelDomId(selectedSchemaName))?.scrollIntoView({ block: 'start' });
      }, 0);
    }
  }, [activeGroup.value, selectedModelVisible, selectedSchemaName]);

  // Disabled state: show access-denied instead of schema content
  if (settings.enableSwaggerModels === false) {
    return <Result status="403" title={t('schema.disabled.title')} subTitle={t('schema.disabled.description')} />;
  }

  const collapseItems = filteredModels.map((model) => {
    const displayTitle = model.title && model.title !== model.name ? model.title : undefined;
    return {
      key: model.name,
      label: (
        <span id={modelDomId(model.name)}>
          <Text strong style={{ fontSize: 14 }}>
            {displayTitle ?? model.name}
          </Text>
          {displayTitle && (
            <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
              ({model.name})
            </Text>
          )}
          {model.description && (
            <DescriptionText type="secondary" style={{ marginLeft: 12, fontSize: 12 }}>
              {model.description}
            </DescriptionText>
          )}
          <Tag style={{ marginLeft: 12 }} color="default">
            {model.fields.length} {t('schema.fields')}
          </Tag>
        </span>
      ),
      children: <SchemaFieldTable fields={model.fields} />,
    };
  });

  return (
    <div style={{ padding: '24px', maxWidth: 1180 }}>
      <Space align="center" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>
          {t('schema.title')}
        </Title>
        <Input.Search
          allowClear
          value={searchText}
          onChange={(event) => setSearchText(event.target.value)}
          placeholder={t('schema.search.placeholder')}
          style={{ width: 280 }}
        />
      </Space>

      {noticeContent && (
        <Alert
          showIcon
          type={noticeContent.type}
          message={noticeContent.title}
          description={noticeContent.description}
          style={{ marginBottom: 16 }}
        />
      )}

      {loading ? (
        <Spin />
      ) : filteredModels.length === 0 ? (
        <Empty description={t('schema.empty')} />
      ) : (
        <Collapse
          items={collapseItems}
          activeKey={activeKeys}
          onChange={(keys) => setActiveKeys(Array.isArray(keys) ? keys.map(String) : [String(keys)])}
        />
      )}
    </div>
  );
}
