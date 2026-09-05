import type { DebugParam, OperationDebugModel, ValidationError } from 'knife4j-core';
import { paramKey, type ParamValueMap } from './debugDefaultValues';
import type { CookieParameterSource } from './cookieParameterSource';

export function isBrowserSessionParameter(parameter: DebugParam, source: CookieParameterSource): boolean {
  return source === 'browser-session' && parameter.in === 'cookie' && parameter.parameterSerialization !== undefined;
}

/** A browser-managed value is unknown, not a locally missing or schema-valid instance. */
export function filterRequiredErrorsForCookieSource(
  model: OperationDebugModel,
  errors: readonly ValidationError[],
  source: CookieParameterSource,
): ValidationError[] {
  return errors.filter(
    (error) =>
      !model.cookieParams.some(
        (parameter) =>
          isBrowserSessionParameter(parameter, source) && error.in === 'cookie' && error.name === parameter.name,
      ),
  );
}

function declaredParameters(model: OperationDebugModel): DebugParam[] {
  return [...model.pathParams, ...model.queryParams, ...model.headerParams, ...model.cookieParams];
}

/** Only OAS 3.1 parameter diagnostics participate in the existing explicit negative-test override. */
export function isOas31RequiredParameterError(model: OperationDebugModel, error: ValidationError): boolean {
  return declaredParameters(model).some(
    (parameter) =>
      parameter.parameterSerialization !== undefined && parameter.name === error.name && parameter.in === error.in,
  );
}

export function buildInitialParamEnabled(
  model: OperationDebugModel,
  values: Readonly<ParamValueMap>,
): Record<string, boolean> {
  const enabled: Record<string, boolean> = {};
  for (const parameter of declaredParameters(model)) {
    const key = paramKey(parameter);
    enabled[key] = parameter.parameterSerialization === undefined || parameter.required || (values[key] ?? '') !== '';
  }
  return enabled;
}

export function collectOas31ParameterValues(
  model: OperationDebugModel,
  values: Readonly<ParamValueMap>,
  enabled: Readonly<Record<string, boolean>>,
  cookieSource: CookieParameterSource = 'explicit',
): Record<string, string> {
  const collected: Record<string, string> = {};
  for (const parameter of declaredParameters(model)) {
    if (!parameter.parameterSerialization) continue;
    if (isBrowserSessionParameter(parameter, cookieSource)) continue;
    const key = paramKey(parameter);
    if (enabled[key] === false) continue;
    collected[key] = values[key] ?? '';
  }
  return collected;
}

export function isNullableOas31Parameter(parameter: DebugParam): boolean {
  if (!parameter.parameterSerialization || !parameter.schema || typeof parameter.schema === 'boolean') return false;
  return Array.isArray(parameter.schema.type) && parameter.schema.type.includes('null');
}
