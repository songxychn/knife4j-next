import {
  findOas32PathTemplateConflicts,
  parseOas32UrlTemplate,
  substituteOas32ServerVariables,
  validateOas32PathBindings,
} from '../openapi32/urlTemplates';

const location = { ownerRetrievalUri: 'https://docs.test/api.json', pointer: '#/paths/~1pets~1{id}' };
const serverLocation = { ...location, pointer: '#/servers/0/url' };
const variablesLocation = { ...location, pointer: '#/servers/0/variables' };
const parseServer = (value: string) => parseOas32UrlTemplate(value, 'server', serverLocation);
const parsePath = (value: string) => parseOas32UrlTemplate(value, 'path', location);
const substitute = (value: string, variables: unknown, values?: Record<string, unknown>) =>
  substituteOas32ServerVariables({ template: parseServer(value), variables, variablesLocation, values });

describe('OAS 3.2 template ABNF (normative 4.6 and 4.8.2)', () => {
  test.each(['a?b#c', 'name/with/slashes', '%not-an-encoding', ' space ', '\u0000\n', '中文🧭', '|', ':', '\\'])(
    'keeps the complete legal variable name %j without applying literal rules',
    (name) => {
      for (const parsed of [parseServer(`https://host/{${name}}`), parsePath(`/pets/{${name}}`)]) {
        expect(parsed.valid).toBe(true);
        expect(parsed.variables.map((token) => token.value)).toEqual([name]);
      }
    },
  );

  test.each([
    'https://host/v1',
    'https://例子.test/中文🧭',
    '/\uE000',
    '/\u{F0000}',
    '/\u{10FFFD}',
    '/%3F%23%2F',
    '{base}',
  ])('accepts the server literal grammar for %s', (value) => expect(parseServer(value).valid).toBe(true));

  test.each(['/', '/pets/{id}', '/%E4%B8%AD%E6%96%87/{中文}', "/a!$&'()*+,;=:@-._~/%23"])(
    'accepts the path grammar for %s',
    (value) => expect(parsePath(value).valid).toBe(true),
  );

  test.each([
    '',
    '/a b',
    '/\u0000',
    '/\u007F',
    '/\u0080',
    '/\uD800',
    '/\uFDD0',
    '/\uFFFF',
    '/\u{1FFFF}',
    '/\u{E0000}',
    '/\u{10FFFF}',
    '/%',
    '/%0',
    '/%xy',
    '/<x>',
    '/a\\b',
    '/a|b',
    '/a^b',
    '/`',
  ])('rejects illegal server literal %j without changing it', (value) => {
    const parsed = parseServer(value);
    expect(parsed.valid).toBe(false);
    expect(parsed.source).toBe(value);
    expect(parsed.diagnostics[0]).toMatchObject({
      ownerRetrievalUri: location.ownerRetrievalUri,
      pointer: serverLocation.pointer,
      value,
    });
  });

  test.each(['/中文', '/\uE000', '/[id]', '//', '/a//b', 'pets/{id}'])(
    'rejects illegal path literal/structure %j',
    (value) => expect(parsePath(value).valid).toBe(false),
  );

  test.each(['/pets?', '/pets#', '/pets?query=1', '/pets#frag', '/{a?b#c}?'])(
    'rejects literal query/fragment %s but not delimiters inside names',
    (value) => {
      expect(parseServer(value).diagnostics).toContainEqual(
        expect.objectContaining({ code: 'template-query-or-fragment' }),
      );
      expect(parsePath(value).diagnostics).toContainEqual(
        expect.objectContaining({ code: 'template-query-or-fragment' }),
      );
    },
  );

  test.each(['/{}', '/{a', '/a}', '/{a{b}}'])('rejects malformed expression %s', (value) => {
    expect(parseServer(value).valid).toBe(false);
    expect(parsePath(value).valid).toBe(false);
  });

  test('diagnoses duplicate names exactly and preserves encoded names and offsets', () => {
    for (const kind of ['server', 'path'] as const) {
      const parsed = parseOas32UrlTemplate('/{id}/{id}', kind, location);
      expect(parsed.diagnostics).toContainEqual(
        expect.objectContaining({ code: 'duplicate-template-variable', offset: 6, variable: 'id' }),
      );
      expect(parseOas32UrlTemplate('/{%2F}/{/}', kind, location).valid).toBe(true);
    }
  });

  test('finds only identical templated hierarchies, never changes or selects a conflicting path', () => {
    const templates = ['/pets/{id}', '/pets/{name}', '/pets/mine', '/{entity}/me', '/books/{id}', '/pets/%7Bid%7D'].map(
      (value, index) => parseOas32UrlTemplate(value, 'path', { ...location, pointer: `#/paths/${index}` }),
    );
    const diagnostics = findOas32PathTemplateConflicts(templates);
    expect(diagnostics).toEqual([
      expect.objectContaining({ code: 'identical-templated-path', pointer: '#/paths/1', relatedPointer: '#/paths/0' }),
    ]);
  });
});

