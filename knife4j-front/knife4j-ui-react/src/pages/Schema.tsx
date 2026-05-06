import { buildSchemaFieldTree, type SchemaFieldNode } from 'knife4j-core';
import { Collapse, Empty, Input, Space, Spin, Tag, Typography } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import SchemaFieldTable from '../components/schema/SchemaFieldTable';
import { normalizeGenericTitle } from '../components/schema/schemaUtils';
import { useGroup } from '../context/GroupContext';
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
  const { schemaName } = useParams<{ schemaName?: string }>();
  const { schemas, swaggerDoc, loading } = useGroup();
  const selectedSchemaName = schemaName ? decodeURIComponent(schemaName) : undefined;
  const [searchText, setSearchText] = useState('');

  const models: ModelDef[] = useMemo(() => {
    if (loading || !swaggerDoc) return [];
    return schemasToModels(schemas, swaggerDoc);
  }, [loading, schemas, swaggerDoc]);

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

  const collapseItems = filteredModels.map((model) => {
    const displayName = model.title && model.title !== model.name ? model.title : model.name;
    const showKey = model.title && model.title !== model.name;
    return {
      key: model.name,
      label: (
        <span id={modelDomId(model.name)}>
          <Text strong style={{ fontSize: 14 }}>
            {displayName}
          </Text>
          {showKey && (
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
