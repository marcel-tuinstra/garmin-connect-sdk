import { describe, expect, it } from 'vitest';

import { SleepEndpoint } from '../../src/endpoints/SleepEndpoint.js';
import { UserEndpoint } from '../../src/endpoints/UserEndpoint.js';

interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: unknown): void;
}

class DeferredSleepHttp {
  readonly calls: string[] = [];
  active = 0;
  peak = 0;
  #pending = new Map<string, PendingRequest>();

  request(
    path: string,
    options: { query?: Record<string, string | number | boolean | undefined> } = {},
  ): Promise<unknown> {
    if (!path.includes('/dailySleepData/')) {
      throw new Error(`Unexpected request: ${path}`);
    }

    const date = String(options.query?.date);
    this.calls.push(date);
    this.active += 1;
    this.peak = Math.max(this.peak, this.active);

    return new Promise((resolve, reject) => {
      this.#pending.set(date, {
        resolve: (value) => {
          this.#pending.delete(date);
          this.active -= 1;
          resolve(value);
        },
        reject: (error) => {
          this.#pending.delete(date);
          this.active -= 1;
          reject(error);
        },
      });
    });
  }

  resolve(date: string): void {
    const pending = this.#pending.get(date);
    if (!pending) throw new Error(`No pending request for ${date}.`);
    pending.resolve({ dailySleepDTO: { calendarDate: date } });
  }

  reject(date: string, error: unknown): void {
    const pending = this.#pending.get(date);
    if (!pending) throw new Error(`No pending request for ${date}.`);
    pending.reject(error);
  }

  pendingDates(): string[] {
    return [...this.#pending.keys()];
  }
}

