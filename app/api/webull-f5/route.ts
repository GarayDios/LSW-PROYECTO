import {getChatGPTUser} from '../../../src/api/auth/chatgpt-auth';
import {databaseEnvironment} from '../../../src/db/runtime';
import {createF5Handlers} from '../../../src/api/f5/handlers';
const handlers=createF5Handlers({environment:databaseEnvironment,owner:getChatGPTUser,provider:'webull'});
export const dynamic='force-dynamic';
export const GET=handlers.get;
export const POST=handlers.post;
