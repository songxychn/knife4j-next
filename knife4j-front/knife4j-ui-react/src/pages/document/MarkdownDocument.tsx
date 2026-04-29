import React from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useGroup } from '../../context/GroupContext';
import Markdown from '../../components/Markdown';

const MarkdownDocument: React.FC = () => {
  const { group, groupIndex, itemIndex } = useParams<{
    group: string;
    groupIndex: string;
    itemIndex: string;
  }>();
  const { markdownDocs } = useGroup();
  const { t } = useTranslation();

  const key = `/${group}/markdown/${groupIndex}/${itemIndex}`;
  const doc = markdownDocs.find((d) => d.key === key);

  if (!doc) {
    return <div style={{ padding: 24, color: '#999', textAlign: 'center' }}>{t('markdownDocNotFound')}</div>;
  }

  return (
    <div style={{ padding: '16px 24px', maxWidth: 900 }}>
      <h2 style={{ marginBottom: 16 }}>{doc.title}</h2>
      <Markdown source={doc.content} />
    </div>
  );
};

export default MarkdownDocument;
