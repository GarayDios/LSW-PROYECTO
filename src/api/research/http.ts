import type { ProviderStatus } from '../../cores/compartido/research-model.ts';

export type ResearchFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export class ResearchProviderError extends Error {
  readonly status: number | null;
  constructor(status: number | null, message: string) { super(message); this.name = 'ResearchProviderError'; this.status = status; }
}

/** Fixed provider URLs only; never include request URLs, keys or response bodies in errors. */
export async function researchJson(url: URL, headers: Record<string, string>, fetcher: ResearchFetch): Promise<unknown> {
  const body=await researchText(url,headers,fetcher);
  try{return JSON.parse(body) as unknown;}catch{throw new ResearchProviderError(null,'La respuesta del proveedor no es JSON válido.');}
}

export async function researchText(url: URL, headers: Record<string, string>, fetcher: ResearchFetch): Promise<string> {
  let response: Response;
  try {
    response = await fetcher(url, { headers: { Accept: 'application/json', ...headers }, redirect: 'manual', signal: AbortSignal.timeout(15_000) });
  } catch {
    throw new ResearchProviderError(null, 'No fue posible consultar el proveedor de datos.');
  }
  if (response.status >= 300 && response.status < 400) throw new ResearchProviderError(response.status, 'El proveedor intentó redirigir la consulta; no se reenviaron credenciales.');
  if (!response.ok) throw new ResearchProviderError(response.status,
    response.status === 401 || response.status === 403 ? 'El proveedor rechazó las credenciales o los permisos del feed.'
      : response.status === 429 ? 'El proveedor alcanzó su límite de consultas. Intenta más tarde.'
        : 'El proveedor devolvió un error al consultar datos.');
  try {
    const body = await response.text();
    if (body.length > 30_000_000) throw new Error('oversize');
    return body;
  } catch { throw new ResearchProviderError(null, 'No se pudo leer la respuesta del proveedor o excede el tamaño permitido.'); }
}

export function providerFailure(source: string, error: unknown): ProviderStatus {
  return { source, status: 'error', message: error instanceof ResearchProviderError ? error.message : 'No fue posible validar los datos del proveedor.' };
}

export { record, numeric, timestamp } from '../../cores/compartido/data-values.ts';

export function validateResearchRequest(symbol: string, asOf: string): void {
  if (!/^[A-Z][A-Z0-9.-]{0,14}$/.test(symbol)) throw new RangeError('El símbolo no es válido.');
  if (!Number.isFinite(Date.parse(asOf))) throw new RangeError('La fecha de decisión no es válida.');
}

export function nextToken(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= 8_000 ? value : null;
}
