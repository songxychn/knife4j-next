import { buildSchemaFieldTree, type SchemaFieldNode } from 'knife4j-core';
import { Collapse, Empty, Input, Result, Space, Spin, Tag, Typography } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import SchemaFieldTable from '../components/schema/SchemaFieldTable';
import { normalizeGenericTitle } from '../components/schema/schemaUtils';
import { useGroup } from '../context/GroupContext';
import { useSettings } from '../context/SettingsContext';
import type { SchemaObject, SwaggerDoc } from '../types/swagger';

const { Title, Text } = Typography;

interface ModelDef {
  name: string;
  title?: string;
  description?: string;
  fields: SchemaFieldNode[];
}

function modelDomId(name: string): string {
  return `schema-${encodeURIComponent(name)}`;
}

function schemaToFields(schema: SchemaObject, swaggerDoc: SwaggerDoc): SchemaFieldNode[] {
  return buildSchemaFieldTree(schema as Record<string, unknown>, {
    doc: swaggerDoc as unknown as Record<string, unknown>,
    maxDepth: 8,
  });
}

function schemasToModels(schemas: Record<string, SchemaObject>, swaggerDoc: SwaggerDoc): ModelDef[] {
  return Object.entries(schemas).map(([name, schema]) => ({
    name,
    title: normalizeGenericTitle(schema.title),
    description: schema.description,
    fields: schemaToFields(schema, swaggerDoc),
  }));
}

export default function Schema() {
  const { t } = useTranslation();
  const { group: routeGroup, schemaName } = useParams<{ group?: string; schemaName?: string }>();
  const { schemas, swaggerDoc, loading, activeGroup } = useGroup();
  const { settings } = useSettings();
  const navigate = useNavigate();
  const selectedSchemaName = schemaName ? decodeURIComponent(schemaName) : undefined;
  const [searchText, setSearchText] = useState('');

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

  const models: ModelDef[] = useMemo(() => {
    if (loading || !swaggerDoc || settings.enableSwaggerModels === false) return [];
    return schemasToModels(schemas, swaggerDoc);
  }, [loading, schemas, swaggerDoc, settings.enableSwaggerModels]);

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

  useEffect(() => {
    if (selectedSchemaName) {
      setActiveKeys([selectedSchemaName]);
      window.setTimeout(() => {
        document.getElementById(modelDomId(selectedSchemaName))?.scrollIntoView({ block: 'start' });
      }, 0);
      return;
    }
    setActiveKeys(filteredModels.map((model) => model.name));
  }, [filteredModels, selectedSchemaName]);

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
            <Text type="secondary" style={{ marginLeft: 12, fontSize: 12 }}>
              {model.description}
            </Text>
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
