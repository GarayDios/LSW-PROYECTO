import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readExecutionProfile } from './execution-profile.mjs';
import { readLocalEnvironment,localBrokerPort,isListening } from './local-services.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const children = new Set();
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) child.kill('SIGTERM');
}
function start(args, env, label) {
  const child = spawn(process.execPath, args, { cwd: root, env, stdio: 'inherit',windowsHide:true });
  children.add(child);
  child.once('error', () => { console.error(`No se pudo iniciar ${label}.`); stop(1); });
  child.once('exit', code => {
    children.delete(child);
    if (!stopping) {
      console.log(`${label} terminó. Se cierran los servicios de esta sesión.`);
      stop(code ?? 1);
    }
  });
}
process.once('SIGINT', () => stop());
process.once('SIGTERM', () => stop());

let frontendEnvironment=process.env;
if (readExecutionProfile() !== 'managed-linux') {
  const env=readLocalEnvironment(root,['.env.mongo.local','.env.local']);
  frontendEnvironment=env;
  if (env.MONGODB_URI && env.MONGO_BRIDGE_TOKEN) {
    const port=Number(env.MONGO_BRIDGE_PORT||8788);
    if(await isListening(port))console.log('Reutilizando el servicio MongoDB local.');
    else start(['services/mongo-api/server.ts'], env, 'El servicio MongoDB');
  } else {
    console.log('MongoDB sin configurar: se inicia la interfaz. Configura MONGODB_URI y MONGO_BRIDGE_TOKEN para iniciarlos juntos.');
  }
  const broker=localBrokerPort(env);
  if(broker){
    const serviceEnvironment=readLocalEnvironment(root,['.env.local','.env.trading.local']);
    if(await isListening(broker.port,broker.host))console.log('Reutilizando el servicio local de brókers.');
    else if(serviceEnvironment.BROKER_OWNER_USER_ID&&serviceEnvironment.TRADING_RUNNER_TOKEN===env.TRADING_RUNNER_TOKEN){
      console.log('Iniciando el servicio de brókers en modo manual.');
      start(['services/trading-runner/server.ts'],{...serviceEnvironment,TRADING_RUNNER_PORT:String(broker.port),TRADING_RUNNER_HOST:broker.host},'El servicio de brókers');
    }else console.log('Revisa el propietario y el token compartido del servicio de brókers.');
  }
}
start(['scripts/run-framework.mjs', 'dev', ...process.argv.slice(2)], frontendEnvironment, 'La interfaz');
