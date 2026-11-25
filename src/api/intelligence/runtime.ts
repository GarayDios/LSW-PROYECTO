import {getChatGPTUser} from '../auth/chatgpt-auth';
import {databaseEnvironment} from '../../db/runtime';
import {researchHandlers} from '../analysis/runtime';
import {createAssistantHandlers} from './handler';

export const assistantHandlers=createAssistantHandlers({environment:databaseEnvironment,owner:getChatGPTUser,research:researchHandlers.company});
