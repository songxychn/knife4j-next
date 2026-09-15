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

  const schemaDiagnostics = result.diagnostics.filter((diagnostic) => diagnostic.schemaIssues !== undefined);
  if (schemaDiagnostics.length) {
    const issues = schemaDiagnostics.flatMap((diagnostic) => diagnostic.schemaIssues ?? []);
    return (
      <Alert
        type="warning"
        showIcon
        message={t('schema.example.invalidDocument.title')}
        description={
          <div>
            <div>{t('schema.example.invalidDocument.description')}</div>
            {issues.length > 0 && (
              <ul style={{ margin: '8px 0 0', paddingInlineStart: 20, overflowWrap: 'anywhere' }}>
                {issues.map((issue) => (
                  <li key={`${issue.documentUri}:${issue.pointer}`}>
                    <div>{issue.documentUri}</div>
                    <code>{issue.pointer}</code>
                    {issue.keyword && (
                      <div>{t('schema.example.invalidDocument.keyword', { keyword: issue.keyword })}</div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        }
        style={style}
      />
    );
  }

  if (result.diagnostics.some((diagnostic) => diagnostic.code === 'EXAMPLE_REFERENCE_UNAVAILABLE')) {
    return (
      <Alert
        type="warning"
        showIcon
        message={t('schema.example.referenceUnavailable.title')}
        description={t('schema.example.referenceUnavailable.description')}
        style={style}
      />
    );
  }

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
