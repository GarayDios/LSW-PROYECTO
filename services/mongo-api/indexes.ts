import type { Db } from 'mongodb';

export const SNAPSHOT_COLLECTION = 'analysis_snapshots';

export const snapshotValidator = {
  $jsonSchema: {
    bsonType: 'object',
    required: ['_id', 'ownerId', 'revision', 'schemaVersion', 'state', 'createdAt'],
    additionalProperties: false,
    properties: {
      _id: { bsonType: 'string', pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' },
      ownerId: { bsonType: 'string', minLength: 1, maxLength: 256 },
      revision: { bsonType: ['int', 'long', 'double'], minimum: 1, maximum: Number.MAX_SAFE_INTEGER, multipleOf: 1 },
      schemaVersion: { enum: [1] },
      createdAt: { bsonType: 'date' },
      state: {
        bsonType: 'object', required: ['lists', 'orders', 'cycles', 'rate'], additionalProperties: false,
        properties: {
          lists: { bsonType: 'array', maxItems: 200, items: { bsonType: 'object' } },
          orders: { bsonType: 'array', maxItems: 5000, items: { bsonType: 'object' } },
          cycles: { bsonType: 'array', maxItems: 200, items: { bsonType: 'object' } },
          rate: { bsonType: ['int', 'long', 'double', 'decimal'], minimum: 0, maximum: 0.25 },
        },
      },
    },
  },
};

/** Explicit setup step. Request handling never changes collections or indexes. */
export async function setupSnapshotCollection(database: Db, collectionName = SNAPSHOT_COLLECTION): Promise<void> {
  const exists = await database.listCollections({ name: collectionName }, { nameOnly: true }).hasNext();
  if (!exists) {
    await database.createCollection(collectionName, { validator: snapshotValidator, validationLevel: 'strict', validationAction: 'error' });
  } else {
    await database.command({ collMod: collectionName, validator: snapshotValidator, validationLevel: 'strict', validationAction: 'error' });
  }
  await database.collection(collectionName).createIndexes([
    { key: { ownerId: 1, revision: 1 }, unique: true, name: 'owner_revision_unique' },
    { key: { ownerId: 1, createdAt: -1 }, name: 'owner_created_at' },
  ]);
}
