import type { CoreId } from '../compartido/types.ts';

export const cores: { id: CoreId; title: string; subtitle: string }[] = [
  { id: 'bsm', title: 'Black–Scholes–Merton', subtitle: 'Valor teórico de la opción' },
  { id: 'greeks', title: 'Griegas', subtitle: 'Delta, Gamma, Theta y Vega' },
  { id: 'probability', title: 'Equilibrio y probabilidad', subtitle: 'Umbral y probabilidad teórica' },
  { id: 'volatility', title: 'Volatilidad', subtitle: 'Banda ilustrativa ±1σ usando IV anualizada' },
  { id: 'trend', title: 'Tendencia', subtitle: 'Medias móviles de 20 y 50 velas; ranking con cambio demo' },
  { id: 'liquidity', title: 'Liquidez y volumen', subtitle: 'Volumen sintético por vela y liquidez de muestra' },
  { id: 'risk', title: 'Riesgo', subtitle: 'Escenario de caída de 2σ; no es VaR ni margen' },
];
