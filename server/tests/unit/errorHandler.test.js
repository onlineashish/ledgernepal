import { describe, expect, it, vi } from 'vitest';
import { errorHandler } from '../../src/middleware/errorHandler.js';
import { conflict, validationFailed } from '../../src/lib/errors.js';

function run(err) {
  const req = { id: 'req-1', log: { error: vi.fn() } };
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
  errorHandler(err, req, res, () => {});
  return { req, status: res.status.mock.calls[0][0], body: res.json.mock.calls[0][0] };
}

describe('errorHandler', () => {
  it('passes AppError status, code, message and details through', () => {
    const { status, body } = run(validationFailed([{ field: 'name', message: 'Required' }]));
    expect(status).toBe(400);
    expect(body).toEqual({
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Some fields are invalid',
        details: [{ field: 'name', message: 'Required' }],
        requestId: 'req-1',
      },
    });
  });

  it('omits details when there are none', () => {
    const { status, body } = run(conflict('Already voided'));
    expect(status).toBe(409);
    expect(body.error).not.toHaveProperty('details');
  });

  it('hides unexpected errors behind a generic 500 and logs them', () => {
    const secret = new Error('password authentication failed for user neondb_owner');
    const { req, status, body } = run(secret);
    expect(status).toBe(500);
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(body)).not.toContain('neondb_owner');
    expect(req.log.error).toHaveBeenCalled();
  });
});
