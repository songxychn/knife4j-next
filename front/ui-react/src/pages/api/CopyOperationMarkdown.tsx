import { useEffect, useMemo, useState } from 'react';
import { Button, message } from 'antd';
import { CopyOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import type { MenuOperation, SwaggerDoc } from '../../types/swagger';
import { copyToClipboard } from '../../utils/clipboard';
import type { OfflineDocumentSnapshot } from '../document/offlineDocumentSnapshot';
import { renderSnapshotMarkdown, useDocumentExport } from '../document/useDocumentExport';

export default function CopyOperationMarkdown({
  document,
  operation,
}: {
  document: SwaggerDoc;
  operation: MenuOperation;
}) {
  const { t } = useTranslation();
  // Pass the original menu operation so registered references and resource identity
  // follow exactly the same projection as the complete document export.
  const tags = useMemo(() => [{ tag: '', operations: [operation] }], [operation]);
  const { labels, exportIdentity, snapshotForDownload, confirmIncompleteSnapshot } = useDocumentExport(document, tags);
  const [prepared, setPrepared] = useState<{
    identity: typeof exportIdentity;
    controller: AbortController;
    snapshot?: OfflineDocumentSnapshot;
  } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void snapshotForDownload(controller.signal).then(
      (snapshot) => {
        if (!controller.signal.aborted) setPrepared({ identity: exportIdentity, controller, snapshot });
      },
      () => {
        if (!controller.signal.aborted) setPrepared({ identity: exportIdentity, controller });
      },
    );
    return () => controller.abort();
  }, [exportIdentity, snapshotForDownload]);

  const current = prepared?.identity === exportIdentity && !prepared.controller.signal.aborted ? prepared : null;
  const handleCopy = async () => {
    if (!current) return;
    const { snapshot, controller } = current;
    if (!snapshot) {
      void message.error(t('apiDoc.copy.failed'));
      return;
    }
    if (!snapshot.complete && !(await confirmIncompleteSnapshot(snapshot, controller.signal))) return;
    if (controller.signal.aborted) return;
    // Complete snapshots reach the clipboard synchronously from the click, which
    // preserves transient user activation in browsers such as Safari.
    copyToClipboard(
      renderSnapshotMarkdown(snapshot, labels, true),
      () => {
        if (!controller.signal.aborted) void message.success(t('apiDoc.copy.markdown.success'));
      },
      () => {
        if (!controller.signal.aborted) void message.error(t('apiDoc.copy.failed'));
      },
    );
  };

  return (
    <Button size="small" icon={<CopyOutlined />} loading={!current} onClick={() => void handleCopy()}>
      {t('apiDoc.copy.markdown')}
    </Button>
  );
}
