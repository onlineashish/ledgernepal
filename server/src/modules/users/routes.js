import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { inviteBody, invitationParams, membershipParams, updateMemberBody } from './schemas.js';
import * as service from './service.js';

export function userRoutes({ config, pool, guards }) {
  const router = Router();
  const deps = { pool, config };

  router.get('/', ...guards.tenant('users.view'), async (req, res) => {
    res.json({ data: await service.listMembers({ ...deps, req }) });
  });

  // Invitation routes come before '/:membershipId' so "invitations" is never read as an id.
  router.get('/invitations', ...guards.tenant('users.view'), async (req, res) => {
    res.json({ data: await service.listInvitations({ ...deps, req }) });
  });

  router.post('/invitations', ...guards.tenant('users.invite'), validate({ body: inviteBody }), async (req, res) => {
    res.status(201).json({ data: await service.invite({ ...deps, req }, req.valid.body) });
  });

  router.delete('/invitations/:id', ...guards.tenant('users.invite'), validate({ params: invitationParams }), async (req, res) => {
    res.json({ data: await service.revokeInvitation({ ...deps, req }, req.valid.params.id) });
  });

  router.get('/:membershipId', ...guards.tenant('users.view'), validate({ params: membershipParams }), async (req, res) => {
    res.json({ data: await service.getMember({ ...deps, req }, req.valid.params.membershipId) });
  });

  router.patch(
    '/:membershipId',
    ...guards.tenant('users.manage'),
    validate({ params: membershipParams, body: updateMemberBody }),
    async (req, res) => {
      res.json({ data: await service.updateMember({ ...deps, req }, req.valid.params.membershipId, req.valid.body) });
    },
  );

  router.post('/:membershipId/deactivate', ...guards.tenant('users.manage'), validate({ params: membershipParams }), async (req, res) => {
    res.json({ data: await service.setMemberActive({ ...deps, req }, req.valid.params.membershipId, false) });
  });

  router.post('/:membershipId/password-reset-link', ...guards.tenant('users.manage'), validate({ params: membershipParams }), async (req, res) => {
    res.status(201).json({ data: await service.createPasswordResetLink({ ...deps, req }, req.valid.params.membershipId) });
  });

  router.post('/:membershipId/reactivate', ...guards.tenant('users.manage'), validate({ params: membershipParams }), async (req, res) => {
    res.json({ data: await service.setMemberActive({ ...deps, req }, req.valid.params.membershipId, true) });
  });

  return router;
}
