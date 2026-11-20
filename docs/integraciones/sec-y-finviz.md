# Fundamentales actuales y comparación con Finviz

Revisión del 20 de noviembre de 2026. El usuario utiliza **Finviz gratuito**.
Se comparan cobertura e integración, no cotizaciones numéricas de una empresa en
una misma instantánea. No se ha contratado Elite ni activado una API de Finviz.

## De dónde obtiene datos el terminal

El orquestador `src/api/research/company.ts` reúne fuentes distintas:

| Información | Fuente actual y código |
|---|---|
| Estados financieros y ratios contables | SEC EDGAR Company Facts y Submissions; `src/api/research/sec.ts` consulta y `src/cores/04-analisis-fundamental/sec-fundamentals.ts` interpreta. |
| Velas, cotización, opciones y noticias | Alpaca; adaptadores de `src/api/market/` y `src/api/research/alpaca.ts`. |
| Dividendos históricos y eventos recibidos | Contexto de mercado Alpaca, `src/api/research/market-context.ts`; el rendimiento continuo estimado conserva su procedencia. |
| Tasa, inflación y PIB | FRED/ALFRED en `src/api/research/fred.ts`; son contexto macro, no estados financieros de la empresa. |

El conector conserva **seis conceptos contables base**: ingresos anuales,
utilidad neta anual, activos, pasivos, efectivo y acciones en circulación, además
de margen neto y pasivos/activos. La ampliación incorpora partidas para **25
métricas posibles** de caja, liquidez, rentabilidad, crecimiento y valoración
anual. El contador del panel indica cuáles se pudieron calcular; no se rellenan
ausencias con cero. Conserva la fecha de publicación y no mezcla períodos
incompatibles para calcular un ratio.

Esta selección es una limitación de nuestro conector, no de todo el catálogo
disponible en SEC. La API oficial proporciona datos XBRL y presentaciones por
empresa, devuelve JSON y no exige una clave API para estas consultas de lectura.
[Documentación de SEC](https://www.sec.gov/search-filings/edgar-application-programming-interfaces).

## Qué aporta Finviz respecto al panel actual

| Área | Implementación actual | Cobertura adicional de Finviz |
|---|---|---|
| Valoración bursátil | Precio/EPS e ingresos del año fiscal, precio/patrimonio y rendimiento de flujo libre. No son TTM. | Múltiplos publicados, incluidos P/E TTM, Forward P/E y PEG. |
| Rentabilidad | Márgenes neto, bruto y operativo; ROA/ROE con balances medios cuando existen. | Ratios preparados, incluido ROIC; sus definiciones deben contrastarse. |
| Solvencia | Pasivos/activos, pasivos/patrimonio, razón corriente y prueba ácida. | Ratios preparados de liquidez y endeudamiento; no se equiparan automáticamente. |
| Crecimiento | Variación anual de ingresos/utilidad con base comparable positiva. | Métricas históricas y estimaciones futuras de EPS/ventas. |
| Accionistas y contexto bursátil | No incorpora estas métricas al fundamental. | Participación institucional e interna, short float y recomendación de analistas. |
| Períodos | Ingresos y utilidad anuales de hechos SEC seleccionados. | Combina métricas TTM, trimestrales, anuales y estimaciones según el campo. |

Los campos están descritos en la [ayuda oficial del screener](https://finviz.com/help/screener)
y pueden consultarse en la [ficha pública de una empresa, por ejemplo AAPL](https://finviz.com/stock?t=AAPL).
Finviz conserva ventajas en estimaciones, contexto bursátil y métricas
normalizadas. El terminal ya amplía los cálculos desde SEC, pero no acredita
equivalencia numérica con Finviz: difieren períodos, definiciones y fuentes.

## Qué cambia por utilizar Finviz gratuito

La ficha externa sirve para consultar y contrastar información. Ver datos en la
web no concede automáticamente acceso de API al terminal. La oferta oficial
Elite incluye exportaciones a CSV/Excel y prestaciones adicionales de datos y
estados financieros; su disponibilidad depende del plan.
[Prestaciones oficiales de Elite](https://finviz.com/elite).

Finviz sí dispone de una API oficial: su documentación pública de octubre de
2026 describe productos, token y flujos de exportación, con un límite compartido
de 10 solicitudes cada 5 segundos para cuentas Elite. Por tanto, no corresponde
afirmar que Finviz carece de API, ni prometer esa integración con una cuenta
gratuita. No se han verificado endpoints privados ni permisos de una cuenta del
usuario. [Anuncio oficial de API y exportación](https://finviz.com/blog/our-upgraded-api-higher-limits-clearer-data-and-more-ways-to-connect/).

## Decisión para esta revisión

Se mantiene SEC como fuente del fundamental y se añade un enlace a Finviz por
empresa en «Datos y variables del análisis». Abrir la ficha no importa valores,
no sustituye datos históricos y no cambia el ranking. No se implementa extracción
automática de HTML como sustituto de una API documentada.

La ampliación gratuita implementada extrae patrimonio, flujo operativo, capex,
EPS y conceptos adicionales. Los múltiplos usan precio de Alpaca y conservan la
etiqueta del año fiscal. Siguen pendientes TTM, comparadores sectoriales, deuda
financiera detallada y notas contables. Las previsiones de analistas requieren
otra fuente: no se deducen de un estado financiero presentado.

Con acceso autorizado a Elite podría añadirse un adaptador independiente en
`src/api/research/` que normalice las métricas para el core fundamental. Mantendría
fuente, fecha de consulta, período, condición reportada/estimada y unidades por
campo. La API disponible y sus permisos concretos deben comprobarse con la
documentación de esa cuenta antes de implementar el adaptador.

Para un backtest, los datos actuales de Finviz no se retrofechan como si ya fueran
conocidos. Antes de comparar un valor con SEC hay que comprobar empresa, período,
moneda, TTM frente a año fiscal, número de acciones y dato reportado frente a
estimación. Las discrepancias no se resuelven eligiendo el número más favorable.