describe('sleep range concurrency', () => {
  it('uses exactly one daily request for a one-day range', async () => {
    // Arrange
    const { http, sleep } = deferredSleepEndpoint();

    // Act
    const rangePromise = sleep.getSleepRange('2026-09-01', '2026-09-01');
    await flushMicrotasks();

    // Assert
    expect(http.calls).toEqual(['2026-09-01']);
    expect(http.peak).toBe(1);

    http.resolve('2026-09-01');
    await expect(rangePromise).resolves.toMatchObject([
      { dailySleepDTO: { calendarDate: '2026-09-01' } },
    ]);
  });

  it('makes one request per day for a normal short range', async () => {
    // Arrange
    const { http, sleep } = deferredSleepEndpoint();

    // Act
    const rangePromise = sleep.getSleepRange('2026-09-01', '2026-09-03');
    await flushMicrotasks();

    // Assert
    expect(http.calls).toEqual(['2026-09-01', '2026-09-02', '2026-09-03']);
    expect(http.peak).toBe(3);

    for (const date of http.pendingDates()) http.resolve(date);
    await expect(rangePromise).resolves.toHaveLength(3);
  });

  it('caps long ranges at four requests and preserves chronological output', async () => {
    // Arrange
    const { http, sleep } = deferredSleepEndpoint();
    const expectedDates = datesFromOneToTen();

    // Act
    const rangePromise = sleep.getSleepRange('2026-09-01', '2026-09-10');
    await flushMicrotasks();

    // Assert initial scheduling before completing requests out of order.
    expect(http.calls).toEqual(expectedDates.slice(0, 4));
    expect(http.active).toBe(4);

    while (http.pendingDates().length > 0 || http.calls.length < expectedDates.length) {
      const date = http.pendingDates().at(-1);
      if (!date) throw new Error('Expected a pending sleep request.');
      http.resolve(date);
      await flushMicrotasks();
      expect(http.peak).toBeLessThanOrEqual(4);
    }

    const result = await rangePromise;
    expect(http.calls).toHaveLength(10);
    expect(http.peak).toBe(4);
    expect(result.map((day) => day.dailySleepDTO?.calendarDate)).toEqual(expectedDates);
  });

  it('stops dispatching unstarted days after the first failure', async () => {
    // Arrange
    const { http, sleep } = deferredSleepEndpoint();
    const sentinel = new Error('sentinel daily failure');

    // Act
    const rangeResult = sleep
      .getSleepRange('2026-09-01', '2026-09-10')
      .catch((caught: unknown) => caught);
    await flushMicrotasks();
    http.resolve('2026-09-01');
    await flushMicrotasks();
    expect(http.calls.at(-1)).toBe('2026-09-05');
    http.reject('2026-09-02', sentinel);
    await flushMicrotasks();
    const result = await rangeResult;

    // Assert
    expect(result).toBe(sentinel);
    expect(http.calls).toEqual([
      '2026-09-01',
      '2026-09-02',
      '2026-09-03',
      '2026-09-04',
      '2026-09-05',
    ]);

    for (const date of http.pendingDates()) http.resolve(date);
    await flushMicrotasks();
    expect(http.calls).toEqual([
      '2026-09-01',
      '2026-09-02',
      '2026-09-03',
      '2026-09-04',
      '2026-09-05',
    ]);
  });

  it('does not refill a slot when an in-flight request completes after failure', async () => {
    // Arrange
    const { http, sleep } = deferredSleepEndpoint();
    const sentinel = new Error('first observed failure');
    const rangeResult = sleep
      .getSleepRange('2026-09-01', '2026-09-10')
      .catch((caught: unknown) => caught);
    await flushMicrotasks();

    // Act
    http.reject('2026-09-02', sentinel);
    await flushMicrotasks();
    const result = await rangeResult;
    for (const date of http.pendingDates()) {
      http.resolve(date);
      await flushMicrotasks();
    }

    // Assert
    expect(result).toBe(sentinel);
    expect(http.calls).toEqual(['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04']);
  });

  it.each([
    ['reversed', '2026-09-02', '2026-09-01'],
    ['invalid start', '2026-02-30', '2026-03-01'],
    ['invalid end', '2026-09-01', 'not-a-date'],
  ])('rejects a %s range before dispatch', async (_label, start, end) => {
    // Arrange
    const { http, sleep } = deferredSleepEndpoint();

    // Act / Assert
    await expect(sleep.getSleepRange(start, end)).rejects.toBeInstanceOf(RangeError);
    expect(http.calls).toEqual([]);
  });

  it('rejects an invalid Date before dispatch', async () => {
    // Arrange
    const { http, sleep } = deferredSleepEndpoint();

    // Act / Assert
    await expect(sleep.getSleepRange(new Date('not-a-date'), '2026-09-01')).rejects.toBeInstanceOf(
      RangeError,
    );
    expect(http.calls).toEqual([]);
  });

  it('loads an uncached profile once before dispatching daily requests', async () => {
    // Arrange
    const http = new ImmediateSleepHttp();
    const user = new UserEndpoint(http as never);
    const sleep = new SleepEndpoint(http as never, user);

    // Act
    const result = await sleep.getSleepRange('2026-09-01', '2026-09-03');

    // Assert
    expect(result).toHaveLength(3);
    expect(http.profileCalls).toBe(1);
    expect(http.dailyCalls).toBe(3);
  });
});

class ImmediateSleepHttp {
  profileCalls = 0;
  dailyCalls = 0;

  async request(
    path: string,
    options: { query?: Record<string, string | number | boolean | undefined> } = {},
  ): Promise<unknown> {
    if (path === '/userprofile-service/socialProfile') {
      this.profileCalls += 1;
      return { displayName: 'runner' };
    }
    if (path.includes('/dailySleepData/')) {
      this.dailyCalls += 1;
      return { dailySleepDTO: { calendarDate: String(options.query?.date) } };
    }
    throw new Error(`Unexpected request: ${path}`);
  }
}

function deferredSleepEndpoint(): { http: DeferredSleepHttp; sleep: SleepEndpoint } {
  const http = new DeferredSleepHttp();
  const user = new UserEndpoint(http as never);
  user.setCachedProfile({ displayName: 'runner' });
  return { http, sleep: new SleepEndpoint(http as never, user) };
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

function datesFromOneToTen(): string[] {
  return Array.from({ length: 10 }, (_, index) => `2026-09-${String(index + 1).padStart(2, '0')}`);
}
