# 4. Core de Análisis Financiero (Fundamental)

**Para explicarlo:** «Este core estudia los ingresos, resultados, activos y pasivos
de una empresa. Calcula ratios solo si los hechos son comparables y ya estaban
publicados en la fecha del análisis».

`sec-fundamentals.ts` interpreta Company Facts de SEC EDGAR: ingresos y utilidad
anuales, activos, pasivos, efectivo, acciones, margen neto y pasivos/activos.
Además obtiene partidas para `fundamental-metrics.ts`, que ofrece 25 métricas
ampliadas posibles: flujo operativo/capex/flujo libre, liquidez, márgenes,
crecimiento anual, ROA/ROE con balances medios y múltiplos anuales con precio de
mercado. El panel conserva los faltantes e indica cobertura, fuentes y fechas.
Los múltiplos del ejercicio fiscal se distinguen de los TTM y de previsiones de
analistas. Pasivos/patrimonio no se presenta como deuda financiera/patrimonio.
La fecha de publicación se distingue del período contable. El adaptador
`src/api/research/sec.ts` resuelve ticker/CIK, hace las consultas y limita su ritmo.

`finviz-reference.ts` construye un enlace a la ficha pública de la empresa. Es una
referencia externa: no importa valores de Finviz ni requiere credenciales.
Como el usuario usa Finviz gratuito, se mantiene SEC como fuente del terminal.

Lee la [comparación de las fuentes](../../../docs/integraciones/sec-y-finviz.md)
para conocer las métricas adicionales y las opciones de integración oficial.
