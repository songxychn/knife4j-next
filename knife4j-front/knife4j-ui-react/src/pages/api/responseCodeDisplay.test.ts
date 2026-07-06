import { describe, expect, it } from 'vitest';

import { responseExamplesForDisplay, responseRowsForDisplay } from './responseCodeDisplay';

const rows = [
  { key: '400', statusCode: '400', description: 'Bad request' },
  { key: '200', statusCode: '200', description: 'OK' },
  { key: '500', statusCode: '500', description: 'Server error' },
];

describe('response code display', () => {
  it('keeps all status-code groups when enabled', () => {
    expect(responseRowsForDisplay(rows, true).map((row) => row.statusCode)).toEqual(['400', '200', '500']);
  });

  it('uses the success response by default', () => {
    expect(responseRowsForDisplay(rows, false).map((row) => row.statusCode)).toEqual(['200']);
  });

  it('uses default then first response when no success response exists', () => {
    expect(
      responseRowsForDisplay(
        [
          { key: '400', statusCode: '400', description: 'Bad request' },
          { key: 'default', statusCode: 'default', description: 'Default' },
        ],
        false,
      ).map((row) => row.statusCode),
    ).toEqual(['default']);

    expect(responseRowsForDisplay([{ key: '400', statusCode: '400', description: 'Bad request' }], false)).toEqual([
      { key: '400', statusCode: '400', description: 'Bad request' },
    ]);
  });

  it('uses the same status-code preference for examples', () => {
    expect(
      responseExamplesForDisplay(
        [
          { statusCode: '400', example: '{}' },
          { statusCode: '201', example: '{"id":1}' },
        ],
        false,
      ),
    ).toEqual([{ statusCode: '201', example: '{"id":1}' }]);
  });
});
