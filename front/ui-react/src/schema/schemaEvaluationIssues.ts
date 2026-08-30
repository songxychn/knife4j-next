import type { EvaluationIssue } from 'knife4j-schema-engine';

export interface SchemaEvaluationIssue {
  readonly instanceLocation: string;
  readonly keyword: string;
  readonly absoluteKeywordLocation: string;
}

function keywordName(issue: EvaluationIssue): string {
  for (const value of [issue.keyword, issue.absoluteKeywordLocation]) {
    try {
      const url = new URL(value);
      const fragment = url.hash.replace(/^#\/?/, '');
      const fragmentParts = fragment.split('/').filter(Boolean);
      const fragmentName = fragmentParts[fragmentParts.length - 1];
      if (fragmentName) return decodeURIComponent(fragmentName).replace(/~1/g, '/').replace(/~0/g, '~');
      const pathParts = url.pathname.split('/').filter(Boolean);
      const pathName = pathParts[pathParts.length - 1];
      if (pathName) return decodeURIComponent(pathName);
    } catch {
      const parts = value.split(/[/#]/).filter(Boolean);
      const name = parts[parts.length - 1];
      if (name) return name;
    }
  }
  return 'schema';
}

export function collectLeafSchemaIssues(issues: readonly EvaluationIssue[]): SchemaEvaluationIssue[] {
  const collected: SchemaEvaluationIssue[] = [];
  const seen = new Set<string>();

  const visit = (issue: EvaluationIssue): void => {
    const nested = issue.errors?.filter((candidate) => candidate.valid === false) ?? [];
    if (nested.length > 0) {
      nested.forEach(visit);
      return;
    }
    if (issue.valid !== false) return;
    const keyword = keywordName(issue);
    const key = `${issue.instanceLocation}\u0000${keyword}\u0000${issue.absoluteKeywordLocation}`;
    if (seen.has(key)) return;
    seen.add(key);
    collected.push({
      instanceLocation: issue.instanceLocation,
      keyword,
      absoluteKeywordLocation: issue.absoluteKeywordLocation,
    });
  };

  issues.forEach(visit);
  return collected;
}
