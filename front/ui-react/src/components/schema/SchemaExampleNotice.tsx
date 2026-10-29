import { Alert } from 'antd';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import type { SchemaExampleResult, SchemaExampleSearchLimits } from '../../schema/schemaExampleGeneration';

const budgetLabels: Record<keyof SchemaExampleSearchLimits, string> = {
  maxCandidates: 'schema.example.budget.maxCandidates',
  maxDepth: 'schema.example.budget.maxDepth',
  maxNodes: 'schema.example.budget.maxNodes',
  maxReferences: 'schema.example.budget.maxReferences',
  maxEvaluations: 'schema.example.budget.maxEvaluations',
  maxStringLength: 'schema.example.budget.maxStringLength',
  maxArrayLength: 'schema.example.budget.maxArrayLength',
  maxReferenceTargets: 'schema.example.budget.maxReferenceTargets',
  maxInstanceDepth: 'schema.example.budget.maxInstanceDepth',
  maxSearchChoices: 'schema.example.budget.maxSearchChoices',
  maxOutputNodes: 'schema.example.budget.maxOutputNodes',
  maxOutputBytes: 'schema.example.budget.maxOutputBytes',
  maxConstructedNodes: 'schema.example.budget.maxConstructedNodes',
  maxDurationMs: 'schema.example.budget.maxDurationMs',
};

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

  const regexDiagnostics = result.diagnostics.filter((diagnostic) => diagnostic.regexIssues !== undefined);
  if (regexDiagnostics.length) {
    const issues = regexDiagnostics.flatMap((diagnostic) => diagnostic.regexIssues ?? []);
    return (
      <Alert
        type="warning"
        showIcon
        title={t('schema.example.patternUnavailable.title')}
        description={
          <div>
            <div>{t('schema.example.patternUnavailable.description')}</div>
            {issues.map((issue) => (
              <div key={`${issue.documentUri}:${issue.pointer}`} style={{ marginTop: 8, overflowWrap: 'anywhere' }}>
                <div>{t('schema.example.patternUnavailable.field')}</div>
                <code>{issue.pointer}</code>
                <div>{t('schema.example.patternUnavailable.pattern')}</div>
                <code style={{ whiteSpace: 'pre-wrap' }}>{issue.pattern}</code>
                <details style={{ marginTop: 8 }}>
                  <summary>{t('schema.example.patternUnavailable.location')}</summary>
                  <div>{issue.documentUri}</div>
                  <code>{issue.pointer}</code>
                </details>
              </div>
            ))}
            <div style={{ marginTop: 8 }}>{t('schema.example.patternUnavailable.preserved')}</div>
          </div>
        }
        style={style}
      />
    );
  }

  const schemaDiagnostics = result.diagnostics.filter((diagnostic) => diagnostic.schemaIssues !== undefined);
  if (schemaDiagnostics.length) {
    const issues = schemaDiagnostics.flatMap((diagnostic) => diagnostic.schemaIssues ?? []);
    return (
      <Alert
        type="warning"
        showIcon
        title={t('schema.example.invalidDocument.title')}
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
        title={t('schema.example.referenceUnavailable.title')}
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
        title={t('schema.example.explicitInvalid.title')}
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
        title={t('schema.example.validationUnavailable.title')}
        description={message ?? t('schema.example.validationUnavailable.description')}
        style={style}
      />
    );
  }

  const budgetExceeded = result.reason === 'search-budget-exceeded';
  const budget = result.diagnostics.find((diagnostic) => diagnostic.budget !== undefined);
  const budgetDetail =
    budget?.budget !== undefined && budget.limit !== undefined && budget.actual !== undefined
      ? t('schema.example.none.budgetDetail', {
          kind: t(budgetLabels[budget.budget]),
          limit: budget.limit,
          actual: Math.ceil(budget.actual),
          path: instanceLabel(budget.path),
        })
      : undefined;
  const unavailable = result.reason === 'schema-unavailable' || result.reason === 'evaluation-unavailable';
  const message = result.diagnostics.find((diagnostic) => diagnostic.message)?.message;
  return (
    <Alert
      type={unavailable ? 'warning' : 'info'}
      showIcon
      title={
        unavailable
          ? t('schema.example.validationUnavailable.title')
          : budgetExceeded
            ? t('schema.example.none.budgetTitle')
            : t('schema.example.none.title')
      }
      description={
        budgetDetail ??
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
