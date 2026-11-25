// Indicadores causales: SMA20/50, RSI14 de Wilder, MACD12/26/9, ATR14 y volumen relativo previo. Cada valor
// usa solo velas hasta su fecha.

// Importa únicamente tipos para comprobar estructuras en TypeScript; esta declaración no ejecuta lógica en
// tiempo de ejecución.
import type { Candle } from '../../features/market/chart-history.ts';

// Define la forma de los indicadores calculados para una vela; los valores aún no calculables se representan
// con null.
export type TechnicalIndicator = {
  // Guarda la fecha en milisegundos, la media rápida SMA20, la media lenta SMA50 y el RSI14.
  time: number; smaFast: number | null; smaSlow: number | null; rsi: number | null;
  // Guarda la línea MACD, su media de señal y la diferencia entre ambas, llamada histograma.
  macd: number | null; macdSignal: number | null; macdHistogram: number | null;
  // Guarda ATR14, volumen medio previo y volumen relativo; cada propiedad permite null durante la preparación.
  atr: number | null; averageVolume: number | null; relativeVolume: number | null;
// Cierra el bloque, objeto o declaración iniciado anteriormente.
};
// Fija las ventanas en 20 y 50 cierres para las medias simples y 14 variaciones para el RSI.
const FAST = 20, SLOW = 50, RSI_PERIOD = 14;

