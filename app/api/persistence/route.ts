import { getChatGPTUser } from '../../../src/api/auth/chatgpt-auth';
import { createPersistenceHandlers } from '../../../src/api/persistence/handler';
import { readSelectedDatabaseConfig } from '../../../src/db/config';
import { databaseEnvironment } from '../../../src/db/runtime';

export const dynamic = 'force-dynamic';
const handlers = createPersistenceHandlers({
  config: (request) => readSelectedDatabaseConfig(databaseEnvironment(), request ? new URL(request.url).searchParams.get('provider') : null),
  owner: async () => {
    const user = await getChatGPTUser();
    return user ? { id: user.userId, displayName: user.displayName, email: user.email } : null;
  },
});
export const GET = handlers.GET;
export const PUT = handlers.PUT;
