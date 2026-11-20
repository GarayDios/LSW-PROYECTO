import { spawn } from 'node:child_process';

/** Auxiliary service failures must not take down the terminal's HTTP server. */
export function createDevProcessSupervisor({ cwd, onExit, log = console.log, warn = console.error, stdio = 'inherit' }) {
  const children = new Set();
  let stopping = false;
  function stop(code = 0) {
    if (stopping) return;
    stopping = true;
    for (const child of children) child.kill('SIGTERM');
    onExit(code);
  }
  /** @returns {import('node:child_process').ChildProcess} */
  function start(args, env, label, { required = true } = {}) {
    const child = spawn(process.execPath, args, { cwd, env, stdio, windowsHide: true });
    children.add(child);
    const ended = (code, failedToStart = false) => {
      children.delete(child);
      if (stopping) return;
      if (required) {
        log(`${label} ${failedToStart ? 'no pudo iniciarse' : 'terminó'}. Se cierran los servicios de esta sesión.`);
        stop(code ?? 1);
      } else {
        warn(`${label} ${failedToStart ? 'no pudo iniciarse' : 'terminó'}. El terminal sigue disponible; las funciones de ese servicio requieren revisar su configuración y conectividad.`);
      }
    };
    child.once('error', () => ended(1, true));
    child.once('exit', code => ended(code));
    return child;
  }
  return { start, stop };
}
