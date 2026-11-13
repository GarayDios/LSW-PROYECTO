import { MongoClient, MongoServerError, type Collection, type Db } from 'mongodb';
import { SNAPSHOT_COLLECTION } from './indexes.ts';
import { sameSnapshot, SnapshotConflictError, type Snapshot, type SnapshotInput, type SnapshotMetadata, type SnapshotRepository } from './model.ts';

type SnapshotDocument = Omit<Snapshot, 'id' | 'createdAt'> & { _id: string; createdAt: Date };

function toSnapshot(document: SnapshotDocument): Snapshot {
  const { _id, createdAt, ...rest } = document;
  return { ...rest, id: _id, createdAt: createdAt.toISOString() };
}

export function createMongoRepository(database: Db, collectionName = SNAPSHOT_COLLECTION): SnapshotRepository {
  const collection: Collection<SnapshotDocument> = database.collection(collectionName);
  return {
    async put(snapshot) {
      const { id, createdAt, ...rest } = snapshot;
      const document: SnapshotDocument = { ...rest, _id: id, schemaVersion: 1, createdAt: new Date(createdAt) };
      try {
        const result = await collection.updateOne({ _id: id }, { $setOnInsert: document }, { upsert: true });
        if (result.upsertedCount === 1) return 'created';
      } catch (error) {
        if (error instanceof MongoServerError && error.code === 11000) {
          // A concurrent retry may have inserted the same immutable snapshot.
          const existing = await collection.findOne({ _id: id });
          if (existing && sameSnapshot(toSnapshot(existing), snapshot)) return 'existing';
          throw new SnapshotConflictError();
        }
        throw error;
      }
      const existing = await collection.findOne({ _id: id });
      if (!existing || !sameSnapshot(toSnapshot(existing), snapshot)) throw new SnapshotConflictError();
      return 'existing';
    },
    async list(ownerId, limit) {
      const documents = await collection.find({ ownerId }, { projection: { state: 0 } }).sort({ revision: -1 }).limit(limit).toArray();
      return documents.map(document => {
        const { _id, createdAt, revision, schemaVersion } = document;
        return { id: _id, ownerId, revision, schemaVersion, createdAt: createdAt.toISOString() } satisfies SnapshotMetadata;
      });
    },
    async get(ownerId, id) {
      const document = await collection.findOne({ _id: id, ownerId });
      return document ? toSnapshot(document) : null;
    },
  };
}

export function mongoClientFromEnvironment(environment: NodeJS.ProcessEnv = process.env): { client: MongoClient; databaseName: string } {
  const uri = environment.MONGODB_URI;
  const databaseName = environment.MONGODB_DATABASE;
  if (!uri || !/^mongodb(?:\+srv)?:\/\//.test(uri) || !databaseName || !/^[a-zA-Z0-9_-]{1,64}$/.test(databaseName)) {
    throw new Error('Configure MONGODB_URI and MONGODB_DATABASE.');
  }
  // One pool per service process, shared by requests. Bounded waits also keep
  // failures from monopolizing all HTTP handlers when the database is offline.
  const client = new MongoClient(uri, { maxPoolSize: 10, minPoolSize: 0, serverSelectionTimeoutMS: 5000, waitQueueTimeoutMS: 5000 });
  return { client, databaseName };
}
