import { Card, Descriptions, Statistic, Row, Col, Typography, Spin } from 'antd';
import { useGroup } from '../context/GroupContext';

const { Title, Paragraph } = Typography;

const HTTP_METHODS = ['get', 'post', 'put', 'delete', 'patch'] as const;

export default function Home() {
  const { swaggerDoc, loading } = useGroup();

  if (loading) {
    return <Spin style={{ display: 'block', margin: '80px auto' }} />;
  }

  if (!swaggerDoc) {
    return <div style={{ padding: 24 }}>暂无数据</div>;
  }

  const { info, paths } = swaggerDoc;

  // Count methods
  const counts: Record<string, number> = { get: 0, post: 0, put: 0, delete: 0, patch: 0 };
  let total = 0;
  for (const pathItem of Object.values(paths ?? {})) {
    for (const method of HTTP_METHODS) {
      if (pathItem[method]) {
        counts[method]++;
        total++;
      }
    }
  }

  return (
    <div style={{ padding: 24 }}>
      <Title level={3}>{info.title ?? 'Unknown'}</Title>

      <Card style={{ marginBottom: 24 }}>
        <Descriptions column={1} size="small">
          <Descriptions.Item label="版本">{info.version ?? '-'}</Descriptions.Item>
          {info.description && (
            <Descriptions.Item label="描述">
              <Paragraph style={{ margin: 0 }}>{info.description}</Paragraph>
            </Descriptions.Item>
          )}
        </Descriptions>
      </Card>

      <Card title="接口统计">
        <Row gutter={16}>
          <Col span={4}>
            <Statistic title="总计" value={total} />
          </Col>
          <Col span={4}>
            <Statistic title="GET" value={counts.get} valueStyle={{ color: '#61affe' }} />
          </Col>
          <Col span={4}>
            <Statistic title="POST" value={counts.post} valueStyle={{ color: '#49cc90' }} />
          </Col>
          <Col span={4}>
            <Statistic title="PUT" value={counts.put} valueStyle={{ color: '#fca130' }} />
          </Col>
          <Col span={4}>
            <Statistic title="DELETE" value={counts.delete} valueStyle={{ color: '#f93e3e' }} />
          </Col>
          <Col span={4}>
            <Statistic title="PATCH" value={counts.patch} valueStyle={{ color: '#50e3c2' }} />
          </Col>
        </Row>
      </Card>
    </div>
  );
}
