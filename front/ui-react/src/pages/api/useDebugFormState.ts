import { useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import type { Oas32ParameterEntries } from '../../schema/oas32ParameterAdapter';
import type { InitialDebugState } from './debugFormState';

export interface DebugFormState extends InitialDebugState {
  oas32ParameterEntries: Oas32ParameterEntries;
  serializedBodyMedia32: string | undefined;
}

/** Form replacements are atomic; request/response lifecycles stay outside this hook. */
export function useDebugFormState(baseUrl: string) {
  const [form, setForm] = useState<DebugFormState>(() => ({
    baseUrl,
    method: 'GET',
    path: '/',
    cookieParameterSource: 'explicit',
    paramValues: {},
    paramEnabled: {},
    body: '',
    selectedContentType: '',
    formFields: {},
    formPartHeaders: {},
    formPartContentTypes: {},
    rawMode: 'text',
    customQueryParams: [],
    customBodyParams: [],
    customHeaders: [],
    customCookies: [],
    oas32ParameterEntries: {},
    serializedBodyMedia32: undefined,
  }));

  const actions = useMemo(() => {
    function fieldSetter<K extends keyof DebugFormState>(key: K): Dispatch<SetStateAction<DebugFormState[K]>> {
      return (update) => {
        setForm((current) => {
          const value = typeof update === 'function' ? update(current[key]) : update;
          return Object.is(value, current[key]) ? current : { ...current, [key]: value };
        });
      };
    }

    return {
      setBaseUrl: fieldSetter('baseUrl'),
      setMethod: fieldSetter('method'),
      setPath: fieldSetter('path'),
      setCookieParameterSource: fieldSetter('cookieParameterSource'),
      setParamValues: fieldSetter('paramValues'),
      setParamEnabled: fieldSetter('paramEnabled'),
      setBody: fieldSetter('body'),
      setSelectedContentType: fieldSetter('selectedContentType'),
      setFormFields: fieldSetter('formFields'),
      setFormPartHeaders: fieldSetter('formPartHeaders'),
      setFormPartContentTypes: fieldSetter('formPartContentTypes'),
      setRawMode: fieldSetter('rawMode'),
      setCustomQueryParams: fieldSetter('customQueryParams'),
      setCustomBodyParams: fieldSetter('customBodyParams'),
      setCustomHeaders: fieldSetter('customHeaders'),
      setCustomCookies: fieldSetter('customCookies'),
      setOas32ParameterEntries: fieldSetter('oas32ParameterEntries'),
      setSerializedBodyMedia32: fieldSetter('serializedBodyMedia32'),
      replaceForm: (
        initial: InitialDebugState,
        oas32ParameterEntries: Oas32ParameterEntries = {},
        serializedBodyMedia32?: string,
      ) => setForm({ ...initial, oas32ParameterEntries, serializedBodyMedia32 }),
    };
  }, []);

  return { form, actions };
}
