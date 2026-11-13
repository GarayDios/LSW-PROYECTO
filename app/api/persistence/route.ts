import { getChatGPTUser } from '../../../src/api/auth/chatgpt-auth';
import { createPersistenceHandlers } from '../../../src/api/persistence/handler';
import { readDatabaseConfig } from '../../../src/db/config';
import { databaseEnvironment } from '../../../src/db/runtime';

export const dynamic = 'force-dynamic';
const handlers = createPersistenceHandlers({
  config: () => readDatabaseConfig(databaseEnvironment()),
  owner: async () => {
    const user = await getChatGPTUser();
    return user ? { id: user.userId, displayName: user.displayName, email: user.email } : null;
  },
});
export const GET = handlers.GET;
export const PUT = handlers.PUT;
