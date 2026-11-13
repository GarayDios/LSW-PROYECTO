export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status = 400) { super(message); this.code = code; this.status = status; }
}
export function privateJson(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie', 'X-Content-Type-Options': 'nosniff' } });
}
export function sameOrigin(request: Request): void {
  if (request.headers.get('Origin') !== new URL(request.url).origin || request.headers.get('Sec-Fetch-Site') === 'cross-site') throw new ApiError('origin_rejected', 'La solicitud debe proceder del propio terminal.', 403);
}
export async function smallJson(request: Request, limit = 16384): Promise<unknown> {
  if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new ApiError('invalid_content_type', 'Se requiere un cuerpo JSON.', 415);
  if (Number(request.headers.get('Content-Length')) > limit) throw new ApiError('body_too_large', 'La solicitud supera el tamaño permitido.', 413);
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError('invalid_body', 'Faltan los datos de la solicitud.');
  const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > limit) { await reader.cancel(); throw new ApiError('body_too_large', 'La solicitud supera el tamaño permitido.', 413); }
      chunks.push(part.value);
    }
    const buffer = new Uint8Array(bytes); let offset = 0;
    for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer));
  } catch (error) { if (error instanceof ApiError) throw error; throw new ApiError('invalid_body', 'El cuerpo JSON no es válido.'); }
  finally { reader.releaseLock(); }
}
