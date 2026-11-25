// Enlace público de referencia. Abrir la ficha no importa métricas ni autentica al usuario en Finviz.

// Construye un enlace de referencia a la ficha pública de una empresa, sin consultar ni importar datos de
// Finviz.
export function finvizCompanyUrl(symbol: string): string {
  // Admite símbolos de hasta 15 caracteres con el formato previsto y rechaza entradas ajenas a ese patrón.
  if (!/^[A-Z][A-Z0-9.-]{0,14}$/.test(symbol)) throw new RangeError('El símbolo no es válido.');
  // Parte de un destino fijo de Finviz para no permitir que el símbolo cambie el dominio.
  const url = new URL('https://finviz.com/stock');
  // Agrega el símbolo como parámetro t mediante URLSearchParams, que realiza la codificación necesaria.
  url.searchParams.set('t', symbol);
  // Entrega la URL completa que puede abrir la interfaz.
  return url.toString();
// Cierra el bloque, objeto o declaración iniciado anteriormente.
}
