# Núcleo cuantitativo y siete cores funcionales

La definición confirmada por el usuario separa el núcleo cuantitativo de los
siete cores. Sustituye la ampliación anterior que trataba BSM, griegas,
probabilidad, volatilidad, tendencia, liquidez y riesgo como siete cores.

El núcleo cuantitativo ofrece BSM, griegas, equilibrio y probabilidad a los
módulos consumidores. Sus fórmulas existentes se conservan. Los identificadores
antiguos del ranking permanecen temporalmente como criterios de evaluación para
no romper listas guardadas, contratos HTTP ni pruebas. No equivalen a los nuevos
cores funcionales.

| Core funcional | Responsabilidad y base existente |
|---|---|
| Análisis Técnico | `src/cores/01-analisis-tecnico/`: indicadores, tendencia, volatilidad y volumen. |
| Inteligencia Artificial | `src/cores/02-inteligencia-artificial/`: predicción experimental y preferencias. |
| Noticias Financieras | `src/cores/03-noticias-financieras/`: normalización, fuente y corte temporal. |
| Análisis Financiero (Fundamental) | `src/cores/04-analisis-fundamental/`: hechos SEC y ratios comparables. |
| Indicadores y Señales de Compra y Venta | `src/cores/05-indicadores-y-senales/`: reglas y validación de señales. |
| Gestión de Riesgos | `src/cores/06-gestion-de-riesgos/`: exposición, delta y condiciones de bloqueo. |
| Gestión y Optimización de Portafolio | `src/cores/07-gestion-de-portafolio/`: contabilidad de ciclos; optimización conjunta pendiente. |

La [guía para la revisión](../../src/cores/README.md) recorre cada carpeta con sus
funciones principales. El núcleo matemático está en `nucleo-cuantitativo/` y los
criterios y estructuras del ranking están en `evaluacion/`. Las pantallas y los
adaptadores HTTP permanecen en sus capas correspondientes.

## Primera implementación del core de IA

El usuario elige objetivo, capital disponible para esta decisión, tolerancia al
riesgo, asignación y pérdida máximas, horizonte de 5/20/60 sesiones, experiencia,
seguimiento y estrategias permitidas. Las preferencias duran la sesión del
terminal; no se agregan datos a los esquemas remotos existentes. Al recargar se
restablece el perfil inicial. Las preferencias no alteran las etiquetas del
modelo para producir un pronóstico deseado.

`forecast.ts` implementa regresión por vecinos cercanos (kNN) sobre cierres diarios
observados. Las variables son retornos logarítmicos de 5/20/60 sesiones,
volatilidad de 20 sesiones y distancia a la media de 20 cierres. Estandariza con
datos de entrenamiento conocidos en cada corte y selecciona entre 8 y 16
comparables cuyas ventanas de resultado no se solapan. No utiliza noticias,
fundamentales, IV ni dividendos como variables predictoras en esta versión.
Predice retorno del precio desde el último cierre, ajustado por splits, no
retorno total con dividendos. Para considerar una estructura alcista, el precio
proyectado también debe superar la cotización actual recibida.

La validación avanza cronológicamente por bloques del mismo horizonte; admite
solo etiquetas resueltas al tomar cada decisión y evalúa como máximo los últimos
60 bloques. Compara error absoluto medio con precio sin cambio y con retorno
medio histórico. Para proponer una estrategia requiere al menos ocho bloques y
reducir al menos 2% el error de la mejor referencia. Este umbral es una regla
experimental, no una prueba de significancia ni rentabilidad después de costes.

Los percentiles P10/P90 y la frecuencia ponderada al alza son descripciones de
los comparables. No son intervalos de confianza ni probabilidades calibradas.
Se rechazan demostración, cierres incompletos, información futura, datos
desactualizados, intradía y huecos de más de siete días. No se garantiza detectar
velas individuales ausentes ni todos los ajustes corporativos del proveedor.

`recommendations.ts` compara una estructura por estrategia con cotizaciones
observadas OPRA, costes y cálculos cuantitativos existentes. Exige capital,
pérdida máxima, experiencia, plazo cercano al horizonte y estrategias permitidas.
El horizonte en sesiones se aproxima a días naturales con 365/252 únicamente
para buscar estructuras; no se convierte el pronóstico en payoff al vencimiento.

Tras los filtros, maximiza una puntuación explícita de ajuste: margen frente al
límite de pérdida con peso 60/40/20% para tolerancia baja/media/alta; el resto
pondera objetivo (80%) y capital no utilizado (20%). Los pesos de objetivos son
heurísticos documentados en el código, no aprendidos ni validados por beneficio.
No explora toda la cadena ni afirma hallar el óptimo global.

PMCC queda excluida si no puede acotarse la pérdida y Gamma requiere un modelo de
coberturas por trayectoria. Puede concluir «esperar» por modelo no validado,
sesgo no alcista, datos incompletos o restricciones. No recomienda ventas cortas
ni sustitutos no implementados. No calcula rentabilidad esperada de opciones,
ni optimiza posiciones ya abiertas. La acción sugerida solo selecciona una
estrategia en el explorador; el envío conserva revisión y confirmación manual.

La reorganización física traslada la lógica existente a los siete cores y
conserva las pruebas de causalidad, restricciones y rechazo de datos no aptos.
La persistencia por usuario del perfil y la optimización conjunta del portafolio
son trabajo posterior. La [comparación SEC–Finviz](../integraciones/sec-y-finviz.md)
documenta la fuente fundamental actual y las opciones del plan gratuito.

## Reproducir la comprobación

`npm test`, `npm run typecheck` y `npm run build` verifican cálculos e integración.
Con la interfaz local iniciada, `npm run test:browser -- intelligence` comprueba
preferencias, horizonte, independencia del pronóstico, resultado de espera,
cambio de empresa, datos insuficientes y ancho móvil. Las fuentes del navegador
son fixtures identificados; no se envían órdenes ni escrituras remotas. Las
capturas se guardan en `outputs/intelligence-desktop.png` y
`outputs/intelligence-mobile.png`.

Referencias de diseño: [validación de series temporales de scikit-learn](https://scikit-learn.org/stable/modules/generated/sklearn.model_selection.TimeSeriesSplit.html)
y [objetivos, horizonte y tolerancia al riesgo de Investor.gov](https://www.investor.gov/introduction-investing/getting-started/asset-allocation).
