import { getChatGPTUser } from '../auth/chatgpt-auth';
import { databaseEnvironment } from '../../db/runtime';
import { createF5Handlers } from './handlers';

export const f5Handlers = createF5Handlers({ environment: databaseEnvironment, owner: getChatGPTUser });
