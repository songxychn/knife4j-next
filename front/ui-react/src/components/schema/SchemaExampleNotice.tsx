import { Alert } from 'antd';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import type { SchemaExampleResult } from '../../schema/schemaExampleGeneration';

export interface SchemaExampleNoticeProps {
  readonly result: SchemaExampleResult;
  readonly style?: CSSProperties;
}

function instanceLabel(location: string | undefined): string {
  if (!location) return '$';
  return location.startsWith('/') ? `$${location}` : location.startsWith('#/') ? `$${location.slice(1)}` : location;
}

export default function SchemaExampleNotice({ result, style }: SchemaExampleNoticeProps) {
  const { t } = useTranslation();
  if (result.status === 'value' && result.validation === 'valid') return null;

  if (result.status === 'value' && result.validation === 'invalid') {
    const issue = result.diagnostics.flatMap((diagnostic) => diagnostic.issues ?? [])[0];
    return (
      <Alert
        type="warning"
        showIcon
        message={t('schema.example.explicitInvalid.title')}
        description={
          issue
            ? t('schema.example.explicitInvalid.issue', {
                path: instanceLabel(issue.instanceLocation),
                keyword: issue.keyword,
              })
            : t('schema.example.explicitInvalid.description')
        }
        style={style}
      />
    );
  }

  if (result.status === 'value') {
    const message = result.diagnostics.find((diagnostic) => diagnostic.message)?.message;
    return (
      <Alert
        type="warning"
        showIcon
        message={t('schema.example.validationUnavailable.title')}
        description={message ?? t('schema.example.validationUnavailable.description')}
        style={style}
      />
    );
  }

  const budgetExceeded = result.reason === 'search-budget-exceeded';
  const unavailable = result.reason === 'schema-unavailable' || result.reason === 'evaluation-unavailable';
  const message = result.diagnostics.find((diagnostic) => diagnostic.message)?.message;
  return (
    <Alert
      type={unavailable ? 'warning' : 'info'}
      showIcon
      message={
        unavailable
          ? t('schema.example.validationUnavailable.title')
          : budgetExceeded
            ? t('schema.example.none.budgetTitle')
            : t('schema.example.none.title')
      }
      description={
        message ??
        (unavailable
          ? t('schema.example.validationUnavailable.description')
          : budgetExceeded
            ? t('schema.example.none.budgetDescription')
            : t('schema.example.none.description'))
      }
      style={style}
    />
  );
}
