import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../../src/config/index.js';
import { createBackgroundTasks } from '../../src/lib/background.js';
import { MailError, createMailer } from '../../src/lib/mailer.js';
import { passwordChangedEmail, passwordResetEmail } from '../../src/lib/mailTemplates.js';

const MESSAGE = { to: 'ram@example.com', subject: 'Hello', text: 'Plain', html: '<p>Plain</p>' };
const BREVO = { provider: 'brevo', brevoApiKey: 'xkeysib-secret-key-value', fromEmail: 'noreply@example.com', fromName: 'LedgerNepal' };
const response = (status, body = {}) => ({ ok: status < 400, status, json: async () => body });

describe('brevo provider', () => {
  it('posts the message to Brevo’s HTTPS API with the key in a header, not in the body', async () => {
    const fetchFn = vi.fn().mockResolvedValue(response(201, { messageId: 'x' }));
    await createMailer(BREVO, { fetchFn }).send(MESSAGE);

    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('https://api.brevo.com/v3/smtp/email');
    expect(init.method).toBe('POST');
    expect(init.headers['api-key']).toBe(BREVO.brevoApiKey);
    expect(init.signal).toBeInstanceOf(AbortSignal); // has a timeout
    expect(init.body).not.toContain(BREVO.brevoApiKey);
    expect(JSON.parse(init.body)).toEqual({
      sender: { name: 'LedgerNepal', email: 'noreply@example.com' },
      to: [{ email: 'ram@example.com' }],
      subject: 'Hello',
      textContent: 'Plain',
      htmlContent: '<p>Plain</p>',
    });
  });

  it('turns a refusal into a MailError that names the status but never the key', async () => {
    const fetchFn = vi.fn().mockResolvedValue(response(401, { code: 'unauthorized', message: 'Key not found' }));
    const error = await createMailer(BREVO, { fetchFn }).send(MESSAGE).catch((e) => e);
    expect(error).toBeInstanceOf(MailError);
    expect(error.message).toMatch(/HTTP 401/);
    expect(error.message).not.toContain(BREVO.brevoApiKey);
  });

  it('turns a network failure into a MailError without leaking the underlying error', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error(`connect failed for ${BREVO.brevoApiKey}`));
    const error = await createMailer(BREVO, { fetchFn }).send(MESSAGE).catch((e) => e);
    expect(error).toBeInstanceOf(MailError);
    expect(error.message).not.toContain(BREVO.brevoApiKey);
  });

  it('survives an error body that is not JSON', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 502, json: async () => { throw new SyntaxError('x'); } });
    await expect(createMailer(BREVO, { fetchFn }).send(MESSAGE)).rejects.toThrow(/HTTP 502/);
  });
});

describe('other providers', () => {
  it('memory keeps messages for tests to read', async () => {
    const mailer = createMailer({ provider: 'memory' });
    await mailer.send(MESSAGE);
    expect(mailer.outbox).toHaveLength(1);
    expect(mailer.to('ram@example.com')).toHaveLength(1);
    expect(mailer.to('nobody@example.com')).toHaveLength(0);
    mailer.clear();
    expect(mailer.outbox).toHaveLength(0);
  });

  it('console prints the message so a developer can follow the link', async () => {
    const logger = { info: vi.fn() };
    await createMailer({ provider: 'console' }, { logger }).send({ ...MESSAGE, text: 'Open https://app/reset?token=abc' });
    expect(logger.info.mock.calls[0][0]).toContain('https://app/reset?token=abc');
  });

  it('"none" reports itself disabled and refuses to send', async () => {
    const mailer = createMailer({ provider: 'none' });
    expect(mailer.enabled).toBe(false);
    await expect(mailer.send(MESSAGE)).rejects.toBeInstanceOf(MailError);
  });
});

describe('mail configuration', () => {
  const base = { DATABASE_URL: 'postgresql://u:p@host/db' };

  it('defaults to the console in development and to no email in production', () => {
    expect(loadConfig({ ...base, NODE_ENV: 'development' }).mail.provider).toBe('console');
    expect(loadConfig({ ...base, NODE_ENV: 'production' }).mail.provider).toBe('none');
  });

  it('refuses the console provider in production (it would put reset links in shared logs)', () => {
    expect(() => loadConfig({ ...base, NODE_ENV: 'production', MAIL_PROVIDER: 'console' })).toThrow(/not allowed in production/);
  });

  it('needs an API key and a sender address for Brevo', () => {
    expect(() => loadConfig({ ...base, MAIL_PROVIDER: 'brevo' })).toThrow(/BREVO_API_KEY and MAIL_FROM_EMAIL/);
    const config = loadConfig({ ...base, NODE_ENV: 'production', MAIL_PROVIDER: 'brevo', BREVO_API_KEY: 'xkeysib-abcdefghij', MAIL_FROM_EMAIL: 'me@example.com' });
    expect(config.mail).toMatchObject({ provider: 'brevo', fromEmail: 'me@example.com', fromName: 'LedgerNepal' });
  });

  it('tests can never send real mail, whatever .env says', () => {
    const config = loadConfig({ NODE_ENV: 'test', TEST_DATABASE_URL: 'postgresql://u:p@host/test', MAIL_PROVIDER: 'brevo', BREVO_API_KEY: 'xkeysib-abcdefghij', MAIL_FROM_EMAIL: 'me@example.com' });
    expect(config.mail.provider).toBe('memory');
  });
});

describe('email templates', () => {
  it('the reset email carries the link, its lifetime and an ignore-me line, in text and HTML', () => {
    const mail = passwordResetEmail({ name: 'Ram', url: 'https://app.example/reset-password?token=abc', minutes: 30 });
    for (const body of [mail.text, mail.html]) {
      expect(body).toContain('https://app.example/reset-password?token=abc');
      expect(body).toContain('30 minutes');
      expect(body).toMatch(/ignore this email/);
    }
  });

  it('escapes names so a hostile name cannot inject HTML into the email', () => {
    const mail = passwordResetEmail({ name: '<script>alert(1)</script>', url: 'https://app.example/r?token=a&b=1', minutes: 30 });
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).toContain('&lt;script&gt;');
    expect(mail.html).toContain('token=a&amp;b=1');
  });

  it('the changed-password notice tells the person what to do if it was not them', () => {
    const mail = passwordChangedEmail({ name: 'Ram' });
    expect(mail.text).toMatch(/was not you/);
    expect(mail.text).not.toMatch(/https?:\/\//); // no link to click in a security notice
  });
});

describe('background tasks', () => {
  it('waits for work, logs failures instead of throwing, and keeps going', async () => {
    const logger = { error: vi.fn() };
    const background = createBackgroundTasks(logger);
    let done = false;
    background.run(new Promise((resolve) => setTimeout(() => { done = true; resolve(); }, 20)), 'slow');
    background.run(Promise.reject(new Error('boom')), 'failing');
    await background.idle();
    expect(done).toBe(true);
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error.mock.calls[0][1]).toBe('Background task failed');
  });

  it('is immediately idle when nothing is running', async () => {
    await expect(createBackgroundTasks({ error() {} }).idle()).resolves.toBeUndefined();
  });
});
