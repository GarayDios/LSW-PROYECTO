import { getChatGPTUser } from '../auth/chatgpt-auth';
import { databaseEnvironment } from '../../db/runtime';
import { createResearchHandlers } from './handlers';
import { createComparisonHandler } from './comparison';

export const researchHandlers = createResearchHandlers({ environment: databaseEnvironment, owner: getChatGPTUser });
export const comparisonHandler = createComparisonHandler({ environment: databaseEnvironment, owner: getChatGPTUser });
