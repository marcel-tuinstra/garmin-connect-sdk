import { describe, expect, it } from 'vitest';

import { noopLogger, redact, summarizePayload } from '../../src/utils/logger.js';

describe('logger utilities', () => {
  it('redacts nested credentials and tokens without removing safe context', () => {
    // Arrange
    const payload = {
      endpoint: '/x',
      password: 'secret',
      nested: {
        access_token: 'access',
        keep: 'value',
      },
      rows: [{ refreshToken: 'refresh' }, { metric: 42 }],
    };

    // Act
    const redacted = redact(payload);

    // Assert
    expect(redacted).toEqual({
      endpoint: '/x',
      password: '[REDACTED]',
      nested: {
        access_token: '[REDACTED]',
        keep: 'value',
      },
      rows: [{ refreshToken: '[REDACTED]' }, { metric: 42 }],
    });
  });

  it('summarizes payload shape instead of returning raw payloads', () => {
    // Arrange
    const arrayPayload = [{ id: 1 }, { id: 2 }];
    const objectPayload = { a: 1, b: 2 };

    // Act
    const arraySummary = summarizePayload(arrayPayload);
    const objectSummary = summarizePayload(objectPayload);
    const primitiveSummary = summarizePayload('ok');

    // Assert
    expect(arraySummary).toEqual({ type: 'array', length: 2 });
    expect(objectSummary).toEqual({ type: 'object', keys: ['a', 'b'] });
    expect(primitiveSummary).toEqual({ type: 'string' });
  });

  it('provides no-op logger methods for callers that do not configure logging', () => {
    // Act
    const debug = () => noopLogger.debug('debug');
    const info = () => noopLogger.info('info');
    const warn = () => noopLogger.warn('warn');
    const error = () => noopLogger.error('error');

    // Assert
    expect(debug).not.toThrow();
    expect(info).not.toThrow();
    expect(warn).not.toThrow();
    expect(error).not.toThrow();
  });
});
