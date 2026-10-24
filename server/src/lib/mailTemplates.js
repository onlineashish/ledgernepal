// Plain, short emails. The HTML part only escapes and links; no tracking, no images.

const escapeHtml = (text) =>
  String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function wrap(name, lines, link) {
  const text = [`Hello ${name},`, '', ...lines, ...(link ? ['', link.url] : []), '', 'LedgerNepal'].join('\n');
  const html = [
    `<p>Hello ${escapeHtml(name)},</p>`,
    ...lines.map((l) => `<p>${escapeHtml(l)}</p>`),
    ...(link ? [`<p><a href="${escapeHtml(link.url)}">${escapeHtml(link.label)}</a></p>`, `<p>${escapeHtml(link.url)}</p>`] : []),
    '<p>LedgerNepal</p>',
  ].join('\n');
  return { text, html };
}

export function passwordResetEmail({ name, url, minutes }) {
  return {
    subject: 'Reset your LedgerNepal password',
    ...wrap(
      name,
      [
        'We received a request to reset your password. Use the link below to choose a new one.',
        `The link works once and expires in ${minutes} minutes.`,
        'If you did not ask for this, you can ignore this email. Your password will not change.',
      ],
      { url, label: 'Choose a new password' },
    ),
  };
}

export function passwordChangedEmail({ name }) {
  return {
    subject: 'Your LedgerNepal password was changed',
    ...wrap(name, [
      'The password for your account was just changed, and you were logged out on your other devices.',
      'If this was not you, use "Forgot password" to set a new one now and tell your business owner.',
    ]),
  };
}
