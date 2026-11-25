// Estructura causal: un pivote requiere velas a ambos lados y un nivel exige dos contactos. El precio queda
// anclado al primer pivote; el nivel se publica desde la segunda confirmación.

// Importa únicamente tipos para comprobar estructuras en TypeScript; esta declaración no ejecuta lógica en
// tiempo de ejecución.
import type { Candle } from '../../features/market/chart-history.ts';

// Describe un nivel de precio y la evidencia temporal con la que fue confirmado.
export type PriceLevel = {
  // Conserva un identificador, el tipo soporte/resistencia, el precio anclado y el número de contactos.
  id: string; kind: 'support' | 'resistance'; price: number; touches: number;
  // Distingue la fecha del primer pivote de la fecha en que el nivel llegó a estar confirmado.
  pivotAt: number; confirmedAt: number;
// Cierra el bloque, objeto o declaración iniciado anteriormente.
};
// Representa los niveles que podían conocerse en cada vela; null indica que aún no existe un nivel elegible.
export type StructurePoint = { time: number; support: PriceLevel | null; resistance: PriceLevel | null };
// Devuelve la serie causal completa, los niveles seleccionados al final y cuántas velas se esperan para
// confirmar un pivote.
export type SupportResistance = { points: StructurePoint[]; levels: PriceLevel[]; confirmationBars: number };

