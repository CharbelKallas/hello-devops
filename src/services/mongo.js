import { MongoClient, ObjectId } from 'mongodb';
import { callService } from '../errors.js';

const SERVICE = 'mongodb';
const OPERATION_TIMEOUT_MS = 5000;

/**
 * MongoDB access for the `documents` collection.
 *
 * The client connects on first use. If that FIRST connection fails, the
 * driver closes the client for good ("Topology is closed") and it would
 * never recover — so a failed client is discarded and the next request
 * starts a fresh one. Once connected, the driver's own monitoring
 * handles later outages and reconnects by itself.
 *
 * A short server-selection timeout plus a per-operation deadline make
 * an unavailable MongoDB surface as a 503 within a few seconds instead
 * of hanging. The database name is part of the connection URI
 * (MONGODB_URI).
 */
export function createMongoDocuments({ uri }) {
  let connecting = null;
  let closed = false;

  function connect() {
    if (closed) return Promise.reject(new Error('client closed'));
    if (!connecting) {
      const client = new MongoClient(uri, { serverSelectionTimeoutMS: 3000 });
      connecting = client.connect().catch(async (err) => {
        connecting = null;
        await client.close().catch(() => {});
        throw err;
      });
    }
    return connecting;
  }

  function run(operation) {
    return callService(
      SERVICE,
      () => connect().then((client) => operation(client.db())),
      OPERATION_TIMEOUT_MS
    );
  }

  function toApi(doc) {
    return {
      id: doc._id.toString(),
      type: doc.type,
      title: doc.title,
      body: doc.body,
      createdAt:
        doc.createdAt instanceof Date ? doc.createdAt.toISOString() : doc.createdAt,
    };
  }

  return {
    async create({ type, title, body }) {
      const doc = { type, title, body, createdAt: new Date() };
      const result = await run((db) => db.collection('documents').insertOne(doc));
      return toApi({ ...doc, _id: result.insertedId });
    },

    async get(id) {
      // The router has already validated `id` as 24 hex characters.
      const _id = new ObjectId(id);
      const doc = await run((db) => db.collection('documents').findOne({ _id }));
      return doc ? toApi(doc) : null;
    },

    async ping() {
      await run((db) => db.admin().command({ ping: 1 }));
      return true;
    },

    async close() {
      closed = true;
      const pending = connecting;
      connecting = null;
      if (!pending) return;
      const client = await pending.catch(() => null);
      if (client) await client.close();
    },
  };
}
