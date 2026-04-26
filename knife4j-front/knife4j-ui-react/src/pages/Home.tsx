import { useMemo } from 'react';
import {
  Card,
  Col,
  Divider,
  Empty,
  Progress,
  Row,
  Space,
  Spin,
  Statistic,
  Tag,
  theme,
  Tooltip,
  Typography,
} from 'antd';
import {
  ApiOutlined,
  CloudServerOutlined,
  CodeOutlined,
  DatabaseOutlined,
  FileProtectOutlined,
  InfoCircleOutlined,
  LinkOutlined,
  MailOutlined,
  SafetyCertificateOutlined,
  TagsOutlined,
  UserOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { useGroup } from '../context/GroupContext';
import Markdown from '../components/Markdown';
import type { PathItemObject, SwaggerServer } from '../types/swagger';
import knife4jMark from '../assets/logo/knife4j-next-mark.svg';

const { Title, Text, Paragraph, Link } = Typography;

const HTTP_METHODS = ['get', 'post', 'put', 'delete', 'patch', 'head', 'options'] as const;
type HttpMethod = (typeof HTTP_METHODS)[number];

const METHOD_COLORS: Record<HttpMethod, string> = {
  get: '#61affe',
  post: '#49cc90',
  put: '#fca130',
  delete: '#f93e3e',
  patch: '#50e3c2',
  head: '#9012fe',
  options: '#0d5aa7',
};

export default function Home() {
  const { t } = useTranslation();
  const { swaggerDoc, menuTags, schemas, loading } = useGroup();
  const { token } = theme.useToken();

  // Servers: prefer OAS3 servers, fall back to OAS2 host/basePath/schemes
  const servers = useMemo<SwaggerServer[]>(() => {
    if (!swaggerDoc) return [];
    if (swaggerDoc.servers && swaggerDoc.servers.length > 0) {
      return swaggerDoc.servers;
    }
    if (swaggerDoc.host) {
      const schemes = swaggerDoc.schemes && swaggerDoc.schemes.length > 0 ? swaggerDoc.schemes : ['http'];
      return schemes.map((scheme) => ({
        url: `${scheme}://${swaggerDoc.host}${swaggerDoc.basePath ?? ''}`,
      }));
    }
    return [];
  }, [swaggerDoc]);

  const stats = useMemo(() => {
    if (!swaggerDoc) {
      return {
        total: 0,
        counts: {} as Record<HttpMethod, number>,
        deprecatedCount: 0,
        pathCount: 0,
        topTags: [] as { tag: string; count: number; deprecated: number }[],
      };
    }
    const counts: Record<HttpMethod, number> = {
      get: 0,
      post: 0,
      put: 0,
      delete: 0,
      patch: 0,
      head: 0,
      options: 0,
    };
    let total = 0;
    let deprecatedCount = 0;
    let pathCount = 0;
    for (const pathItem of Object.values(swaggerDoc.paths ?? {})) {
      let pathHasOp = false;
      for (const method of HTTP_METHODS) {
        const op = (pathItem as PathItemObject)[method];
        if (op) {
          counts[method]++;
          total++;
          pathHasOp = true;
          if (op.deprecated) deprecatedCount++;
        }
      }
      if (pathHasOp) pathCount++;
    }
    const topTags = menuTags
      .map((m) => ({
        tag: m.tag,
        count: m.operations.length,
        deprecated: m.operations.filter((op) => op.deprecated).length,
      }))
      .sort((a, b) => b.count - a.count);
    return { total, counts, deprecatedCount, pathCount, topTags };
  }, [swaggerDoc, menuTags]);

  if (loading) {
    return <Spin style={{ display: 'block', margin: '80px auto' }} />;
  }

  if (!swaggerDoc) {
    return (
      <div style={{ padding: 48 }}>
        <Empty description={t('home.noData')} />
      </div>
    );
  }

  const { info } = swaggerDoc;
  const specLabel = swaggerDoc.openapi
    ? `OpenAPI ${swaggerDoc.openapi}`
    : swaggerDoc.swagger
      ? `Swagger ${swaggerDoc.swagger}`
      : 'OpenAPI';

  const versionLabel = info.version ? (/^v/i.test(info.version) ? info.version : `v${info.version}`) : '-';

  const schemaCount = Object.keys(schemas).length;
  const securitySchemes = swaggerDoc.components?.securitySchemes ?? swaggerDoc.securityDefinitions ?? {};
  const securitySchemeCount = Object.keys(securitySchemes).length;

  const tagTotalOps = stats.topTags.reduce((sum, it) => sum + it.count, 0);
  const maxTagCount = stats.topTags[0]?.count ?? 0;

  const heroBg = `linear-gradient(135deg, ${token.colorPrimary} 0%, ${token.colorInfoHover ?? '#1677ff'} 45%, #40c9a2 100%)`;

  const hasContactInfo = !!(info.contact?.name || info.contact?.email || info.contact?.url);
  const hasLicense = !!(info.license?.name || info.license?.url);
  const hasTerms = !!info.termsOfService;
  const hasAnyMeta = hasContactInfo || hasLicense || hasTerms || servers.length > 0;

  return (
    <div style={{ padding: 20 }}>
      {/* Hero */}
      <div
        style={{
          position: 'relative',
          padding: '28px 32px',
          borderRadius: 12,
          color: '#fff',
          background: heroBg,
          overflow: 'hidden',
          marginBottom: 20,
          boxShadow: '0 6px 18px rgba(0,0,0,0.08)',
        }}
      >
        <img
          src={knife4jMark}
          alt=""
          aria-hidden
          style={{
            position: 'absolute',
            right: -24,
            bottom: -24,
            width: 220,
            height: 220,
            opacity: 0.08,
            pointerEvents: 'none',
          }}
        />
        <Space size={8} wrap style={{ marginBottom: 10 }}>
          <Tag color="rgba(255,255,255,0.22)" style={{ color: '#fff', border: 0 }}>
            <CodeOutlined /> {specLabel}
          </Tag>
          <Tag color="rgba(255,255,255,0.22)" style={{ color: '#fff', border: 0 }}>
            {versionLabel}
          </Tag>
          {stats.deprecatedCount > 0 && (
            <Tag color="rgba(255,180,0,0.22)" style={{ color: '#fff', border: 0 }}>
              <WarningOutlined /> {stats.deprecatedCount} {t('home.deprecated')}
            </Tag>
          )}
        </Space>
        <Title
          level={2}
          style={{
            color: '#fff',
            margin: 0,
            fontSize: 30,
            lineHeight: 1.2,
            letterSpacing: 0.2,
          }}
        >
          {info.title ?? 'Unknown'}
        </Title>
        {info.description && (
          <Paragraph
            style={{
              color: 'rgba(255,255,255,0.9)',
              marginTop: 10,
              marginBottom: 0,
              maxWidth: 900,
              fontSize: 14,
            }}
          >
            <Markdown source={info.description} />
          </Paragraph>
        )}
      </div>

      {/* Stats */}
      <Row gutter={[16, 16]} style={{ marginBottom: 4 }}>
        <Col xs={24} sm={12} md={6}>
          <Card hoverable size="small" bodyStyle={{ padding: 16 }}>
            <Statistic
              title={
                <Space size={6}>
                  <ApiOutlined />
                  <span>{t('home.stats.apis')}</span>
                </Space>
              }
              value={stats.total}
              valueStyle={{ color: token.colorPrimary, fontWeight: 600 }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={6}>
          <Card hoverable size="small" bodyStyle={{ padding: 16 }}>
            <Statistic
              title={
                <Space size={6}>
                  <LinkOutlined />
                  <span>{t('home.stats.paths')}</span>
                </Space>
              }
              value={stats.pathCount}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={6}>
          <Card hoverable size="small" bodyStyle={{ padding: 16 }}>
            <Statistic
              title={
                <Space size={6}>
                  <TagsOutlined />
                  <span>{t('home.stats.tags')}</span>
                </Space>
              }
              value={menuTags.length}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={6}>
          <Card hoverable size="small" bodyStyle={{ padding: 16 }}>
            <Statistic
              title={
                <Space size={6}>
                  <DatabaseOutlined />
                  <span>{t('home.stats.schemas')}</span>
                </Space>
              }
              value={schemaCount}
            />
          </Card>
        </Col>
      </Row>

      {/* Method distribution */}
      <Card
        title={
          <Space>
            <ApiOutlined />
            <span>{t('home.apiStats')}</span>
            <Text type="secondary" style={{ fontSize: 12, fontWeight: 'normal' }}>
              {t('home.methodDistribution')}
            </Text>
          </Space>
        }
        style={{ marginTop: 16 }}
        size="small"
      >
        <Row gutter={[12, 12]}>
          {HTTP_METHODS.filter((m) => stats.counts[m] > 0).map((m) => {
            const c = stats.counts[m];
            const pct = stats.total > 0 ? Math.round((c / stats.total) * 100) : 0;
            return (
              <Col key={m} xs={12} sm={8} md={6} lg={4} xl={3}>
                <div
                  style={{
                    padding: '10px 12px',
                    border: `1px solid ${token.colorBorderSecondary}`,
                    borderRadius: 8,
                    background: token.colorFillQuaternary,
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}
                  >
                    <Tag color={METHOD_COLORS[m]} style={{ margin: 0, fontWeight: 700, letterSpacing: 0.5 }}>
                      {m.toUpperCase()}
                    </Tag>
                    <span style={{ fontSize: 18, fontWeight: 600, color: token.colorText }}>{c}</span>
                  </div>
                  <Progress
                    percent={pct}
                    showInfo={false}
                    strokeColor={METHOD_COLORS[m]}
                    size="small"
                    style={{ marginTop: 8, marginBottom: 0 }}
                  />
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {pct}%
                  </Text>
                </div>
              </Col>
            );
          })}
          {stats.total === 0 && (
            <Col span={24}>
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('home.noOperations')} />
            </Col>
          )}
        </Row>
      </Card>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        {/* Tag ranking */}
        <Col xs={24} lg={14}>
          <Card
            title={
              <Space>
                <TagsOutlined />
                <span>{t('home.tagRanking')}</span>
                <Text type="secondary" style={{ fontSize: 12, fontWeight: 'normal' }}>
                  {t('home.tagRanking.desc')}
                </Text>
              </Space>
            }
            size="small"
            style={{ height: '100%' }}
          >
            {stats.topTags.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('home.noTags')} />
            ) : (
              <div style={{ maxHeight: 320, overflowY: 'auto' }}>
                {stats.topTags.slice(0, 12).map((item) => {
                  const pct = maxTagCount > 0 ? Math.round((item.count / maxTagCount) * 100) : 0;
                  return (
                    <div key={item.tag} style={{ marginBottom: 10 }}>
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          marginBottom: 4,
                        }}
                      >
                        <Space size={6}>
                          <Text strong style={{ fontSize: 13 }}>
                            {item.tag}
                          </Text>
                          {item.deprecated > 0 && (
                            <Tooltip title={t('home.deprecatedCount', { count: item.deprecated })}>
                              <Tag color="orange" style={{ margin: 0, fontSize: 11 }}>
                                <WarningOutlined /> {item.deprecated}
                              </Tag>
                            </Tooltip>
                          )}
                        </Space>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {item.count} / {tagTotalOps}
                        </Text>
                      </div>
                      <Progress percent={pct} showInfo={false} strokeColor={token.colorPrimary} size="small" />
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </Col>

        {/* Meta info */}
        <Col xs={24} lg={10}>
          <Card
            title={
              <Space>
                <InfoCircleOutlined />
                <span>{t('home.docMeta')}</span>
              </Space>
            }
            size="small"
            style={{ height: '100%' }}
          >
            {!hasAnyMeta && securitySchemeCount === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('home.noMeta')} />
            ) : (
              <Space direction="vertical" size={10} style={{ width: '100%' }}>
                {servers.length > 0 && (
                  <div>
                    <Space size={6} style={{ marginBottom: 4 }}>
                      <CloudServerOutlined style={{ color: token.colorPrimary }} />
                      <Text strong style={{ fontSize: 13 }}>
                        {t('home.meta.servers')}
                      </Text>
                    </Space>
                    <div>
                      {servers.map((s, idx) => (
                        <Tooltip key={`${s.url}-${idx}`} title={s.description}>
                          <Tag
                            color="blue"
                            style={{
                              marginBottom: 4,
                              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                              fontSize: 12,
                            }}
                          >
                            {s.url}
                          </Tag>
                        </Tooltip>
                      ))}
                    </div>
                  </div>
                )}

                {hasContactInfo && (
                  <div>
                    <Space size={6} style={{ marginBottom: 4 }}>
                      <UserOutlined style={{ color: token.colorPrimary }} />
                      <Text strong style={{ fontSize: 13 }}>
                        {t('home.meta.contact')}
                      </Text>
                    </Space>
                    <div style={{ fontSize: 13 }}>
                      {info.contact?.name && <div>{info.contact.name}</div>}
                      {info.contact?.email && (
                        <div>
                          <MailOutlined style={{ marginRight: 4 }} />
                          <Link href={`mailto:${info.contact.email}`}>{info.contact.email}</Link>
                        </div>
                      )}
                      {info.contact?.url && (
                        <div>
                          <LinkOutlined style={{ marginRight: 4 }} />
                          <Link href={info.contact.url} target="_blank" rel="noreferrer">
                            {info.contact.url}
                          </Link>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {hasLicense && (
                  <div>
                    <Space size={6} style={{ marginBottom: 4 }}>
                      <FileProtectOutlined style={{ color: token.colorPrimary }} />
                      <Text strong style={{ fontSize: 13 }}>
                        {t('home.meta.license')}
                      </Text>
                    </Space>
                    <div style={{ fontSize: 13 }}>
                      {info.license?.url ? (
                        <Link href={info.license.url} target="_blank" rel="noreferrer">
                          {info.license.name ?? info.license.url}
                        </Link>
                      ) : (
                        <Text>{info.license?.name}</Text>
                      )}
                    </div>
                  </div>
                )}

                {hasTerms && (
                  <div>
                    <Space size={6} style={{ marginBottom: 4 }}>
                      <SafetyCertificateOutlined style={{ color: token.colorPrimary }} />
                      <Text strong style={{ fontSize: 13 }}>
                        {t('home.meta.terms')}
                      </Text>
                    </Space>
                    <div style={{ fontSize: 13 }}>
                      <Link href={info.termsOfService} target="_blank" rel="noreferrer">
                        {info.termsOfService}
                      </Link>
                    </div>
                  </div>
                )}

                {securitySchemeCount > 0 && (
                  <>
                    <Divider style={{ margin: '4px 0' }} />
                    <div>
                      <Space size={6} style={{ marginBottom: 4 }}>
                        <SafetyCertificateOutlined style={{ color: token.colorPrimary }} />
                        <Text strong style={{ fontSize: 13 }}>
                          {t('home.meta.security')}
                        </Text>
                      </Space>
                      <div>
                        {Object.entries(securitySchemes).map(([name, scheme]) => (
                          <Tag key={name} color="geekblue" style={{ marginBottom: 4 }}>
                            {name} · {scheme.type}
                          </Tag>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </Space>
            )}
          </Card>
        </Col>
      </Row>
    </div>
  );
}
