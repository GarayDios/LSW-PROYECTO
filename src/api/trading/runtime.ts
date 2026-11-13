import { getChatGPTUser } from '../auth/chatgpt-auth';
import { databaseEnvironment } from '../../db/runtime';
import { createTradingHandlers } from './handlers';

export const tradingHandlers = createTradingHandlers({ environment: databaseEnvironment, owner: getChatGPTUser });
