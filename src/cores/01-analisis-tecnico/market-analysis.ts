// Métricas de mercado a partir de una vela diaria por sesión conocida al corte. Se separan observación,
// disponibilidad y faltantes.

// Importa únicamente tipos para comprobar estructuras en TypeScript; esta declaración no ejecuta lógica en
// tiempo de ejecución.
import type { Candle } from '../../features/market/chart-history.ts';
// Importa los ayudantes y tipos compartidos que utiliza este archivo; sus nombres se emplean en las
// validaciones y cálculos descritos a continuación.
import { missingVariable, type ObservedMarket, type ResearchVariable } from '../compartido/research-model.ts';

// Expresa un día en milisegundos para calcular disponibilidad y antigüedad de las velas.
const DAY = 86_400_000;

// Construye métricas diarias para un símbolo y una fecha de corte; source identifica la procedencia que
// suministra el adaptador.
export function deriveObservedMarket(symbol: string, input: readonly Candle[], asOf: string, source = 'Alpaca · histórico diario'): ObservedMarket {
  // Convierte la fecha ISO del corte a milisegundos comparables con los tiempos de las velas.
  const cutoff = Date.parse(asOf);
  // Impide analizar con una fecha que no pueda interpretarse como instante válido.
  if (!Number.isFinite(cutoff)) throw new RangeError('La fecha de decisión no es válida.');
  // Crea un mapa por fecha para exigir una sola vela diaria por sesión.
  const daily = new Map<string, Candle>();
  // Inspecciona todas las velas recibidas antes de seleccionar las utilizables.
  for (const bar of input) {
    // Descarta entradas cuyos tiempos, precios o volumen no sean números finitos.
    if (![bar.time, bar.open, bar.high, bar.low, bar.close, bar.volume].every(Number.isFinite)
      // Completa el filtro de precios positivos y volumen no negativo.
      || bar.close <= 0 || bar.open <= 0 || bar.low <= 0 || bar.volume < 0
      // Descarta una vela si su máximo o mínimo contradicen la apertura o el cierre; continue pasa a la siguiente.
      || bar.high < Math.max(bar.open, bar.close) || bar.low > Math.min(bar.open, bar.close)) continue;
    // Comprueba además que el tiempo pueda convertirse a una fecha de JavaScript válida.
    if (!Number.isFinite(new Date(bar.time).getTime())) continue;
    // Obtiene la fecha UTC YYYY-MM-DD que servirá como clave diaria.
    const date = new Date(bar.time).toISOString().slice(0, 10);
    // Considera disponible esa vela a las 06:00 UTC del día siguiente, una espera conservadora tras el día de
    // Nueva York.
    const available = Date.parse(date) + DAY + 6 * 3_600_000;
    // Excluye tanto las velas futuras como las que aún no estaban disponibles en el instante de decisión.
    if (bar.time > cutoff || available > cutoff) continue;
    // Rechaza dos velas con la misma fecha: serían duplicados o datos intradía, incompatibles con esta HV
    // diaria.
    if (daily.has(date)) throw new RangeError('Los cálculos requieren una vela diaria por sesión.');
    // Guarda una copia de la vela válida para no modificar el objeto recibido.
    daily.set(date, { ...bar });
  // Cierra el bloque, objeto o declaración iniciado anteriormente.
  }
  // Extrae y ordena las velas admitidas desde la más antigua hasta la más reciente.
  const bars = [...daily.values()].sort((a, b) => a.time - b.time);
  // Obtiene la última vela; at(-1) devuelve undefined cuando la serie está vacía.
  const last = bars.at(-1);
  // Registra cuándo ocurrió la última observación, o null si no existe una vela.
  const observedAt = last ? new Date(last.time).toISOString() : null;
  // Registra por separado cuándo pudo conocerse ese cierre, usando la misma espera conservadora de las 06:00
  // UTC.
  const availableAt = last ? new Date(Date.parse(new Date(last.time).toISOString().slice(0, 10)) + DAY + 6 * 3_600_000).toISOString() : null;
  // Marca el histórico como desactualizado si han pasado más de siete días desde su disponibilidad.
  const stale = !!last && cutoff - Date.parse(availableAt!) > 7 * DAY;
  // Define un constructor de variables con valor, etiqueta, número mínimo de velas y clase de procedencia.
  const variable = (value: number | null, label: string, min: number, kind: 'observed' | 'estimated' = 'estimated'): ResearchVariable =>
    // Solo acepta un valor si hay suficientes velas y el resultado es numérico, finito y distinto de null.
    bars.length >= min && value !== null && Number.isFinite(value)
      // Cuando existe evidencia, conserva junto al valor su fuente, observación, disponibilidad y clase.
      ? { value, source: `${source} · ${label}`, observedAt, availableAt, kind }
      // Cuando falta evidencia, crea un faltante explícito e informa cuántas velas se necesitan; no introduce un
      // cero.
      : missingVariable(`${source} · ${label}`, `Se requieren al menos ${min} velas diarias cerradas.`);
  // Extrae todos los cierres de las velas diarias válidas.
  const closes = bars.map(bar => bar.close);
  // Calcula rendimientos logarítmicos consecutivos: ln(cierre actual / cierre anterior).
  const returns = closes.slice(1).map((value, i) => Math.log(value / closes[i]));
  // Limita la ventana estadística a los últimos 252 rendimientos, aproximadamente un año de sesiones.
  const window = returns.slice(-252);
  // Calcula la media de los rendimientos dentro de esa ventana.
  const mean = window.reduce((a, b) => a + b, 0) / window.length;
  // Calcula HV como desviación estándar muestral, con divisor n−1, y la anualiza multiplicando por raíz de
  // 252.
  const hv = Math.sqrt(window.reduce((sum, x) => sum + (x - mean) ** 2, 0) / (window.length - 1)) * Math.sqrt(252);
  // Calcula desviación bajista respecto a cero con los rendimientos negativos al cuadrado, divisor n y
  // anualización raíz de 252.
  const downside = Math.sqrt(window.reduce((sum, x) => sum + Math.min(0, x) ** 2, 0) / window.length) * Math.sqrt(252);
  // Toma hasta las últimas 20 velas para resumir volumen reciente, incluyendo el último cierre disponible.
  const recent = bars.slice(-20);
  // Promedia el volumen en acciones de esas velas; la salida exigirá una ventana completa de 20.
  const averageVolume = recent.reduce((sum, bar) => sum + bar.volume, 0) / recent.length;
  // Promedia volumen × cierre, una aproximación al importe negociado diario que no reconstruye cada operación.
  const dollarVolume = recent.reduce((sum, bar) => sum + bar.volume * bar.close, 0) / recent.length;
  // Inicializa el máximo de cierres observado durante el recorrido del drawdown.
  let peak = 0;
  // Inicializa la mayor caída relativa desde un máximo previo.
  let maxDrawdown = 0;
  // Recorre hasta 252 cierres; actualiza el máximo y conserva la mayor caída 1 − cierre / máximo previo.
  for (const close of closes.slice(-252)) { peak = Math.max(peak, close); maxDrawdown = Math.max(maxDrawdown, 1 - close / peak); }
  // Prepara las advertencias descriptivas sobre calidad y cobertura del histórico.
  const warnings: string[] = [];
  // Informa si el último cierre es demasiado antiguo para el corte solicitado.
  if (stale) warnings.push('El último cierre disponible tiene más de siete días de antigüedad respecto al corte.');
  // Advierte si faltan las 61 velas necesarias para cubrir todas las métricas, incluido el retorno de 60
  // sesiones.
  if (bars.length < 61) warnings.push('Histórico insuficiente para todas las métricas; no se rellenan con datos de demostración.');
  // Informa que se excluyeron entradas cuando la serie aceptada es menor que la recibida.
  if (bars.length && bars.length < input.length) warnings.push('Se excluyeron velas posteriores al corte, incompletas o inválidas.');
  // Comienza el objeto de mercado que consumirán los demás cores.
  return {
    // Incluye símbolo, velas aceptadas, cantidad de observaciones, estado de antigüedad y advertencias.
    symbol, bars, observations: bars.length, stale, warnings,
    // Publica el último cierre observado con un mínimo de una vela; este valor no es por sí solo una cotización
    // intradía.
    spot: variable(last?.close ?? null, 'último cierre', 1, 'observed'),
    // Publica HV como estimación histórica únicamente con al menos 31 cierres; HV no equivale a IV de opciones.
    historicalVolatility: variable(hv, 'HV: desviación muestral de retornos log diarios, anualizada √252 (máximo 252 sesiones)', 31),
    // Calcula el retorno simple de 20 sesiones; requiere 21 cierres para comparar los dos extremos.
    momentum20: variable(last && bars.length > 20 ? last.close / closes[closes.length - 21] - 1 : null, 'retorno de 20 sesiones', 21),
    // Calcula el retorno simple de 60 sesiones; requiere 61 cierres.
    momentum60: variable(last && bars.length > 60 ? last.close / closes[closes.length - 61] - 1 : null, 'retorno de 60 sesiones', 61),
    // Publica el volumen medio en acciones solo con 20 velas disponibles.
    averageVolume20: variable(averageVolume, 'volumen medio de 20 sesiones (acciones)', 20),
    // Publica la aproximación de volumen monetario medio con el mismo mínimo de 20 velas.
    averageDollarVolume20: variable(dollarVolume, 'volumen monetario medio de 20 sesiones (USD aproximados)', 20),
    // Publica la caída máxima como fracción, por ejemplo 0.20 representa 20%, con al menos 31 velas.
    maxDrawdown: variable(maxDrawdown, 'máximo drawdown de hasta 252 sesiones', 31),
    // Publica la medida de variación bajista anualizada con un mínimo de 31 velas.
    downsideVolatility: variable(downside, 'desviación bajista anualizada √252, umbral diario cero', 31),
  // Cierra el bloque, objeto o declaración iniciado anteriormente.
  };
// Cierra el bloque, objeto o declaración iniciado anteriormente.
}
