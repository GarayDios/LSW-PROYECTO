import { getChatGPTUser } from '../../../src/api/auth/chatgpt-auth';
import { databaseEnvironment } from '../../../src/db/runtime';
import { createWebullHandlers } from '../../../src/api/brokers/webull/handlers';
const handlers=createWebullHandlers({environment:databaseEnvironment,owner:getChatGPTUser});
export const dynamic='force-dynamic';
export const GET=handlers.get;
export const POST=handlers.post;
