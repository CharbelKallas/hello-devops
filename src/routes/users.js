import { Router } from 'express';
import { withService } from '../http.js';
import { BadRequestError, NotFoundError } from '../errors.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LENGTH = 254; // RFC 5321 limit
// PostgreSQL TEXT cannot store U+0000, and no name or email needs it.
const NUL = '\u0000';

/**
 * /users — relational data stored in PostgreSQL.
 * Validation failures are thrown as 400/404 errors and dependency
 * failures as 503; withService() renders both.
 */
export function createUsersRouter(users) {
  const router = Router();

  router.post(
    '/',
    withService('postgresql', async (req, res) => {
      const { name, email } = req.body ?? {};
      if (typeof name !== 'string' || name.trim() === '' || name.includes(NUL)) {
        throw new BadRequestError('name is required');
      }
      if (
        typeof email !== 'string' ||
        email.trim().length > MAX_EMAIL_LENGTH ||
        email.includes(NUL) ||
        !EMAIL_PATTERN.test(email.trim())
      ) {
        throw new BadRequestError('a valid email is required');
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
        throw new BadRequestError('id must be a positive integer');
      }
      const user = await users.get(Number(req.params.id));
      if (!user) throw new NotFoundError(`user ${req.params.id} not found`);
      return res.status(200).json(user);
    })
  );

  return router;
}