// Recibe velas de solo lectura y devuelve un indicador por vela. Procesa el pasado hacia el presente, sin
// anticipar datos.
export function calculateTechnicalIndicators(candles: readonly Candle[]): TechnicalIndicator[] {
  // Crea la lista de resultados; inicialmente ninguna vela tiene indicadores registrados.
  const indicators: TechnicalIndicator[] = [];
  // Inicializa sumas móviles de cierres y promedios de ganancias y pérdidas que necesita el RSI.
  let sumFast = 0, sumSlow = 0, averageGain = 0, averageLoss = 0;
  // Reserva las EMA de 12 y 26 cierres y la EMA de 9 valores MACD; null expresa que falta su período inicial.
  let ema12: number | null = null, ema26: number | null = null, ema9: number | null = null;
  // Prepara acumuladores para las primeras EMA, el MACD y el rango verdadero; ATR también empieza sin dato.
  let sum12 = 0, sum26 = 0, sumMacd = 0, macdCount = 0, atr: number | null = null, trueRangeSum = 0;
  // Acumula el volumen de las velas anteriores para comparar la actividad actual contra una base previa.
  let volumeSum = 0;
  // Recorre las velas cronológicamente; i es un índice que comienza en cero.
  for (let i = 0; i < candles.length; i++) {
    // Toma la vela actual para validar y calcular sus indicadores.
    const bar = candles[i];
    // Comienza la validación: fecha, precios y volumen deben ser números finitos, sin NaN ni infinito.
    if (![bar.time, bar.open, bar.high, bar.low, bar.close, bar.volume].every(Number.isFinite)
      // Rechaza precios no positivos y volumen negativo; volumen cero sí es un dato válido.
      || bar.low <= 0 || bar.open <= 0 || bar.close <= 0 || bar.volume < 0
      // Exige que el máximo y el mínimo contengan la apertura y el cierre de la vela.
      || bar.high < Math.max(bar.open, bar.close) || bar.low > Math.min(bar.open, bar.close)
      // Rechaza fechas repetidas o fuera de orden y detiene el cálculo con un error explícito.
      || (i > 0 && bar.time <= candles[i - 1].time)) throw new RangeError('Los indicadores requieren velas válidas, únicas y ordenadas.');
    // Usa el cierre actual como entrada de las medias y del RSI.
    const close = candles[i].close;
    // Acumula cierres para inicializar las medias exponenciales de 12 y 26 períodos.
    sum12 += close; sum26 += close;
    // Al llegar al cierre número 12, inicializa EMA12 con el promedio simple de esos 12 cierres.
    if (i === 11) ema12 = sum12 / 12;
    // Después actualiza EMA12 con alfa = 2/(12+1); ! afirma al compilador que la EMA ya fue inicializada.
    else if (i > 11) ema12 = close * (2 / 13) + ema12! * (1 - 2 / 13);
    // Al llegar al cierre número 26, inicializa EMA26 con el promedio simple de esos 26 cierres.
    if (i === 25) ema26 = sum26 / 26;
    // Después actualiza EMA26 con alfa = 2/(26+1), dando más peso al cierre reciente.
    else if (i > 25) ema26 = close * (2 / 27) + ema26! * (1 - 2 / 27);
    // Calcula MACD = EMA12 − EMA26 solamente cuando ambas medias existen.
    const macd = ema12 === null || ema26 === null ? null : ema12 - ema26;
    // Prepara la señal del MACD únicamente después de disponer de un MACD numérico.
    if (macd !== null) {
      // Cuenta los valores MACD disponibles y suma los iniciales para obtener su primera media.
      macdCount++; sumMacd += macd;
      // Inicializa la línea de señal con el promedio de los primeros nueve valores MACD.
      if (macdCount === 9) ema9 = sumMacd / 9;
      // Actualiza la señal mediante EMA9: alfa = 2/(9+1) = 0.2 y peso anterior = 0.8.
      else if (macdCount > 9) ema9 = macd * .2 + ema9! * .8;
    // Cierra el bloque, objeto o declaración iniciado anteriormente.
    }
    // En la primera vela el rango verdadero es máximo − mínimo; en las siguientes comienza la comparación de
    // tres recorridos.
    const trueRange = i === 0 ? candles[i].high - candles[i].low : Math.max(candles[i].high - candles[i].low,
      // Completa el rango verdadero con las distancias del máximo y del mínimo al cierre anterior, incluyendo los
      // saltos.
      Math.abs(candles[i].high - candles[i - 1].close), Math.abs(candles[i].low - candles[i - 1].close));
    // Suma rangos verdaderos para preparar la primera media ATR14.
    trueRangeSum += trueRange;
    // En la vela número 14 inicializa ATR con el promedio de los primeros 14 rangos verdaderos.
    if (i === 13) atr = trueRangeSum / 14;
    // Actualiza ATR con el suavizado de Wilder: (13 × ATR anterior + rango actual) / 14.
    else if (i > 13) atr = (atr! * 13 + trueRange) / 14;
    // Calcula el volumen medio de las 20 velas anteriores antes de agregar el volumen actual; así el pico no
    // altera su propia referencia.
    const averageVolume = i >= 20 ? volumeSum / 20 : null;
    // Divide el volumen actual entre el promedio previo; evita dividir por cero o usar una referencia aún
    // inexistente.
    const relativeVolume = averageVolume !== null && averageVolume > 0 ? candles[i].volume / averageVolume : null;
    // Agrega el volumen actual para que pueda participar en la referencia de la siguiente vela.
    volumeSum += candles[i].volume;
    // Retira el volumen que sale de la ventana móvil de 20 velas.
    if (i >= 20) volumeSum -= candles[i - 20].volume;
    // Incorpora el cierre actual a la suma que sostiene SMA20.
    sumFast += close;
    // Incorpora el mismo cierre a la suma independiente que sostiene SMA50.
    sumSlow += close;
    // Retira de la suma rápida el cierre que ya está fuera de sus 20 períodos.
    if (i >= FAST) sumFast -= candles[i - FAST].close;
    // Retira de la suma lenta el cierre que ya está fuera de sus 50 períodos.
    if (i >= SLOW) sumSlow -= candles[i - SLOW].close;
    // El RSI necesita comparar dos cierres; por eso omite la primera vela.
    if (i > 0) {
      // Calcula la variación absoluta de precio entre el cierre actual y el anterior.
      const difference = close - candles[i - 1].close;
      // Durante las primeras 14 variaciones prepara las medias iniciales de ganancias y pérdidas.
      if (i <= RSI_PERIOD) {
        // Suma al promedio inicial únicamente las subidas; una bajada aporta cero a esta suma.
        averageGain += Math.max(0, difference) / RSI_PERIOD;
        // Suma al promedio inicial la magnitud positiva de las bajadas; una subida aporta cero.
        averageLoss += Math.max(0, -difference) / RSI_PERIOD;
      // Cuando termina la preparación, continúa con los promedios suavizados de Wilder.
      } else {
        // Actualiza la ganancia media con 13 partes de historia y una de ganancia actual.
        averageGain = (averageGain * (RSI_PERIOD - 1) + Math.max(0, difference)) / RSI_PERIOD;
        // Actualiza de la misma forma la pérdida media usando la magnitud de la bajada actual.
        averageLoss = (averageLoss * (RSI_PERIOD - 1) + Math.max(0, -difference)) / RSI_PERIOD;
      // Cierra el bloque, objeto o declaración iniciado anteriormente.
      }
    // Cierra el bloque, objeto o declaración iniciado anteriormente.
    }
    // Devuelve null si faltan variaciones; usa RSI 50 sin movimientos, RSI 100 sin pérdidas y la fórmula
    // habitual en los demás casos.
    const rsi = i < RSI_PERIOD ? null : averageGain === 0 && averageLoss === 0 ? 50 : averageLoss === 0 ? 100 : 100 - 100 / (1 + averageGain / averageLoss);
    // Publica SMA20 = suma rápida / 20 después de tener 20 cierres; antes conserva null.
    const smaFast = i + 1 >= FAST ? sumFast / FAST : null;
    // Publica SMA50 = suma lenta / 50 después de tener 50 cierres; antes conserva null.
    const smaSlow = i + 1 >= SLOW ? sumSlow / SLOW : null;
    // Agrega el resultado de la vela actual con fecha, medias, RSI y MACD.
    indicators.push({ time: candles[i].time, smaFast, smaSlow, rsi, macd,
      // Añade la señal del MACD y el histograma = MACD − señal cuando ambos existen.
      macdSignal: ema9, macdHistogram: macd === null || ema9 === null ? null : macd - ema9,
      // Completa el resultado con ATR, volumen medio y volumen relativo.
      atr, averageVolume, relativeVolume });
  // Cierra el bloque, objeto o declaración iniciado anteriormente.
  }
  // Entrega los indicadores en el mismo orden cronológico de las velas de entrada.
  return indicators;
// Cierra el bloque, objeto o declaración iniciado anteriormente.
}
