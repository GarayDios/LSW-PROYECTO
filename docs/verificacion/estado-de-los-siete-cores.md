# Revisión funcional de los siete cores

Revisión del 20 de noviembre de 2026. Esta matriz distingue lo implementado,
lo verificado con datos controlados y lo que aún necesita desarrollo o evidencia.
La reorganización de carpetas por sí sola no demuestra que un core esté completo.

## La gráfica indicada por el profesor

| Elemento de la referencia | Core responsable | Estado del terminal |
|---|---|---|
| Velas y volumen | Datos de mercado + core 1 | Existían; ahora el volumen tiene interruptor independiente. |
| Medias 20/50 y RSI14 | Core 1: Técnico | Existían los cálculos; ahora RSI tiene un panel propio visible. |
| MACD12/26/9 y su histograma | Core 1: Técnico | Implementados con EMA inicializada por SMA y calentamiento explícito. |
| Soportes y resistencias automáticos | Core 1: Técnico | Implementados con pivotes confirmados; se mantienen los niveles manuales. |
| Flechas y texto COMPRA/VENTA | Core 5: Señales | Se conservan las reglas SMA/RSI y se añade confluencia opcional. |
| Diamantes MACD/RSI y rupturas | Core 5: Señales | Eventos explicables; no son órdenes ni probabilidades de beneficio. |
| Riesgo de una entrada | Core 6 + núcleo cuantitativo | Los límites existentes del servicio siguen aplicándose antes de operar. |
| Marcadores de noticias y calendario | Cores 3 y 4 + sus adaptadores | Hay titulares y fechas de publicación; una cronología completa de eventos sigue pendiente. No se inventa la fecha de resultados a partir del cierre fiscal. |
| Actividad inusual de opciones | Datos específicos + análisis técnico/cuantitativo | Sigue pendiente un proveedor y una definición verificable; una cadena o el interés abierto no prueban flujo inusual. |
| Entrada «comprar call» con strike y delta | Estrategias F5 + núcleo cuantitativo + core 6 | Requiere contrato real, permisos y revisión. Una flecha sobre la acción no se convierte automáticamente en una orden de opciones. |

## Requisitos por core

| Core | Funciona actualmente | Qué falta para ampliar su alcance |
|---|---|---|
| 1. Técnico | OHLCV validado, SMA20/50, RSI14, MACD12/26/9, ATR14, volumen relativo y soportes/resistencias causales. | Calibración revisable de parámetros por mercado/intervalo, control más completo de sesiones y huecos, y comparaciones con otra implementación. Los niveles son una regla reproducible, no una garantía de rebote. |
| 2. IA | kNN experimental, preferencias, validación cronológica, comparación con referencias y resultado de espera si no cumple los criterios. | Evaluación con muestras reales fuera de desarrollo, calibración de incertidumbre, seguimiento de degradación, versionado del modelo y perfil persistente por usuario. El ajuste de estrategias no está validado como optimización de beneficio. |
| 3. Noticias | Titulares por empresa, fuente, fecha de creación y revisión, exclusión de revisiones futuras y deduplicación del adaptador. | Clasificación de eventos con evidencia, relevancia por empresa, tratamiento de noticias repetidas entre proveedores, cobertura histórica y evaluación de un modelo de sentimiento si se desea. No asignar compra/venta solo por palabras positivas o negativas. |
| 4. Fundamental | Seis conceptos base, dos ratios previos y 25 métricas ampliadas posibles: caja, capex, liquidez, márgenes, crecimiento, ROA/ROE y múltiplos anuales. Fecha de publicación y períodos comparables. | Series TTM bien reconstruidas, deuda financiera/intereses, comparadores sectoriales, notas contables, reclasificaciones, cobertura IFRS y valoración por escenarios con supuestos explícitos. Finviz gratuito permanece como consulta externa. |
| 5. Señales | Reglas SMA/RSI y confluencia con MACD/rupturas; señales explicadas al cierre; ejecución simulada en apertura siguiente, costes y validación por ventanas. | Investigación fuera de muestra de cada regla, sensibilidad de costes, definición y verificación de reglas adicionales del profesor. No presentar el backtest como una predicción o un permiso de envío. |
| 6. Riesgos | Exposición bruta, primas, delta, pérdida diaria, capital por ciclo, pausas y bloqueo por datos inciertos. Reconcilia reservas y órdenes del servicio. | Escenarios conjuntos con IV/tasa/dividendos, concentración sectorial, liquidez en estrés y margen confirmado por bróker. ATR no se convierte automáticamente en una pérdida máxima garantizada. |
| 7. Portafolio | Ledger de ciclos, posiciones, efectivo, asignaciones, patrimonio, capital disponible y resultados realizados/no realizados. | Consolidación completa de cuentas/activos, matriz de covarianzas con fechas alineadas, objetivo y restricciones de asignación, costes de rebalanceo y validación del optimizador. No hay optimizador conjunto implementado. |

