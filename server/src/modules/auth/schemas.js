import { z } from 'zod';
import { PASSWORD_MAX_LENGTH, passwordProblem } from '../../lib/password.js';

const email = z
  .string({ error: 'Email is required' })
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: 'Enter a valid email address' }).max(254, 'Email is too long'));

const name = (label, max) =>
  z
    .string({ error: `${label} is required` })
    .trim()
    .min(1, `${label} is required`)
    .max(max, `${label} must be at most ${max} characters`);

// Passwords are never trimmed or altered: what the user typed is what gets hashed.
const passwordField = z
  .string({ error: 'Password is required' })
  .min(1, 'Password is required')
  .max(PASSWORD_MAX_LENGTH, `Password must be at most ${PASSWORD_MAX_LENGTH} characters`);

// strictObject: unknown keys (is_platform_admin, role, business_id ...) are an error, not ignored.
export const registerBody = z
  .strictObject({
    fullName: name('Your name', 100),
    email,
    password: passwordField,
    businessName: name('Business name', 150),
  })
  .superRefine((data, ctx) => {
    const problem = passwordProblem(data.password, { email: data.email, fullName: data.fullName });
    if (problem) ctx.addIssue({ code: 'custom', path: ['password'], message: problem });
  });

export const loginBody = z.strictObject({ email, password: passwordField });

export const activeBusinessBody = z.strictObject({
  businessId: z.uuid({ error: 'Choose a valid business' }),
});
