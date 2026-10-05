import { Router } from 'express';
import { withService } from '../http.js';

const OBJECT_ID_PATTERN = /^[0-9a-f]{24}$/i;

/**
 * /documents — document-oriented data stored in MongoDB.
 * The id syntax (24 hex chars) is validated here so the service can
 * assume a well-formed ObjectId.
 */
export function createDocumentsRouter(documents) {
  const router = Router();

  router.post(
    '/',
    withService('mongodb', async (req, res) => {
      const { type, title, body } = req.body ?? {};
      if (typeof title !== 'string' || title.trim() === '') {
        return res
          .status(400)
          .json({ error: 'bad_request', message: 'title is required' });
      }
      if (type !== undefined && typeof type !== 'string') {
        return res
          .status(400)
          .json({ error: 'bad_request', message: 'type must be a string' });
      }
      if (body !== undefined && typeof body !== 'string') {
        return res
          .status(400)
          .json({ error: 'bad_request', message: 'body must be a string' });
      }
      const doc = await documents.create({
        type: typeof type === 'string' && type.trim() !== '' ? type.trim() : 'note',
        title: title.trim(),
        body: typeof body === 'string' ? body : '',
      });
      return res.status(201).json(doc);
    })
  );

  router.get(
    '/:id',
    withService('mongodb', async (req, res) => {
      const { id } = req.params;
      if (!OBJECT_ID_PATTERN.test(id)) {
        return res.status(400).json({
          error: 'bad_request',
          message: 'id must be a 24-character hexadecimal MongoDB ObjectId',
        });
      }
      const doc = await documents.get(id);
      if (!doc) {
        return res
          .status(404)
          .json({ error: 'not_found', message: `document ${id} not found` });
      }
      return res.status(200).json(doc);
    })
  );

  return router;
}
