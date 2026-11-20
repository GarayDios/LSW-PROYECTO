# 5. Core de Indicadores y Señales de Compra y Venta

**Para explicarlo:** «El core técnico mide; este core interpreta esas mediciones
con reglas explícitas y produce compra, venta o espera».

`signals.ts` aplica el cruce SMA20/50 con filtro RSI14 opcional. Recibe los valores
calculados por el core técnico. También ofrece la regla opcional de confluencia
de medias, MACD, RSI y nuevas rupturas/cruces. `technical-events.ts` describe los
cruces MACD, extremos RSI y rupturas de niveles ya conocidos. Su prueba histórica ejecuta en la apertura
siguiente a la señal e incluye costes. `validation.ts` separa bloques temporales
de prueba y expresa la incertidumbre histórica. `comparison.ts` compara reglas
y empresas con parámetros comunes.

Las señales no envían órdenes. La consulta de datos está en `src/api/analysis/`
y las pantallas en `src/features/analysis/`.
