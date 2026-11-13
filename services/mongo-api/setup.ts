import { setupSnapshotCollection } from './indexes.ts';
import { mongoClientFromEnvironment } from './repository.ts';

try {
  const { client, databaseName } = mongoClientFromEnvironment();
  try {
    await client.connect();
    await setupSnapshotCollection(client.db(databaseName));
    console.log('Mongo snapshot collection, validation and indexes are ready.');
  } finally {
    await client.close();
  }
} catch {
  console.error('Mongo collection setup failed. Check configuration, database permissions and connectivity.');
  process.exitCode = 1;
}