describe('Server variable substitution before URI resolution', () => {
  test('uses defaults or explicit enum input, preserving raw variable names and definitions', () => {
    const variables = Object.freeze({
      'a?b#c': Object.freeze({ default: 'v1', enum: ['v1', 'v2'] }),
      unused: Object.freeze({ default: '' }),
    });
    const result = substitute('https://host/{a?b#c}', variables, { 'a?b#c': 'v2' });
    expect(result.valid).toBe(true);
    expect(result.value).toBe('https://host/v2');
    expect(result.variables[0]).toMatchObject({ name: 'a?b#c', value: 'v2', valueSource: 'user', used: true });
    expect(result.variables[0].definition).toBe(variables['a?b#c']);
    expect(result.variables[1]).toMatchObject({ used: false, value: '', valueSource: 'default' });
    expect(substitute('{base}', { base: { default: 'https://host/v1' } }).value).toBe('https://host/v1');
    expect(substitute('/{base}', { base: { default: '' } }).value).toBe('/');
  });

  test.each([
    [{}, 'undefined-server-variable'],
    [{ id: {} }, 'invalid-server-variable-default'],
    [{ id: { default: 0 } }, 'invalid-server-variable-default'],
    [{ id: { default: 'a', enum: [] } }, 'invalid-server-variable-enum'],
    [{ id: { default: 'a', enum: ['b'] } }, 'server-default-outside-enum'],
    [{ id: { default: 'a', enum: ['a', 1] } }, 'invalid-server-variable-enum'],
  ])('rejects invalid variable declarations %j', (variables, code) => {
    const result = substitute('/{id}', variables);
    expect(result.valid).toBe(false);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code }));
    expect(result.value).toBeUndefined();
  });

  test('does not repair absent defaults with user input or accept invalid/out-of-enum input', () => {
    expect(substitute('/{id}', { id: {} }, { id: 'value' }).valid).toBe(false);
    expect(substitute('/{id}', { id: { default: 'a', enum: ['a'] } }, { id: 'b' }).diagnostics).toContainEqual(
      expect.objectContaining({ code: 'server-value-outside-enum' }),
    );
    expect(substitute('/{id}', { id: { default: '' } }, { id: 1 }).valid).toBe(false);
    expect(substitute('/{id}', { id: { default: '' } }, { typo: 'a' }).diagnostics).toContainEqual(
      expect.objectContaining({ code: 'unknown-server-variable-input' }),
    );
  });

  test.each(['a?x=1', 'a#f', 'a b', 'a\\b', '{another}', '%bad%'])(
    'keeps an invalid substituted value %j while making it unavailable for resolution',
    (value) => {
      const result = substitute('/{id}', { id: { default: value } });
      expect(result.valid).toBe(false);
      expect(result.value).toBe(`/${value}`);
      expect(result.diagnostics.length).toBeGreaterThan(0);
    },
  );

  test('looks up own keys only, including __proto__ and prototype names', () => {
    expect(substitute('/{toString}', {}).valid).toBe(false);
    const variables = JSON.parse('{"__proto__":{"default":"safe"}}') as unknown;
    expect(substitute('/{__proto__}', variables).value).toBe('/safe');
    expect(
      substitute('/{__proto__}', variables, JSON.parse('{"__proto__":"chosen"}') as Record<string, unknown>).value,
    ).toBe('/chosen');
  });
});

describe('only mounted Paths templates bind against effective resolved parameters', () => {
  const param = (name: string, extra: Record<string, unknown> = {}) => ({
    name,
    in: 'path',
    required: true,
    location: { ...location, pointer: '#/components/parameters/id' },
    ...extra,
  });
  const validate = (extra: Partial<Parameters<typeof validateOas32PathBindings>[0]> = {}) =>
    validateOas32PathBindings({
      source: 'path',
      path: '/pets/{a?b#c}',
      location,
      parameters: [param('a?b#c')],
      parametersComplete: true,
      ...extra,
    });

  test('matches the exact effective parameter name and preserves its external location', () => {
    expect(validate().status).toBe('valid');
    const result = validate({ parameters: [param('different')] });
    expect(result.status).toBe('invalid');
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'missing-path-parameter', variable: 'a?b#c', pointer: location.pointer }),
    );
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'unmatched-path-parameter',
        variable: 'different',
        pointer: '#/components/parameters/id/name',
      }),
    );
  });

  test('does not report missing parameters while an external dependency is unresolved', () => {
    const result = validate({ parameters: [], parametersComplete: false });
    expect(result.status).toBe('unavailable');
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ code: 'path-parameters-unresolved', category: 'unavailable' }),
    ]);
  });

  test('applies the empty Path Item exception and ignores callback/webhook/component/link names', () => {
    expect(validate({ parameters: [], emptyPathItem: true }).status).toBe('valid');
    for (const source of ['callback', 'webhook', 'component', 'link'] as const) {
      expect(validate({ source, path: '{$request.body#/url}', parameters: [] })).toEqual({
        status: 'not-applicable',
        diagnostics: [],
      });
    }
  });

  test('does not treat a query parameter or non-required path parameter as a valid binding', () => {
    expect(validate({ parameters: [param('a?b#c', { in: 'query' })] }).status).toBe('invalid');
    expect(validate({ parameters: [param('a?b#c', { required: false })] }).diagnostics).toContainEqual(
      expect.objectContaining({ code: 'path-parameter-not-required' }),
    );
  });
});
