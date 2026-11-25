import { getChatGPTUser } from '../../../src/api/auth/chatgpt-auth';
import { databaseEnvironment } from '../../../src/db/runtime';
import { createConnectionsHandler } from '../../../src/api/connections/handler';
export const dynamic = 'force-dynamic';
export const GET = createConnectionsHandler({ environment: databaseEnvironment, owner: getChatGPTUser });
