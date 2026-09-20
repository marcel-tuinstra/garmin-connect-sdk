import { describe, expect, it, vi } from 'vitest';

import { MemoryTokenStorage } from '../../src/auth/MemoryTokenStorage.js';
import type { GarminTokens } from '../../src/auth/types.js';
import { GarminConnectSDK } from '../../src/client/GarminConnectSDK.js';
import {
  GarminAuthError,
  GarminRequestError,
  GarminSessionExpiredError,
} from '../../src/client/GarminRequestError.js';
import {
  DI_CLIENT_ID,
  expiredTokens,
  jsonResponse,
  jwt,
  tokens,
  type FetchMock,
} from '../helpers/garmin.js';

const ACCOUNT_A = { email: 'a@example.com', password: 'secret-a' };
const ACCOUNT_B = { email: 'b@example.com', password: 'secret-b' };

describe('login state transitions', () => {
  it('invalidates the previous session and profile as soon as a new login starts', async () => {
    // Arrange
    const storage = new MemoryTokenStorage();
    const pendingLogin = deferred<Response>();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(ticketResponse('ticket-a'))
      .mockResolvedValueOnce(oauthResponse('runner-a'))
      .mockReturnValueOnce(pendingLogin.promise);
    const garmin = new GarminConnectSDK({ storage, fetch: fetchMock, maxRetries: 0 });
    await garmin.login(ACCOUNT_A);

    // Act
    const switching = garmin.login(ACCOUNT_B).catch((caught: unknown) => caught);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));

    // Assert
    expect(await storage.load()).toBeNull();
    await expect(garmin.user.getDisplayName()).rejects.toBeInstanceOf(GarminRequestError);

    pendingLogin.resolve(invalidCredentialsResponse());
    await expect(switching).resolves.toBeInstanceOf(GarminAuthError);
  });

  it('leaves one unauthenticated state after a failed account switch', async () => {
    // Arrange
    const storage = new MemoryTokenStorage();
    const fetchMock = sequenceFetch([
      ticketResponse('ticket-a'),
      oauthResponse('runner-a'),
      invalidCredentialsResponse(),
    ]);
    const garmin = new GarminConnectSDK({ storage, fetch: fetchMock, maxRetries: 0 });
    await garmin.login(ACCOUNT_A);

    // Act
    const error = await garmin.login(ACCOUNT_B).catch((caught: unknown) => caught);

    // Assert
    expect(error).toBeInstanceOf(GarminAuthError);
    expect(await storage.load()).toBeNull();
    await expect(garmin.restoreSession()).resolves.toBe(false);
    await expect(garmin.user.getDisplayName()).rejects.toBeInstanceOf(GarminSessionExpiredError);
  });

  it('resolves a blank token displayName from the new account profile', async () => {
    // Arrange
    const storage = new MemoryTokenStorage();
    const fetchMock = sequenceFetch([
      ticketResponse('ticket-a'),
      oauthResponse('runner-a'),
      ticketResponse('ticket-b'),
      oauthResponse('   '),
      jsonResponse({ displayName: 'runner-b' }),
    ]);
    const garmin = new GarminConnectSDK({ storage, fetch: fetchMock, maxRetries: 0 });
    await garmin.login(ACCOUNT_A);

    // Act
    await garmin.login(ACCOUNT_B);

    // Assert
    await expect(garmin.user.getDisplayName()).resolves.toBe('runner-b');
    expect((await storage.load())?.displayName).toBe('   ');
  });

  it('rolls back new tokens when profile resolution fails', async () => {
    // Arrange
    const storage = new MemoryTokenStorage();
    const fetchMock = sequenceFetch([
      ticketResponse('ticket-a'),
      oauthResponse('runner-a'),
      ticketResponse('ticket-b'),
      oauthResponse(),
      new Response('', { status: 503 }),
    ]);
    const garmin = new GarminConnectSDK({ storage, fetch: fetchMock, maxRetries: 0 });
    await garmin.login(ACCOUNT_A);

    // Act
    const error = await garmin.login(ACCOUNT_B).catch((caught: unknown) => caught);

    // Assert
    expect(error).toBeInstanceOf(GarminRequestError);
    expect(await storage.load()).toBeNull();
    await expect(garmin.restoreSession()).resolves.toBe(false);
    await expect(garmin.user.getDisplayName()).rejects.toBeInstanceOf(GarminSessionExpiredError);
  });

  it('rolls back new tokens when the resolved profile identity is blank', async () => {
    // Arrange
    const storage = new MemoryTokenStorage();
    const fetchMock = sequenceFetch([
      ticketResponse('ticket-a'),
      oauthResponse('runner-a'),
      ticketResponse('ticket-b'),
      oauthResponse(''),
      jsonResponse({ displayName: '   ' }),
    ]);
    const garmin = new GarminConnectSDK({ storage, fetch: fetchMock, maxRetries: 0 });
    await garmin.login(ACCOUNT_A);

    // Act
    const error = await garmin.login(ACCOUNT_B).catch((caught: unknown) => caught);

    // Assert
    expect(error).toBeInstanceOf(GarminAuthError);
    expect(await storage.load()).toBeNull();
    await expect(garmin.restoreSession()).resolves.toBe(false);
  });

  it('rolls back refreshed login tokens when profile resolution then fails', async () => {
    // Arrange
    const storage = new MemoryTokenStorage();
    const fetchMock = sequenceFetch([
      ticketResponse('ticket-a'),
      oauthResponse('runner-a'),
      ticketResponse('ticket-b'),
      jsonResponse({
        access_token: jwt({
          exp: Math.floor(Date.now() / 1000) + 30,
          client_id: DI_CLIENT_ID,
        }),
        refresh_token: 'near-expiry-refresh-token',
        expires_in: 30,
      }),
      oauthResponse(),
      new Response('', { status: 503 }),
    ]);
    const garmin = new GarminConnectSDK({ storage, fetch: fetchMock, maxRetries: 0 });
    await garmin.login(ACCOUNT_A);

    // Act
    const error = await garmin.login(ACCOUNT_B).catch((caught: unknown) => caught);

    // Assert
    expect(error).toBeInstanceOf(GarminRequestError);
    expect(await storage.load()).toBeNull();
    await expect(garmin.restoreSession()).resolves.toBe(false);
  });

  it('does not dispatch provisional login tokens before profile validation completes', async () => {
    // Arrange
    const storage = new MemoryTokenStorage();
    const pendingProfile = deferred<Response>();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(ticketResponse('ticket-b'))
      .mockResolvedValueOnce(oauthResponse())
      .mockReturnValueOnce(pendingProfile.promise);
    const garmin = new GarminConnectSDK({ storage, fetch: fetchMock, maxRetries: 0 });
    const loggingIn = garmin.login(ACCOUNT_B);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));

    // Act
    const provisionalRequestError = await garmin.weight
      .getDailyWeighIns('2026-09-20')
      .catch((caught: unknown) => caught);
    const forgedCapabilityError = await garmin.user
      .getProfile({ sessionTransitionCapability: Symbol('forged-transition') })
      .catch((caught: unknown) => caught);

    // Assert
    expect(provisionalRequestError).toBeInstanceOf(GarminRequestError);
    expect(forgedCapabilityError).toBeInstanceOf(GarminRequestError);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    pendingProfile.resolve(jsonResponse({ displayName: 'runner-b' }));
    await expect(loggingIn).resolves.toBeUndefined();
    await expect(garmin.user.getDisplayName()).resolves.toBe('runner-b');
  });

  it('quarantines stored tokens after a transient restore failure until explicit retry', async () => {
    // Arrange
    const storage = new MemoryTokenStorage();
    await storage.save(tokens({ displayName: 'runner-a' }));
    const fetchMock = sequenceFetch([
      new Response('', { status: 503 }),
      jsonResponse({ displayName: 'runner-a' }),
    ]);
    const garmin = new GarminConnectSDK({ storage, fetch: fetchMock, maxRetries: 0 });

    // Act
    const restoreError = await garmin.restoreSession().catch((caught: unknown) => caught);
    const implicitRequestError = await garmin.user
      .getDisplayName()
      .catch((caught: unknown) => caught);

    // Assert
    expect(restoreError).toBeInstanceOf(GarminRequestError);
    expect(implicitRequestError).toBeInstanceOf(GarminRequestError);
    expect(await storage.load()).toMatchObject({ accessToken: 'access-token' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await expect(garmin.restoreSession()).resolves.toBe(true);
    await expect(garmin.user.getDisplayName()).resolves.toBe('runner-a');
  });

  it('fails closed while persisted-session invalidation is still pending', async () => {
    // Arrange
    const storage = new ControlledTokenStorage(tokens({ displayName: 'runner-a' }));
    const fetchMock = sequenceFetch([
      jsonResponse({ displayName: 'runner-a' }),
      invalidCredentialsResponse(),
    ]);
    const garmin = new GarminConnectSDK({ storage, fetch: fetchMock, maxRetries: 0 });
    await garmin.restoreSession();
    const releaseClear = storage.deferNextClear();

    // Act
    const switching = garmin.login(ACCOUNT_B).catch((caught: unknown) => caught);
    const profileError = await garmin.user.getDisplayName().catch((caught: unknown) => caught);

    // Assert
    expect(profileError).toBeInstanceOf(GarminRequestError);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    releaseClear();
    await expect(switching).resolves.toBeInstanceOf(GarminAuthError);
  });

  it('stays fail-closed and returns a sanitized error when session cleanup fails', async () => {
    // Arrange
    const storage = new ControlledTokenStorage(tokens({ displayName: 'runner-a' }));
    const fetchMock = sequenceFetch([jsonResponse({ displayName: 'runner-a' })]);
    const garmin = new GarminConnectSDK({ storage, fetch: fetchMock, maxRetries: 0 });
    await garmin.restoreSession();
    storage.failClear = true;

    // Act
    const error = await garmin.login(ACCOUNT_B).catch((caught: unknown) => caught);
    const profileError = await garmin.user.getDisplayName().catch((caught: unknown) => caught);

    // Assert
    expect(error).toBeInstanceOf(GarminRequestError);
    expect(String(error)).toContain('cleanup failed');
    expect(String(error)).not.toContain('private-storage-detail');
    expect(profileError).toBeInstanceOf(GarminRequestError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('prevents a late profile response from overwriting a newer login', async () => {
    // Arrange
    const storage = new MemoryTokenStorage();
    const lateProfile = deferred<Response>();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(ticketResponse('ticket-a'))
      .mockResolvedValueOnce(oauthResponse())
      .mockReturnValueOnce(lateProfile.promise)
      .mockResolvedValueOnce(ticketResponse('ticket-b'))
      .mockResolvedValueOnce(oauthResponse('runner-b'));
    const garmin = new GarminConnectSDK({ storage, fetch: fetchMock, maxRetries: 0 });
    const firstLogin = garmin.login(ACCOUNT_A).catch((caught: unknown) => caught);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));

    // Act
    await garmin.login(ACCOUNT_B);
    lateProfile.resolve(jsonResponse({ displayName: 'runner-a' }));
    const firstResult = await firstLogin;

    // Assert
    expect(firstResult).toBeInstanceOf(GarminRequestError);
    await expect(garmin.user.getDisplayName()).resolves.toBe('runner-b');
    expect((await storage.load())?.displayName).toBe('runner-b');
  });

  it('prevents a late login response from replacing a newer account', async () => {
    // Arrange
    const storage = new MemoryTokenStorage();
    const lateTicket = deferred<Response>();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockReturnValueOnce(lateTicket.promise)
      .mockResolvedValueOnce(ticketResponse('ticket-b'))
      .mockResolvedValueOnce(oauthResponse('runner-b'))
      .mockResolvedValueOnce(oauthResponse('runner-a'));
    const garmin = new GarminConnectSDK({ storage, fetch: fetchMock, maxRetries: 0 });
    const firstLogin = garmin.login(ACCOUNT_A).catch((caught: unknown) => caught);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    // Act
    await garmin.login(ACCOUNT_B);
    lateTicket.resolve(ticketResponse('ticket-a'));
    const firstResult = await firstLogin;

    // Assert
    expect(firstResult).toBeInstanceOf(GarminRequestError);
    await expect(garmin.user.getDisplayName()).resolves.toBe('runner-b');
    expect((await storage.load())?.displayName).toBe('runner-b');
  });

  it('prevents a late restore profile from overwriting a newer login', async () => {
    // Arrange
    const storage = new MemoryTokenStorage();
    await storage.save(tokens({ displayName: 'runner-a' }));
    const lateProfile = deferred<Response>();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockReturnValueOnce(lateProfile.promise)
      .mockResolvedValueOnce(ticketResponse('ticket-b'))
      .mockResolvedValueOnce(oauthResponse('runner-b'));
    const garmin = new GarminConnectSDK({ storage, fetch: fetchMock, maxRetries: 0 });
    const restoring = garmin.restoreSession().catch((caught: unknown) => caught);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    // Act
    await garmin.login(ACCOUNT_B);
    lateProfile.resolve(jsonResponse({ displayName: 'runner-a' }));
    const restoreResult = await restoring;

    // Assert
    expect(restoreResult).toBeInstanceOf(GarminRequestError);
    await expect(garmin.user.getDisplayName()).resolves.toBe('runner-b');
    expect((await storage.load())?.displayName).toBe('runner-b');
  });

  it('prevents a late restore refresh from persisting over a newer login', async () => {
    // Arrange
    const storage = new MemoryTokenStorage();
    await storage.save(expiredTokens({ displayName: 'runner-a' }));
    const lateRefresh = deferred<Response>();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockReturnValueOnce(lateRefresh.promise)
      .mockResolvedValueOnce(ticketResponse('ticket-b'))
      .mockResolvedValueOnce(oauthResponse('runner-b'));
    const garmin = new GarminConnectSDK({ storage, fetch: fetchMock, maxRetries: 0 });
    const restoring = garmin.restoreSession().catch((caught: unknown) => caught);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    // Act
    await garmin.login(ACCOUNT_B);
    lateRefresh.resolve(oauthResponse('runner-a-refreshed'));
    const restoreResult = await restoring;

    // Assert
    expect(restoreResult).toBeInstanceOf(GarminRequestError);
    await expect(garmin.user.getDisplayName()).resolves.toBe('runner-b');
    expect((await storage.load())?.displayName).toBe('runner-b');
  });

  it('does not expose credentials, tokens, or profile identity in transition errors or logs', async () => {
    // Arrange
    const entries: unknown[][] = [];
    const record = (...args: unknown[]): void => {
      entries.push(args);
    };
    const logger = { debug: record, info: record, warn: record, error: record };
    const fetchMock = sequenceFetch([
      ticketResponse('ticket-private'),
      jsonResponse({
        access_token: 'access-token-private',
        refresh_token: 'refresh-token-private',
        expires_in: 3_600,
        display_name: 'profile-private',
      }),
      invalidCredentialsResponse(),
    ]);
    const garmin = new GarminConnectSDK({
      storage: new MemoryTokenStorage(),
      fetch: fetchMock,
      logger,
      maxRetries: 0,
    });
    await garmin.login({ email: 'email-private', password: 'password-private' });

    // Act
    const error = await garmin
      .login({ email: 'email-private', password: 'password-private' })
      .catch((caught: unknown) => caught);

    // Assert
    const evidence = `${String(error)} ${JSON.stringify(entries)}`;
    for (const secret of [
      'email-private',
      'password-private',
      'access-token-private',
      'refresh-token-private',
      'profile-private',
    ]) {
      expect(evidence).not.toContain(secret);
    }
  });
});

function ticketResponse(serviceTicketId: string): Response {
  return jsonResponse({ serviceTicketId });
}

function invalidCredentialsResponse(): Response {
  return jsonResponse({ responseStatus: { type: 'INVALID_USERNAME_PASSWORD' } }, { status: 400 });
}

function oauthResponse(displayName?: string): Response {
  return jsonResponse({
    access_token: jwt({ exp: Math.floor(Date.now() / 1000) + 3_600, client_id: DI_CLIENT_ID }),
    refresh_token: `refresh-${displayName ?? 'profile'}`,
    expires_in: 3_600,
    ...(displayName === undefined ? {} : { display_name: displayName }),
  });
}

function sequenceFetch(responses: Response[]): FetchMock {
  const fetchMock = vi.fn<typeof fetch>();
  for (const response of responses) fetchMock.mockResolvedValueOnce(response);
  return fetchMock;
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((fulfill) => {
    resolve = fulfill;
  });
  return { promise, resolve };
}

class ControlledTokenStorage {
  #tokens: GarminTokens | null;
  #nextClear: ReturnType<typeof deferred<void>> | null = null;
  failClear = false;

  constructor(tokensValue: GarminTokens | null) {
    this.#tokens = tokensValue ? { ...tokensValue } : null;
  }

  async load(): Promise<GarminTokens | null> {
    return this.#tokens ? { ...this.#tokens } : null;
  }

  async save(tokensValue: GarminTokens): Promise<void> {
    this.#tokens = { ...tokensValue };
  }

  async clear(): Promise<void> {
    if (this.failClear) throw new Error('private-storage-detail');
    const pending = this.#nextClear;
    this.#nextClear = null;
    if (pending) await pending.promise;
    this.#tokens = null;
  }

  deferNextClear(): () => void {
    const pending = deferred<void>();
    this.#nextClear = pending;
    return () => pending.resolve();
  }
}
