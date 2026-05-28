import { vi } from 'vitest';

import type { GarminTokens } from '../../src/auth/types.js';

export const DI_CLIENT_ID = 'GARMIN_CONNECT_MOBILE_ANDROID_DI';

export type FetchMock = ReturnType<typeof vi.fn<typeof fetch>>;

export function fetchCall(
  fetchMock: FetchMock,
  index: number,
): { url: unknown; init?: RequestInit } {
  const call = fetchMock.mock.calls[index];
  if (!call) throw new Error(`Missing fetch call at index ${index}.`);
  return { url: call[0], init: call[1] };
}

export function jsonResponse(payload: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(payload), {
    status: init.status ?? 200,
    headers: {
      'content-type': 'application/json',
      ...init.headers,
    },
  });
}

export function textResponse(payload: string, init: ResponseInit = {}): Response {
  return new Response(payload, {
    status: init.status ?? 200,
    headers: {
      'content-type': 'application/json',
      ...init.headers,
    },
  });
}

export function tokens(overrides: Partial<GarminTokens> = {}): GarminTokens {
  return {
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    accessTokenExpiresAt: new Date(Date.now() + 120_000).toISOString(),
    ...overrides,
  };
}

export function expiredTokens(overrides: Partial<GarminTokens> = {}): GarminTokens {
  return tokens({
    accessToken: jwt({ exp: pastSeconds(), client_id: DI_CLIENT_ID }),
    refreshToken: 'old-refresh-token',
    accessTokenExpiresAt: new Date(Date.now() - 60_000).toISOString(),
    clientId: DI_CLIENT_ID,
    ...overrides,
  });
}

export function tokenResponse(refreshToken = 'refresh-token', clientId = DI_CLIENT_ID): Response {
  return jsonResponse({
    access_token: jwt({ exp: futureSeconds(), client_id: clientId }),
    refresh_token: refreshToken,
    token_type: 'Bearer',
    expires_in: 3600,
  });
}

export function jwt(payload: Record<string, unknown>): string {
  return [base64Url({ alg: 'none', typ: 'JWT' }), base64Url(payload), 'signature'].join('.');
}

export function futureSeconds(): number {
  return Math.floor(Date.now() / 1000) + 3600;
}

function pastSeconds(): number {
  return Math.floor(Date.now() / 1000) - 3600;
}

function base64Url(payload: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}
