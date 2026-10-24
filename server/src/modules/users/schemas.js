import { z } from 'zod';
import { PERMISSION_KEYS, ROLE_KEYS } from '@ledgernepal/shared/permissions';
import { PASSWORD_MAX_LENGTH, passwordProblem } from '../../lib/password.js';

const email = z
  .string({ error: 'Email is required' })
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: 'Enter a valid email address' }).max(254, 'Email is too long'));

// "owner" is deliberately not assignable: ownership moves only through transfer-ownership.
const ASSIGNABLE_ROLES = ROLE_KEYS.filter((key) => key !== 'owner');
const roleKey = z.enum(ASSIGNABLE_ROLES, { error: `Role must be one of: ${ASSIGNABLE_ROLES.join(', ')}` });

const idParam = (name) => z.strictObject({ [name]: z.uuid({ error: 'Invalid id' }) });
export const membershipParams = idParam('membershipId');
export const invitationParams = idParam('id');

export const inviteBody = z.strictObject({ email, roleKey });

const override = z.strictObject({
  permission: z.enum(PERMISSION_KEYS, { error: 'Unknown permission' }),
  effect: z.enum(['grant', 'deny'], { error: 'Effect must be "grant" or "deny"' }),
});

export const updateMemberBody = z
  .strictObject({
    roleKey: roleKey.optional(),
    // When present this is the member's COMPLETE list of overrides (an empty list clears them all).
    overrides: z.array(override).max(PERMISSION_KEYS.length).optional(),
  })
  .refine((body) => body.roleKey !== undefined || body.overrides !== undefined, {
    message: 'Provide a role or a list of overrides',
  })
  .refine((body) => !body.overrides || new Set(body.overrides.map((o) => o.permission)).size === body.overrides.length, {
    message: 'Each permission may appear only once',
    path: ['overrides'],
  });

export const transferOwnershipBody = z.strictObject({
  membershipId: z.uuid({ error: 'Choose the member who will become the owner' }),
  password: z.string({ error: 'Enter your password to confirm' }).min(1, 'Enter your password to confirm').max(PASSWORD_MAX_LENGTH),
});

// ------------------------------------------------------------------ public invitation endpoints

const token = z.string({ error: 'Invitation link is missing' }).trim().min(20, 'Invitation link is not valid').max(100, 'Invitation link is not valid');

export const tokenBody = z.strictObject({ token });

export const acceptNewBody = z
  .strictObject({
    token,
    fullName: z.string({ error: 'Your name is required' }).trim().min(1, 'Your name is required').max(100, 'Your name must be at most 100 characters'),
    password: z.string({ error: 'Password is required' }).min(1, 'Password is required').max(PASSWORD_MAX_LENGTH, `Password must be at most ${PASSWORD_MAX_LENGTH} characters`),
  });

// The invitation's own email is used for the password rule; checked in the service.
export { passwordProblem };
