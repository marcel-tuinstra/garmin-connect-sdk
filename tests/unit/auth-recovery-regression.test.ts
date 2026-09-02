import { describe, expect, it, vi } from 'vitest';

import { AuthService } from '../../src/auth/AuthService.js';
import { MemoryTokenStorage } from '../../src/auth/MemoryTokenStorage.js';
import { HttpClient } from '../../src/client/HttpClient.js';
import {
  GarminBotChallengeError,
  GarminRateLimitError,
  GarminRequestError,
  GarminSessionExpiredError,
} from '../../src/client/GarminRequestError.js';
import { jsonResponse, tokenResponse, tokens } from '../helpers/garmin.js';

it('does not invalidate a newer refresh credential sharing the same access token', async () => {
  const storage = new MemoryTokenStorage();
  const original = tokens({ accessToken: 'shared-access', refreshToken: 'old-refresh' });
  await storage.save(original);
  const auth = new AuthService({ storage, fetch: vi.fn<typeof fetch>() });
  await auth.restoreSession();
  const generation = auth.sessionGeneration;
  await storage.save({ ...original, refreshToken: 'new-refresh' });
  await auth.restoreSession();

  await auth.invalidateSession(original, generation);

  expect(auth.tokens?.refreshToken).toBe('new-refresh');
  expect((await storage.load())?.refreshToken).toBe('new-refresh');
});