// Recibe velas ordenadas y un objeto opcional de configuración para detectar estructura de precio.
export function analyzeSupportResistance(bars: readonly Candle[], options: {
  // Permite configurar velas a cada lado del pivote, vigencia de candidatos y tolerancia entre contactos.
  pivotBars?: number; lookback?: number; tolerancePercent?: number;
// Usa un objeto vacío cuando no hay opciones y declara el tipo de resultado de la función.
} = {}): SupportResistance {
  // Por defecto exige dos velas a cada lado, vigencia de 150 velas y cercanía de 0.75% entre contactos.
  const width = options.pivotBars ?? 2, lookback = options.lookback ?? 150, tolerance = (options.tolerancePercent ?? .75) / 100;
  // Valida ventanas enteras y exige suficiente historial para contener ambos lados de un pivote.
  if (!Number.isInteger(width) || width < 1 || width > 10 || !Number.isInteger(lookback) || lookback < width * 2 + 1
    // Limita la tolerancia al intervalo (0,10%] y rechaza configuraciones inválidas.
    || !Number.isFinite(tolerance) || tolerance <= 0 || tolerance > .1) throw new RangeError('Parámetros de soportes y resistencias inválidos.');
  // Extiende el nivel con el índice del contacto más reciente, usado para retirar candidatos antiguos.
  type Candidate = PriceLevel & { lastIndex: number };
  // Inicializa los niveles candidatos; todavía pueden tener un solo contacto y no ser publicables.
  let candidates: Candidate[] = [];
  // Inicializa la historia de soportes y resistencias conocidos en cada instante.
  const points: StructurePoint[] = [];
  // Recorre el histórico en orden temporal para evitar dibujar niveles antes de su confirmación.
  for (let index = 0; index < bars.length; index++) {
    // Selecciona la vela actual, que también marca el instante máximo de información disponible.
    const bar = bars[index];
    // Valida fecha y precios finitos, mínimo positivo y cierre dentro del rango de la vela.
    if (![bar.time, bar.low, bar.high, bar.close].every(Number.isFinite) || bar.low <= 0 || bar.high < bar.low || bar.close < bar.low || bar.close > bar.high
      // Exige además tiempos estrictamente crecientes y detiene el análisis ante duplicados o desorden.
      || (index > 0 && bar.time <= bars[index - 1].time)) throw new RangeError('Las velas de estructura deben ser válidas, únicas y ordenadas.');
    // Retira candidatos que no han tenido un contacto dentro de la ventana de vigencia.
    candidates = candidates.filter(candidate => index - candidate.lastIndex <= lookback);
    // El posible pivote está width velas antes de la actual; las velas posteriores necesarias ya existen ahora.
    const pivot = index - width;
    // Solo evalúa el pivote cuando también hay suficientes velas a su izquierda.
    if (pivot >= width) {
      // Extrae la ventana que contiene las velas anteriores, el centro y las posteriores ya conocidas.
      const window = bars.slice(pivot - width, index + 1);
      // Obtiene la vela central que podría ser un mínimo o un máximo local.
      const center = bars[pivot];
      // Prepara los tipos de pivote que cumpla el centro.
      const kinds: PriceLevel['kind'][] = [];
      // Reconoce soporte si todos los otros mínimos de la ventana son estrictamente mayores que el mínimo central.
      if (window.every((value, offset) => offset === width || value.low > center.low)) kinds.push('support');
      // Reconoce resistencia si todos los otros máximos son estrictamente menores que el máximo central.
      if (window.every((value, offset) => offset === width || value.high < center.high)) kinds.push('resistance');
      // Procesa cada tipo de pivote confirmado en esta ventana.
      for (const kind of kinds) {
        // Usa el mínimo central para soporte y el máximo central para resistencia.
        const price = kind === 'support' ? center.low : center.high;
        // Busca candidatos del mismo tipo cuya diferencia relativa de precio esté dentro de la tolerancia.
        const existing = candidates.filter(candidate => candidate.kind === kind && Math.abs(candidate.price / price - 1) <= tolerance)
          // Si hay varios candidatos cercanos, escoge el de menor distancia absoluta al nuevo precio.
          .sort((a, b) => Math.abs(a.price - price) - Math.abs(b.price - price))[0];
        // Cuando encuentra un nivel compatible, añade evidencia al candidato existente.
        if (existing) {
          // Incrementa los contactos y actualiza su última aparición sin desplazar el precio original.
          existing.touches++; existing.lastIndex = index;
          // Solo al segundo contacto fija la fecha pública de confirmación del nivel en la vela actual.
          if (existing.touches === 2) existing.confirmedAt = bar.time;
        // Si no hay candidato, crea uno con un contacto y un identificador basado en tipo y fecha del primer pivote.
        } else candidates.push({ id: `${kind}-${center.time}`, kind, price, touches: 1,
          // Registra las fechas y el último índice del candidato; con un solo contacto todavía no será visible como
          // nivel confirmado.
          pivotAt: center.time, confirmedAt: bar.time, lastIndex: index });
      // Cierra el bloque, objeto o declaración iniciado anteriormente.
      }
    // Cierra el bloque, objeto o declaración iniciado anteriormente.
    }
    // Selecciona únicamente candidatos con dos o más contactos confirmados.
    const active = candidates.filter(candidate => candidate.touches >= 2);
    // Define una copia pública del candidato, para no alterar retrospectivamente los puntos ya calculados.
    const snapshot = (candidate: Candidate | undefined): PriceLevel | null => candidate ? {
      // Copia identidad, tipo, precio y cantidad de contactos del nivel en este instante.
      id: candidate.id, kind: candidate.kind, price: candidate.price, touches: candidate.touches,
      // Copia la fecha del pivote original y la fecha efectiva de confirmación.
      pivotAt: candidate.pivotAt, confirmedAt: candidate.confirmedAt,
    // Devuelve null cuando no existe candidato, conservando el faltante como tal.
    } : null;
    // Añade el punto temporal de estructura correspondiente a la vela actual.
    points.push({ time: bar.time,
      // Elige el soporte confirmado más alto que no supere el cierre actual: el más cercano por debajo.
      support: snapshot(active.filter(candidate => candidate.kind === 'support' && candidate.price <= bar.close).sort((a, b) => b.price - a.price)[0]),
      // Elige la resistencia confirmada más baja que no quede debajo del cierre: la más cercana por encima.
      resistance: snapshot(active.filter(candidate => candidate.kind === 'resistance' && candidate.price >= bar.close).sort((a, b) => a.price - b.price)[0]),
    // Cierra el bloque, objeto o declaración iniciado anteriormente.
    });
  // Cierra el bloque, objeto o declaración iniciado anteriormente.
  }
  // Obtiene el último cierre; usa cero únicamente como referencia interna si no existen velas.
  const close = bars.at(-1)?.close ?? 0;
  // Construye la selección final de niveles para mostrar en la gráfica.
  const selected = [
    // Conserva hasta dos soportes confirmados por debajo del último cierre, empezando por el más cercano.
    ...candidates.filter(candidate => candidate.touches >= 2 && candidate.kind === 'support' && candidate.price <= close).sort((a, b) => b.price - a.price).slice(0, 2),
    // Conserva hasta dos resistencias confirmadas por encima del último cierre, empezando por la más cercana.
    ...candidates.filter(candidate => candidate.touches >= 2 && candidate.kind === 'resistance' && candidate.price >= close).sort((a, b) => a.price - b.price).slice(0, 2),
  // Cierra la lista de elementos definida en las líneas anteriores.
  ];
  // Devuelve los puntos históricos, copias de los niveles finales y el retraso de confirmación configurado.
  return { points, levels: selected.map(({ id, kind, price, touches, pivotAt, confirmedAt }) => ({ id, kind, price, touches, pivotAt, confirmedAt })), confirmationBars: width };
// Cierra el bloque, objeto o declaración iniciado anteriormente.
}
