# Contratos y utilidades compartidas

`research-model.ts` define las variables con valor, fuente, fecha de observación,
fecha de disponibilidad y condición observada/estimada/ausente/supuesta.
`data-values.ts` valida y normaliza valores básicos sin consultar proveedores.
`types.ts` define opciones, estrategias y los criterios históricos del ranking.

`CoreId` y `CORE_IDS` son nombres históricos de esos criterios conservados para
las listas guardadas y contratos existentes. Los siete cores funcionales tienen
el tipo `FunctionalCoreId` y el catálogo `FUNCTIONAL_CORES` en `../catalog.ts`.
