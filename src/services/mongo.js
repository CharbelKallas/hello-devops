import { MongoClient, ObjectId } from 'mongodb';

/**
 * MongoDB access for the `documents` collection.
 *
 * The MongoClient connects lazily on the first operation and uses a
 * short server-selection timeout, so an unavailable MongoDB surfaces
 * as a 503 within ~3 s instead of hanging. The database name is part
 * of the connection URI (MONGODB_URI).
 */
export function createMongoDocuments({ uri }) {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 3000 });
  const collection = client.db().collection('documents');

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
      const now = new Date();
      const result = await collection.insertOne({
        type,
        title,
        body,
        createdAt: now,
      });
      return {
        id: result.insertedId.toString(),
        type,
        title,
        body,
        createdAt: now.toISOString(),
      };
    },

    async get(id) {
      const doc = await collection.findOne({ _id: new ObjectId(id) });
      return doc ? toApi(doc) : null;
    },

    async ping() {
      await client.db().admin().command({ ping: 1 });
      return true;
    },

    async close() {
      await client.close();
    },
  };
}
