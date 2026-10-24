import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiFetch, setCsrfToken, setUnauthenticatedHandler } from '../src/api/client.js';

function mockFetch(response) {
  const fn = vi.fn().mockResolvedValue(response);
  vi.stubGlobal('fetch', fn);
  return fn;
}
const json = (status, body) => ({ ok: status < 400, status, json: async () => body });

afterEach(() => {
  vi.unstubAllGlobals();
  setCsrfToken(null);
  setUnauthenticatedHandler(null);
});

describe('session ended (401)', () => {
  it('tells the app to log out when a protected request comes back 401', async () => {
    const handler = vi.fn();
    setUnauthenticatedHandler(handler);
    mockFetch(json(401, { error: { code: 'UNAUTHENTICATED', message: 'You need to log in' } }));
    await expect(apiFetch('/contacts')).rejects.toMatchObject({ status: 401 });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('does not, for endpoints where 401 is the normal answer', async () => {
    const handler = vi.fn();
    setUnauthenticatedHandler(handler);
    for (const path of ['/auth/me', '/auth/login', '/auth/register', '/invitations/preview']) {
      mockFetch(json(401, { error: { code: 'UNAUTHENTICATED', message: 'x' } }));
      await apiFetch(path).catch(() => {});
    }
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('apiFetch', () => {
  it('returns the parsed body and sends cookies on same-origin requests', async () => {
    const fetchFn = mockFetch(json(200, { data: { status: 'ok' } }));
    await expect(apiFetch('/health')).resolves.toEqual({ data: { status: 'ok' } });
    expect(fetchFn).toHaveBeenCalledWith('/api/health', expect.objectContaining({ credentials: 'same-origin', method: 'GET' }));
  });

  it('turns the server error envelope into an ApiError', async () => {
    mockFetch(json(400, { error: { code: 'VALIDATION_FAILED', message: 'Some fields are invalid', details: [{ field: 'name' }], requestId: 'r1' } }));
    const err = await apiFetch('/contacts', { method: 'POST', body: {} }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 400, code: 'VALIDATION_FAILED', requestId: 'r1', details: [{ field: 'name' }] });
  });

  it('gives a safe message when the response is not JSON (e.g. proxy error page)', async () => {
    mockFetch({ ok: false, status: 502, json: async () => { throw new SyntaxError('bad json'); } });
    const err = await apiFetch('/health').catch((e) => e);
    expect(err).toMatchObject({ status: 502, code: 'UNKNOWN_ERROR' });
    expect(err.message).toMatch(/something went wrong/i);
  });

  it('reports network failures as NETWORK_ERROR', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(apiFetch('/health')).rejects.toMatchObject({ code: 'NETWORK_ERROR', status: 0 });
  });

  it('sends the CSRF token on writes but not on reads', async () => {
    setCsrfToken('tok-123');
    const fetchFn = mockFetch(json(200, { data: {} }));
    await apiFetch('/contacts', { method: 'POST', body: { name: 'A' } });
    await apiFetch('/contacts');
    expect(fetchFn.mock.calls[0][1].headers['X-CSRF-Token']).toBe('tok-123');
    expect(fetchFn.mock.calls[0][1].headers['Content-Type']).toBe('application/json');
    expect(fetchFn.mock.calls[1][1].headers['X-CSRF-Token']).toBeUndefined();
  });
});
