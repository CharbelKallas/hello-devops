import { Router } from 'express';
import { withService } from '../http.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LENGTH = 254; // RFC 5321 limit
// PostgreSQL TEXT cannot store U+0000, and no name or email needs it.
const NUL = '\u0000';
// users.id is a PostgreSQL SERIAL (int4): larger ids cannot exist.
const MAX_USER_ID = 2_147_483_647;

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
      if (typeof name !== 'string' || name.trim() === '' || name.includes(NUL)) {
        return res
          .status(400)
          .json({ error: 'bad_request', message: 'name is required' });
      }
      if (
        typeof email !== 'string' ||
        email.trim().length > MAX_EMAIL_LENGTH ||
        email.includes(NUL) ||
        !EMAIL_PATTERN.test(email.trim())
      ) {
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
      // Plain decimal digits only: Number() would also accept
      // "1e3", "0x10" or " 7 ".
      if (!/^[1-9][0-9]*$/.test(req.params.id)) {
        return res.status(400).json({
          error: 'bad_request',
          message: 'id must be a positive integer',
        });
      }
      const id = Number(req.params.id);
      const user = id <= MAX_USER_ID ? await users.get(id) : null;
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