describe('controlled authenticated session recovery', () => {
  it('captures the refresh credential, clears state, refreshes once, and replays a read', async () => {
    const storage = new MemoryTokenStorage();
    const original = tokens({ accessToken: 'old-access', refreshToken: 'old-refresh' });
    await storage.save(original);
    let stateAtRefresh: { storage: unknown; memory: unknown } | undefined;
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes('/di-oauth2-service/oauth/token')) {
        stateAtRefresh = { storage: await storage.load(), memory: auth.tokens };
        expect((init?.body as URLSearchParams).get('refresh_token')).toBe('old-refresh');
        return tokenResponse('new-refresh');
      }
      if (new Headers(init?.headers).get('authorization') === 'Bearer old-access') {
        return jsonErrorResponse({ error: 'invalid_token' }, 401);
      }
      return jsonResponse({ ok: true });
    });
    const auth = new AuthService({ fetch: fetchMock, storage, retry: { maxRetries: 0 } });
    const http = new HttpClient({
      auth,
      fetch: fetchMock,
      retry: { maxRetries: 4, sleep: async () => undefined },
    });

    await expect(http.request('/read')).resolves.toEqual({ ok: true });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(stateAtRefresh).toEqual({ storage: null, memory: null });
    expect((await storage.load())?.refreshToken).toBe('new-refresh');
    expect(new Headers(fetchMock.mock.calls[2]?.[1]?.headers).get('authorization')).toBe(
      'Bearer ' + (await storage.load())?.accessToken,
    );
  });

  it('replays an authenticated HEAD read after one controlled recovery', async () => {
    const storage = new MemoryTokenStorage();
    await storage.save(tokens({ accessToken: 'old-access', refreshToken: 'old-refresh' }));
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonErrorResponse({ error: 'invalid_token' }, 401))
      .mockResolvedValueOnce(tokenResponse('new-refresh'))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const auth = new AuthService({ fetch: fetchMock, storage, retry: { maxRetries: 0 } });
    const http = new HttpClient({
      auth,
      fetch: fetchMock,
      retry: { maxRetries: 3, sleep: async () => undefined },
    });

    await expect(http.request('/head', { method: 'HEAD' })).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('HEAD');
    expect(fetchMock.mock.calls[2]?.[1]?.method).toBe('HEAD');
  });

  it('returns the precise refresh error when recovery fails without broad retries', async () => {
    const storage = new MemoryTokenStorage();
    await storage.save(tokens({ accessToken: 'old-access', refreshToken: 'old-refresh' }));
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonErrorResponse({ error: 'invalid_token' }, 401))
      .mockResolvedValueOnce(jsonErrorResponse({ error: 'service_unavailable' }, 503));
    const auth = new AuthService({ fetch: fetchMock, storage, retry: { maxRetries: 0 } });
    const http = new HttpClient({
      auth,
      fetch: fetchMock,
      retry: { maxRetries: 5, sleep: async () => undefined },
    });

    const error = await http.request('/read').catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(GarminRequestError);
    expect((error as GarminRequestError).statusCode).toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const candidate = await storage.load();
    expect(candidate?.refreshToken).toBe('old-refresh');
    expect(candidate && Date.parse(candidate.accessTokenExpiresAt)).toBe(0);

    fetchMock.mockResolvedValueOnce(tokenResponse('recovered-refresh'));
    await expect(auth.restoreSession()).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[2]?.[0])).toContain('/di-oauth2-service/oauth/token');
    expect((await storage.load())?.refreshToken).toBe('recovered-refresh');
  });

  it('single-flights recovery when concurrent reads reject the same access token', async () => {
    const storage = new MemoryTokenStorage();
    await storage.save(tokens({ accessToken: 'old-access', refreshToken: 'old-refresh' }));
    let releaseInitial: () => void = () => undefined;
    const initialResponsesReady = new Promise<void>((resolve) => {
      releaseInitial = resolve;
    });
    let apiCalls = 0;
    let refreshCalls = 0;
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/di-oauth2-service/oauth/token')) {
        refreshCalls += 1;
        return tokenResponse('new-refresh');
      }
      apiCalls += 1;
      if (apiCalls <= 2) {
        await initialResponsesReady;
        return jsonErrorResponse({ error: 'invalid_token' }, 401);
      }
      return jsonResponse({ ok: true });
    });
    const auth = new AuthService({ fetch: fetchMock, storage, retry: { maxRetries: 0 } });
    const http = new HttpClient({
      auth,
      fetch: fetchMock,
      retry: { maxRetries: 0 },
    });

    const first = http.request('/first');
    const second = http.request('/second');
    await waitFor(() => apiCalls === 2);
    releaseInitial();
    await expect(Promise.all([first, second])).resolves.toEqual([{ ok: true }, { ok: true }]);

    expect(refreshCalls).toBe(1);
    expect(apiCalls).toBe(4);
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it('never recovers or replays a write after definitive token rejection', async () => {
    const storage = new MemoryTokenStorage();
    await storage.save(tokens({ accessToken: 'old-access', refreshToken: 'old-refresh' }));
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonErrorResponse({ error: 'invalid_token' }, 401));
    const auth = new AuthService({ fetch: fetchMock, storage, retry: { maxRetries: 0 } });
    const http = new HttpClient({
      auth,
      fetch: fetchMock,
      retry: { maxRetries: 0, sleep: async () => undefined },
    });

    await expect(
      http.request('/write', { method: 'POST', body: { value: 1 } }),
    ).rejects.toBeInstanceOf(GarminSessionExpiredError);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('never recovers or replays a skipAuth request after 401', async () => {
    const storage = new MemoryTokenStorage();
    const original = tokens({ accessToken: 'old-access', refreshToken: 'old-refresh' });
    await storage.save(original);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 401 }));
    const auth = new AuthService({ fetch: fetchMock, storage, retry: { maxRetries: 0 } });
    const http = new HttpClient({
      auth,
      fetch: fetchMock,
      retry: { maxRetries: 0, sleep: async () => undefined },
    });

    await expect(http.request('/public', { skipAuth: true })).rejects.toBeInstanceOf(
      GarminSessionExpiredError,
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await storage.load()).toEqual(original);
  });

  it('does not resurrect a session or replay after explicit logout during recovery', async () => {
    const storage = new MemoryTokenStorage();
    await storage.save(tokens({ accessToken: 'old-access', refreshToken: 'old-refresh' }));
    let resolveRefresh: (response: Response) => void = () => undefined;
    let refreshStarted = false;
    const refreshResponse = new Promise<Response>((resolve) => {
      resolveRefresh = resolve;
    });
    const fetchMock = vi.fn<typeof fetch>().mockImplementation((input) => {
      if (String(input).includes('/di-oauth2-service/oauth/token')) {
        refreshStarted = true;
        return refreshResponse;
      }
      return Promise.resolve(jsonErrorResponse({ error: 'invalid_token' }, 401));
    });
    const auth = new AuthService({ fetch: fetchMock, storage, retry: { maxRetries: 0 } });
    const http = new HttpClient({ auth, fetch: fetchMock, retry: { maxRetries: 0 } });

    const request = http.request('/read').catch((caught: unknown) => caught);
    await waitFor(() => refreshStarted);
    await auth.logout();
    resolveRefresh(tokenResponse('should-not-survive-logout'));

    const error = await request;
    expect(error).toBeInstanceOf(GarminRequestError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await storage.load()).toBeNull();
  });

  it('does not recover or replay when the original 401 arrives after logout', async () => {
    const storage = new MemoryTokenStorage();
    await storage.save(tokens({ accessToken: 'old-access', refreshToken: 'old-refresh' }));
    let resolveOriginal: (response: Response) => void = () => undefined;
    let dispatched = false;
    const originalResponse = new Promise<Response>((resolve) => {
      resolveOriginal = resolve;
    });
    const fetchMock = vi.fn<typeof fetch>().mockImplementation((input) => {
      dispatched = true;
      if (String(input).includes('/di-oauth2-service/oauth/token')) {
        return Promise.resolve(tokenResponse('should-not-recover'));
      }
      return originalResponse;
    });
    const auth = new AuthService({ fetch: fetchMock, storage, retry: { maxRetries: 0 } });
    const http = new HttpClient({ auth, fetch: fetchMock, retry: { maxRetries: 0 } });

    const request = http.request('/read').catch((caught: unknown) => caught);
    await waitFor(() => dispatched);
    await auth.logout();
    resolveOriginal(jsonErrorResponse({ error: 'invalid_token' }, 401));

    const error = await request;
    expect(error).toBeInstanceOf(GarminRequestError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await storage.load()).toBeNull();
  });

  it('does not resurrect a recovered save or replay after logout starts during save', async () => {
    const storage = new DeferredSaveStorage();
    await storage.save(tokens({ accessToken: 'old-access', refreshToken: 'old-refresh' }));
    storage.deferNextSave();
    const fetchMock = vi.fn<typeof fetch>().mockImplementation((input) => {
      if (String(input).includes('/di-oauth2-service/oauth/token')) {
        return Promise.resolve(tokenResponse('recovered-refresh'));
      }
      return Promise.resolve(jsonErrorResponse({ error: 'invalid_token' }, 401));
    });
    const auth = new AuthService({ fetch: fetchMock, storage, retry: { maxRetries: 0 } });
    const http = new HttpClient({ auth, fetch: fetchMock, retry: { maxRetries: 0 } });

    const request = http.request('/read').catch((caught: unknown) => caught);
    await waitFor(() => storage.saveStarted);
    const logout = auth.logout();
    storage.releaseHeldSave();
    await logout;

    const error = await request;
    expect(error).toBeInstanceOf(GarminRequestError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await storage.load()).toBeNull();
  });

  it('does not recover a request that fails before dispatch because no session exists', async () => {
    const storage = new MemoryTokenStorage();
    const fetchMock = vi.fn<typeof fetch>();
    const auth = new AuthService({ fetch: fetchMock, storage, retry: { maxRetries: 0 } });
    const http = new HttpClient({ auth, fetch: fetchMock, retry: { maxRetries: 5 } });

    await expect(http.request('/read')).rejects.toBeInstanceOf(GarminSessionExpiredError);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['generic 403', () => new Response('', { status: 403 }), GarminRequestError],
    [
      'bot challenge',
      () => new Response('', { status: 403, headers: { 'cf-mitigated': 'challenge' } }),
      GarminBotChallengeError,
    ],
    ['rate limit', () => new Response('', { status: 429 }), GarminRateLimitError],
    [
      'server failure',
      () => jsonErrorResponse({ error: 'invalid_token' }, 503),
      GarminRequestError,
    ],
  ])('does not recover or replay a %s response', async (_name, makeResponse, ExpectedError) => {
    const storage = new MemoryTokenStorage();
    const original = tokens({ accessToken: 'old-access', refreshToken: 'old-refresh' });
    await storage.save(original);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(makeResponse());
    const auth = new AuthService({ fetch: fetchMock, storage, retry: { maxRetries: 0 } });
    const http = new HttpClient({
      auth,
      fetch: fetchMock,
      retry: { maxRetries: 0, sleep: async () => undefined },
    });

    const error = await http.request('/read').catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ExpectedError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await storage.load()).toEqual(original);
  });
});

function jsonErrorResponse(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function waitFor(assertion: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (assertion()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error('Timed out waiting for condition.');
}

class DeferredSaveStorage extends MemoryTokenStorage {
  saveStarted = false;
  #holdNextSave = false;
  #releaseSave: (() => void) | undefined;

  deferNextSave(): void {
    this.#holdNextSave = true;
  }

  releaseHeldSave(): void {
    this.#releaseSave?.();
    this.#releaseSave = undefined;
  }

  override async save(value: Parameters<MemoryTokenStorage['save']>[0]): Promise<void> {
    if (this.#holdNextSave) {
      this.#holdNextSave = false;
      this.saveStarted = true;
      await new Promise<void>((resolve) => {
        this.#releaseSave = resolve;
      });
    }
    await super.save(value);
  }
}
