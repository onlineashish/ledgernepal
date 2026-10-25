/**
 * Thin fetch wrapper for the LedgerNepal API.
 * - Always same-origin with cookies (the session cookie is HttpOnly; JS never sees it).
 * - Sends the CSRF token on state-changing requests (set after login in Phase 3).
 * - Turns the server's { error: { code, message, details, requestId } } into an ApiError.
 */
export class ApiError extends Error {
  constructor({ status, code, message, details, requestId }) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
  }
}

let csrfToken = null;
export function setCsrfToken(token) {
  csrfToken = token;
}

// Called when a request that needs a login comes back 401 (session expired, revoked, user suspended),
// so the app can drop its local state and send the person to the login page.
let onUnauthenticated = null;
export function setUnauthenticatedHandler(handler) {
  onUnauthenticated = handler;
}

// Endpoints where a 401 is an expected answer, not a sign the session died.
const EXPECTS_401 = ['/auth/me', '/auth/login', '/auth/register', '/invitations/'];

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export async function apiFetch(path, { method = 'GET', body, signal } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (csrfToken && !SAFE_METHODS.has(method)) headers['X-CSRF-Token'] = csrfToken;

  let response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      headers,
      credentials: 'same-origin',
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiError({
      status: 0,
      code: 'NETWORK_ERROR',
      message: 'Cannot reach the server. Check your connection and try again.',
    });
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    // Non-JSON response (e.g. a proxy error page); handled below.
  }

  if (!response.ok) {
    if (response.status === 401 && onUnauthenticated && !EXPECTS_401.some((p) => path.startsWith(p))) {
      onUnauthenticated();
    }
    const e = payload?.error;
    throw new ApiError({
      status: response.status,
      code: e?.code ?? 'UNKNOWN_ERROR',
      message: e?.message ?? 'Something went wrong. Please try again.',
      details: e?.details,
      requestId: e?.requestId,
    });
  }
  return payload;
}

/**
 * Downloads a file the API sends as an attachment (a CSV report) and hands it to the browser's save dialog.
 * Errors come back as the same ApiError as everything else, so they can be shown in the page.
 */
export async function downloadFile(path) {
  let response;
  try {
    response = await fetch(`/api${path}`, { credentials: 'same-origin', headers: { Accept: 'text/csv' } });
  } catch {
    throw new ApiError({ status: 0, code: 'NETWORK_ERROR', message: 'Cannot reach the server. Check your connection and try again.' });
  }
  if (!response.ok) {
    let payload = null;
    try { payload = await response.json(); } catch { /* not JSON */ }
    if (response.status === 401 && onUnauthenticated) onUnauthenticated();
    const e = payload?.error;
    throw new ApiError({ status: response.status, code: e?.code ?? 'UNKNOWN_ERROR', message: e?.message ?? 'The download failed. Please try again.', details: e?.details, requestId: e?.requestId });
  }
  const name = /filename="([^"]+)"/.exec(response.headers.get('Content-Disposition') ?? '')?.[1] ?? 'export.csv';
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  return name;
}