Los cores 2, 3 y 7 no pasan a considerarse predictivos u optimizadores completos
porque la interfaz muestre sus nombres. En riesgo se conserva el control del
servicio: los nuevos controles gráficos no cambian permisos ni envían órdenes.

## Decisiones técnicas implementadas

Los niveles usan dos velas a cada lado del pivote y al menos dos pivotes cercanos
para confirmar una línea. La tolerancia predeterminada es 0.75% y la vigencia se
cuenta desde el último contacto confirmado, hasta 150 velas. El precio queda
anclado al primer pivote; los contactos posteriores no lo desplazan. La línea
empieza en la segunda confirmación, nunca se retrotrae al pivote inicial.
Las series guardan el estado conocido en cada vela para evitar repintar señales.

La confluencia compra cuando hay un nuevo cruce alcista MACD/medias o ruptura,
SMA20 supera SMA50, el histograma MACD es positivo y RSI está entre 35 y 70.
La salida requiere un nuevo cruce/ruptura bajista y MACD negativo o tendencia
SMA bajista. RSI extremo por sí solo es una observación. Estas reglas no se han
seleccionado por rentabilidad en un histórico real.

Los indicadores se calculan sobre las velas originales. En diario, las señales
y estudios excluyen la fecha actual todavía no cerrada con la convención
conservadora del terminal. Las vistas de 3/6 meses recortan el dibujo; conservan
el rango usado por el análisis, la validación y el CSV. Los indicadores visuales
intradía describen el intervalo cargado; las reglas ejecutables de este panel
siguen siendo diarias. Las etiquetas se espacian sin eliminar los registros.

El fundamental calcula CFO menos inversión en propiedad/equipo solo cuando ambos
son del mismo ejercicio. ROA y ROE utilizan los balances de apertura y cierre del
mismo año de la utilidad. Crecimiento exige una base anterior positiva y un año
comparable. Un denominador negativo/cero, un dato ausente, una publicación futura
o un período incompatible impide publicar el ratio. Los múltiplos precio/EPS y
precio/ventas se etiquetan como anuales, no TTM. Las fechas de los períodos
contables se muestran como fechas de calendario, sin desplazarlas al día anterior
por convertir medianoche UTC a Nueva York; la disponibilidad conserva su hora.

## Criterios para la revisión

1. Mostrar `src/cores/README.md` y distinguir los siete cores del núcleo matemático.
2. Activar/desactivar medias, RSI, MACD, volumen y soportes de forma independiente.
3. Elegir «Confluencia» en «Habilitar indicadores y dibujar niveles» y consultar
   el motivo de cada marca y su validación histórica.
4. Elegir «6 meses» o «3 meses» en Vista y comprobar que el CSV y los cálculos
   conservan el rango cargado.
5. Abrir «Ver datos y herramientas avanzadas» → «Análisis fundamental ampliado»
   y comprobar fuente, fechas y campos faltantes; el contador no se rellena con cero.
6. Mostrar una prueba de causalidad y una de períodos contables incompatibles.

`npm test`, `npm run typecheck` y `npm run build` comprueban los módulos.
`npm run test:browser -- technical` comprueba capas, marcas, cambios de vista,
confluencia, 25 métricas de una fixture y ancho móvil, sin órdenes ni escrituras
remotas. Las pruebas de navegador no acreditan una conexión real a Finviz,
rentabilidad ni actividad real de opciones. Capturas: `outputs/technical-desktop.png`
y `outputs/technical-mobile.png`.

Referencias: [MACD de Fidelity](https://www.fidelity.com/webcontent/ap002390-mlo-content/19.09/help/help_definition_m.shtml),
[ATR de thinkorswim](https://toslc.thinkorswim.com/center/reference/Tech-Indicators/studies-library/A-B/ATR.html)
y [estados financieros de SEC](https://www.sec.gov/about/reports-publications/beginners-guide-financial-statements).
