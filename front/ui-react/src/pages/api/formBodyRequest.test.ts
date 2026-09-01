import { describe, expect, test } from 'vitest';
import type { FormBodyEncodingPlan } from 'knife4j-core';
import { materializeMultipartBody } from './formBodyRequest';

function file(parts: BlobPart[], name: string, type: string): File {
  return new File(parts, name, { type });
}

describe('multipart request materialization', () => {
  test('uses native FormData when every part is exactly representable', () => {
    const avatar = file(['png'], 'avatar.png', 'image/png');
    const plan: Extract<FormBodyEncodingPlan, { kind: 'multipart' }> = {
      kind: 'multipart',
      mediaType: 'multipart/form-data',
      instance: { title: 'hello' },
      ignoredProperties: ['avatar'],
      diagnostics: [],
      parts: [
        {
          kind: 'text',
          sourceField: 'title',
          name: 'title',
          value: 'hello',
          contentType: 'text/plain',
          headers: {},
        },
        {
          kind: 'file',
          sourceField: 'avatar',
          name: 'avatar',
          fileIndex: 0,
          fileName: avatar.name,
          contentType: avatar.type,
          headers: {},
        },
      ],
    };

    const materialized = materializeMultipartBody(plan, { avatar: [avatar] });
    expect(materialized.mode).toBe('form-data');
    expect(materialized.contentType).toBeUndefined();
    const entries = Array.from((materialized.body as FormData).entries());
    expect(entries.map(([name]) => name)).toEqual(['title', 'avatar']);
    expect(entries[0][1]).toBe('hello');
    expect(entries[1][1]).toBeInstanceOf(Blob);
    expect((entries[1][1] as File).name).toBe('avatar.png');
  });

  test('uses one ordered MIME envelope for JSON parts and Encoding headers', async () => {
    const avatar = file(['png'], 'avatar.png', 'image/png');
    const plan: Extract<FormBodyEncodingPlan, { kind: 'multipart' }> = {
      kind: 'multipart',
      mediaType: 'multipart/form-data',
      instance: { metadata: { active: true } },
      ignoredProperties: ['avatar'],
      diagnostics: [],
      parts: [
        {
          kind: 'text',
          sourceField: 'metadata',
          name: 'metadata',
          value: '{"active":true}',
          contentType: 'application/json',
          headers: { 'X-Part-Trace': 'trace-1' },
        },
        {
          kind: 'file',
          sourceField: 'avatar',
          name: 'avatar',
          fileIndex: 0,
          fileName: avatar.name,
          contentType: avatar.type,
          headers: {},
        },
      ],
    };

    const materialized = materializeMultipartBody(plan, { avatar: [avatar] }, { boundaryFactory: () => 'fixed' });
    expect(materialized).toMatchObject({ mode: 'encoded', contentType: 'multipart/form-data; boundary=fixed' });
    await expect((materialized.body as Blob).text()).resolves.toBe(
      '--fixed\r\n' +
        'Content-Disposition: form-data; name="metadata"\r\n' +
        'Content-Type: application/json\r\n' +
        'X-Part-Trace: trace-1\r\n' +
        '\r\n' +
        '{"active":true}\r\n' +
        '--fixed\r\n' +
        'Content-Disposition: form-data; name="avatar"; filename="avatar.png"\r\n' +
        'Content-Type: image/png\r\n' +
        '\r\n' +
        'png\r\n' +
        '--fixed--\r\n',
    );
  });

  test('uses the MIME envelope when native FormData would drop explicit media type parameters', async () => {
    const textPlan: Extract<FormBodyEncodingPlan, { kind: 'multipart' }> = {
      kind: 'multipart',
      mediaType: 'multipart/form-data',
      instance: { note: 'hello' },
      ignoredProperties: [],
      diagnostics: [],
      parts: [
        {
          kind: 'text',
          sourceField: 'note',
          name: 'note',
          value: 'hello',
          contentType: 'text/plain; charset=utf-8',
          headers: {},
        },
      ],
    };
    const textBody = materializeMultipartBody(textPlan, {}, { boundaryFactory: () => 'text-boundary' });
    expect(textBody.mode).toBe('encoded');
    await expect((textBody.body as Blob).text()).resolves.toContain('Content-Type: text/plain; charset=utf-8');

    const avatar = file(['png'], 'avatar.png', 'image/png');
    const filePlan: Extract<FormBodyEncodingPlan, { kind: 'multipart' }> = {
      ...textPlan,
      instance: {},
      ignoredProperties: ['avatar'],
      parts: [
        {
          kind: 'file',
          sourceField: 'avatar',
          name: 'avatar',
          fileIndex: 0,
          fileName: avatar.name,
          contentType: 'image/png; profile=thumbnail',
          headers: {},
        },
      ],
    };
    const fileBody = materializeMultipartBody(filePlan, { avatar: [avatar] }, { boundaryFactory: () => 'file' });
    expect(fileBody.mode).toBe('encoded');
    await expect((fileBody.body as Blob).text()).resolves.toContain('Content-Type: image/png; profile=thumbnail');

    const topLevelBody = materializeMultipartBody(
      {
        ...textPlan,
        mediaType: 'multipart/form-data; profile="upload;a"; boundary=authored',
        parts: [],
      },
      {},
      { boundaryFactory: () => 'top' },
    );
    expect(topLevelBody).toMatchObject({
      mode: 'encoded',
      contentType: 'multipart/form-data; profile="upload;a"; boundary=top',
    });
  });

  test('rejects unsafe MIME framing and stale file snapshots before fetch', () => {
    const unsafePlan: Extract<FormBodyEncodingPlan, { kind: 'multipart' }> = {
      kind: 'multipart',
      mediaType: 'multipart/form-data',
      instance: { value: 'safe' },
      ignoredProperties: [],
      diagnostics: [],
      parts: [
        {
          kind: 'text',
          sourceField: 'value',
          name: 'value',
          value: 'safe',
          contentType: 'text/plain',
          headers: { 'X-Part': 'safe\r\nInjected: true' },
        },
      ],
    };
    expect(() => materializeMultipartBody(unsafePlan, {}, { boundaryFactory: () => 'fixed' })).toThrow(
      'unsafe framing characters',
    );

    const avatar = file(['png'], 'avatar.png', 'image/png');
    const stalePlan: Extract<FormBodyEncodingPlan, { kind: 'multipart' }> = {
      ...unsafePlan,
      instance: {},
      ignoredProperties: ['avatar'],
      parts: [
        {
          kind: 'file',
          sourceField: 'avatar',
          name: 'avatar',
          fileIndex: 0,
          fileName: avatar.name,
          contentType: avatar.type,
          headers: {},
        },
      ],
    };
    expect(() => materializeMultipartBody(stalePlan, {})).toThrow('file snapshot is unavailable');
  });
});
