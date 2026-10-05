import { Router } from 'express';
import { withService } from '../http.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * /users — relational data stored in PostgreSQL.
 * Validation failures answer 400 inline; dependency failures fall
 * through withService() as 503 service_unavailable.
 */
export function createUsersRouter(users) {
  const router = Router();

  router.post(
    '/',
    withService('postgresql', async (req, res) => {
      const { name, email } = req.body ?? {};
      if (typeof name !== 'string' || name.trim() === '') {
        return res
          .status(400)
          .json({ error: 'bad_request', message: 'name is required' });
      }
      if (typeof email !== 'string' || !EMAIL_PATTERN.test(email.trim())) {
        return res
          .status(400)
          .json({ error: 'bad_request', message: 'a valid email is required' });
      }
      const user = await users.create({
        name: name.trim(),
        email: email.trim().toLowerCase(),
      });
      return res.status(201).json(user);
    })
  );

  router.get(
    '/:id',
    withService('postgresql', async (req, res) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({
          error: 'bad_request',
          message: 'id must be a positive integer',
        });
      }
      const user = await users.get(id);
      if (!user) {
        return res
          .status(404)
          .json({ error: 'not_found', message: `user ${id} not found` });
      }
      return res.status(200).json(user);
    })
  );

  return router;
}
