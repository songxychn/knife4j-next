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
  const { markdownDocs, loading } = useGroup();
  const { t } = useTranslation();

  const key = `/${group}/markdown/${groupIndex}/${itemIndex}`;
  const doc = markdownDocs.find((d) => d.key === key);

  if (!doc) {
    // `loading=true` means either the group list or the swaggerDoc for the
    // active group is still being fetched. In that window `markdownDocs` is
    // always empty, so rendering the "not found" message would flash on every
    // page load/refresh. Surface a neutral loading state instead; switch to
    // the "not found" copy only once loading has completed.
    const emptyCopy = loading ? t('markdownDocLoading') : t('markdownDocNotFound');
    return <div style={{ padding: 24, color: '#999', textAlign: 'center' }}>{emptyCopy}</div>;
  }

  return (
    <div style={{ padding: '16px 24px', maxWidth: 900 }}>
      <h2 style={{ marginBottom: 16 }}>{doc.title}</h2>
      <Markdown source={doc.content} />
    </div>
  );
};

export default MarkdownDocument;
