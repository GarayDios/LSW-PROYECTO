import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';
import { readExecutionProfile } from './execution-profile.mjs';

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
  const child = spawn(process.execPath, args, { cwd: root, env, stdio: 'inherit' });
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

if (readExecutionProfile() !== 'managed-linux') {
  const values = {};
  // Retain compatibility with existing local setup; .env.local takes precedence.
  for (const name of ['.env.mongo.local', '.env.local']) {
    const path = new URL(`../${name}`, import.meta.url);
    if (existsSync(path)) {
      for (const [key, value] of Object.entries(parseEnv(readFileSync(path, 'utf8')))) {
        if (value.trim()) values[key] = value;
      }
    }
  }
  const env = { ...values, ...process.env };
  if (env.MONGODB_URI && env.MONGO_BRIDGE_TOKEN) {
    console.log('Iniciando interfaz y conexión MongoDB. Ctrl+C detiene ambos.');
    start(['services/mongo-api/server.ts'], env, 'El servicio MongoDB');
  } else {
    console.log('MongoDB sin configurar: se inicia la interfaz. Configura MONGODB_URI y MONGO_BRIDGE_TOKEN para iniciarlos juntos.');
  }
}
start(['scripts/run-framework.mjs', 'dev', ...process.argv.slice(2)], process.env, 'La interfaz');
