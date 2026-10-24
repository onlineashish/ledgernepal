// Outgoing email. Four interchangeable providers, chosen by MAIL_PROVIDER (see config):
//   brevo    production: Brevo's HTTPS API (works on Render's free tier, which blocks SMTP; needs no domain)
//   console  development: prints the message, including any reset link, to the server log
//   memory   tests: keeps messages in `outbox` so tests can read them
//   none     production without email: `enabled` is false and callers skip sending
// Every provider has the same shape: { provider, enabled, send({ to, subject, text, html }) }.

export class MailError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MailError';
  }
}

const BREVO_URL = 'https://api.brevo.com/v3/smtp/email';
const BREVO_TIMEOUT_MS = 10_000;

function brevoMailer({ brevoApiKey, fromEmail, fromName }, fetchFn) {
  return {
    provider: 'brevo',
    enabled: true,
    async send({ to, subject, text, html }) {
      let response;
      try {
        response = await fetchFn(BREVO_URL, {
          method: 'POST',
          headers: { 'api-key': brevoApiKey, 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ sender: { name: fromName, email: fromEmail }, to: [{ email: to }], subject, textContent: text, htmlContent: html }),
          signal: AbortSignal.timeout(BREVO_TIMEOUT_MS),
        });
      } catch {
        throw new MailError('Could not reach the email service'); // never include the underlying error: it can carry the request
      }
      if (!response.ok) {
        let reason = '';
        try {
          reason = (await response.json())?.message ?? '';
        } catch {
          // body was not JSON
        }
        throw new MailError(`Email service refused the message (HTTP ${response.status}${reason ? `: ${String(reason).slice(0, 200)}` : ''})`);
      }
    },
  };
}

function consoleMailer(logger) {
  return {
    provider: 'console',
    enabled: true,
    async send({ to, subject, text }) {
      (logger ?? console).info?.(`\n----- EMAIL (console provider) -----\nTo: ${to}\nSubject: ${subject}\n\n${text}\n------------------------------------\n`);
    },
  };
}

function memoryMailer() {
  const outbox = [];
  return {
    provider: 'memory',
    enabled: true,
    outbox,
    async send(message) {
      outbox.push({ ...message, sentAt: new Date() });
    },
    to: (address) => outbox.filter((m) => m.to === address),
    clear: () => { outbox.length = 0; },
  };
}

const disabledMailer = () => ({
  provider: 'none',
  enabled: false,
  async send() {
    throw new MailError('Email is not configured');
  },
});

export function createMailer(mail, { fetchFn = fetch, logger } = {}) {
  switch (mail.provider) {
    case 'brevo': return brevoMailer(mail, fetchFn);
    case 'console': return consoleMailer(logger);
    case 'memory': return memoryMailer();
    default: return disabledMailer();
  }
}
