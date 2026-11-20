# 7. Core de Gestión y Optimización de Portafolio

**Para explicarlo:** «Este core registra las posiciones y movimientos de los
ciclos, y calcula cuánto capital y resultado tiene el portafolio de práctica».

`cycle-simulator.ts` contiene posiciones, efectivo, asignaciones, ejercicios,
cierres y escenarios. `cycleValue` valora cada ciclo y `accountSummary` agrega
patrimonio, resultados realizados/no realizados, capital comprometido y capital
disponible. Utiliza BSM del núcleo cuantitativo.

La gestión y contabilidad de práctica están implementadas. La optimización
conjunta de pesos, correlaciones y rebalanceos del portafolio sigue pendiente.
Las pantallas permanecen en `src/features/cycles/` y en el terminal.
