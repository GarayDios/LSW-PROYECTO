import {fileURLToPath} from 'node:url';
import {readLocalEnvironment} from './local-services.mjs';
import {createDevProcessSupervisor} from './dev-processes.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const {start,stop}=createDevProcessSupervisor({cwd:root,onExit:code=>{process.exitCode=code;}});
process.once('SIGINT',()=>stop());process.once('SIGTERM',()=>stop());
start(['services/trading-runner/server.ts'],readLocalEnvironment(root,['.env.local','.env.trading.local']),'El servicio de brókers');
