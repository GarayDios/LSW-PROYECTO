# 1. Core de Análisis Técnico

**Para explicarlo:** «Este core calcula indicadores que describen precio,
tendencia, volumen y volatilidad. Todavía no decide una compra o venta».

Recibe velas OHLCV válidas y ordenadas. `indicators.ts` calcula SMA20, SMA50,
RSI14, MACD12/26/9, ATR14 y volumen relativo contra las 20 velas anteriores.
`support-resistance.ts` confirma niveles con dos pivotes y los dibuja desde la
fecha en que pudieron conocerse. `market-analysis.ts` obtiene retornos, volatilidad histórica, volumen medio
y drawdown usando cierres diarios completos conocidos en el corte.

El core 5 consume los indicadores para producir señales; el core 2 consume los
datos históricos para su pronóstico. `trend.ts`, `volatility.ts` y `liquidity.ts`
conservan criterios del ranking de demostración, identificados como heurísticos.
Las velas se consultan en `src/api/market/`; la gráfica vive en
`src/features/market/`.

La [matriz de revisión](../../../docs/verificacion/estado-de-los-siete-cores.md)
explica el algoritmo de soportes y lo que sigue pendiente en los demás cores.
