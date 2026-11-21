import { simulateMonteCarlo, type MonteCarloRequest, type MonteCarloResult } from '../../cores/nucleo-cuantitativo/monte-carlo';

export type MonteCarloReply = { result: MonteCarloResult; error?: never } | { result?: never; error: string };
const scope = globalThis as unknown as {
  onmessage: (event: MessageEvent<MonteCarloRequest>) => void;
  postMessage: (reply: MonteCarloReply) => void;
};
scope.onmessage = event => {
  try { scope.postMessage({ result: simulateMonteCarlo(event.data) }); }
  catch (error) { scope.postMessage({ error: error instanceof Error ? error.message : 'No se pudo completar la simulación.' }); }
};
