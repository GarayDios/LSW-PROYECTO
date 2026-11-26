import { getChatGPTUser } from '../auth/chatgpt-auth';
import { databaseEnvironment } from '../../db/runtime';
import { createResearchHandlers } from './handlers';
import { createComparisonHandler } from './comparison';
import { createNewsHandler } from './news';
import researchFetch from 'virtual:local-research-fetch';

export const researchHandlers = createResearchHandlers({ environment: databaseEnvironment, owner: getChatGPTUser, fetcher: researchFetch });
export const comparisonHandler = createComparisonHandler({ environment: databaseEnvironment, owner: getChatGPTUser });
export const newsHandler = createNewsHandler({ environment: databaseEnvironment, owner: getChatGPTUser });
