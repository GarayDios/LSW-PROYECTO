# Núcleo cuantitativo y siete cores funcionales

## Cores del escáner según la referencia de interfaz

La configuración visible del escáner utiliza ahora **Estrategia propia,
Fundamental, Monte Carlo (PoP), Soportes y resistencias, Flujo institucional,
Indicadores técnicos y Noticias y earnings**. La interfaz permite seleccionar
los que participan y su peso relativo. Peso 2 aporta el doble que peso 1;
peso 0 excluye al core. Los pesos se guardan con la lista y se aplican al ranking
y al escenario. La cifra bajo la casilla es puntuación 0–100; para Monte Carlo
corresponde a la frecuencia de beneficio del modelo, no a éxito real calibrado.
Esta configuración sustituye los selectores de BSM, griegas,
probabilidad, volatilidad, tendencia, liquidez y riesgo en el explorador; esos
identificadores se conservan únicamente para las listas y consumidores anteriores.
La organización de carpetas funcionales descrita más abajo sigue siendo interna.

`evaluacion/scanner.ts` calcula la media ponderada de los cores evaluables activados.
Un core desactivado no cuenta; uno sin datos se informa y se excluye.
Si ninguno es evaluable, la puntuación es nula.
La configuración se guarda en `config.analysis.scanner` y se usa en el escáner,
la comparación de estrategias, el endpoint de ranking y el escenario gráfico.
Los selectores de capas permiten ocultar dibujos sin cambiar esta configuración.

El sentimiento utiliza reglas bilingües explícitas, negación, deduplicación y
titulares de los últimos 30 días, conocidos y revisados antes del corte.
Su peso temporal tiene semivida de siete días. Es una heurística inspeccionable,
no un modelo entrenado ni una probabilidad calibrada. Los titulares de earnings
se identifican, sin inventar una fecha de resultados futuros.

Los sesgos direccionales disponibles, sus pesos y la volatilidad histórica
construyen un escenario de sensibilidad separado de las velas históricas.
La referencia gris conserva la ponderación con sentimiento neutral; la diferencia
respecto de la trayectoria violeta muestra la contribución de noticias al precio.
El P/L usa el payoff conjunto con costes para estructuras de un vencimiento y
la valoración BSM de la LEAPS al vencimiento de la call corta para PMCC.
Las noticias pueden cambiar el precio
del escenario sin cambiar el payoff si no se cruza un strike.

Monte Carlo ejecuta por defecto 2,000 trayectorias con semilla 20261124, primas de entrada y
comisiones de la estrategia. Mantiene su PoP neutral al riesgo separada del
escenario de sentimiento. PMCC simula hasta el primer vencimiento y conserva
el plazo y la IV de cada pierna al marcar su valor. Gamma muestra el
straddle sin cobertura, identificado como tal. Los controles permiten guardar
semilla y entre 100 y 10,000 trayectorias del core. La simulación detallada tiene
sus propios controles y toma esos valores como iniciales al abrirla. Cambiar la
semilla solo cambia el muestreo; no completa datos ni mejora supuestos.

El escaneo utiliza un universo explícito: 14 acciones del catálogo, la lista
actual o el subconjunto de tecnología y semiconductores. No representa todos los
activos estadounidenses ni añade ETFs inexistentes al catálogo. La confluencia
mínima, el límite de 5/10/todos y el orden por confluencia o PoP Monte Carlo se
aplican realmente al generar la lista y se guardan junto con los parámetros.
Las PoP ausentes quedan al final, sin sustituirlas por probabilidades BSM.

El institucional prioriza `institutionalFlow` observado, normalizado, reciente y
con fuente; después usa la comparación automática SEC 13F. La interfaz no ofrece
capturas manuales Finviz. No deduce flujo del volumen
ni del open interest. El [conector 13F](../integraciones/sec-13f.md) usa una muestra
identificada de Geode y State Street, sin presentarla como propiedad total o
flujo intradía. Su dirección participa en el escenario y su puntuación en la
media ponderada, respetando el peso del usuario.

Verificación: `npm test`, `npm run typecheck`, `npm run build` y
`node scripts/scanner-browser-scenario.mjs` con la interfaz local iniciada.
El navegador usa fixtures aisladas, comprueba pesos, ausencia de captura Finviz, sentimiento, gráfica,
datos faltantes, guardado de listas y ancho móvil; no realiza escrituras remotas.
Las capturas quedan en `outputs/scanner-desktop.png` y `outputs/scanner-mobile.png`.

La casilla «¿Qué falta?» muestra el diagnóstico concreto, incluida antigüedad de
cotizaciones, IV, restricciones de capital y contratos. El acceso al escenario
estimado es explícito y conserva los supuestos; no relaja la validez del modo
observado. Fuera de sesión pueden existir contratos sin ninguna cotización reciente.
La reconstrucción acotada reserva candidatas de calls largas ITM con delta
compatible para PMCC, además de calls cercanas al vencimiento corto. Recalcula
las griegas del escenario reconstruido. No elimina restricciones de capital,
spread, sincronización ni multiplicador. La selección sigue sin ser exhaustiva.

Se retiraron el formulario, el pegado de tablas y la importación CSV manual de
Finviz. Las políticas creadas por la interfaz usan Finnhub y SEC sin aplicar
capturas guardadas. El lector de formatos antiguos conserva compatibilidad de
almacenamiento; eso no habilita nuevos envíos manuales ni retrofecha sus métricas.

### Recomendador, rentabilidad y reproducción histórica

El recomendador propone contratos concretos y sus combinaciones para Wheel,
PMCC, Backspread y Gamma. No incluye un apartado CC/CSP. Cada combinación conserva
su geometría, cantidades y ratios: put inicial Wheel, diagonal PMCC, calls −1/+2
Backspread o call/put de igual strike y vencimiento para la base de Gamma.
`contract-recommendations.ts` compara hasta 24 estructuras distintas mediante
40 búsquedas sobre un máximo de 128 contratos elegibles. Al excluir piernas de
una selección, encuentra alternativas usando el selector compartido, con sus
reglas de capital, vencimiento, delta y calidad. No enumera el producto cartesiano
de una cadena completa ni afirma una optimización exhaustiva.

Cada estructura tiene su propia evaluación de cores y PoP Monte Carlo. Se ordena
por confluencia, retorno comparable o capital, y se muestran hasta 3/5/10 propuestas.
La confluencia mínima proviene de la configuración del escáner. Las primas
reconstruidas siguen marcadas como estimadas y no habilitan ejecución. El worker
se cancela al cambiar empresa, estrategia o parámetros; una respuesta anterior
no puede reemplazar las combinaciones de la selección actual.

`strategy-outlook.ts` comparte el pronóstico entre el resumen del recomendador y
la evaluación detallada. Selecciona 5, 20 o 60 sesiones sin superar el plazo de
la opción corta; convierte a días naturales usando 365/252. Transforma cada
retorno comparable ya resuelto en el valor de la posición, con IV constante,
comisiones de entrada/salida y financiación del débito. PMCC retiene el valor
temporal de la LEAPS. Se informa media ponderada, retorno sobre capital requerido
y P10/P90 descriptivos. La validación cronológica sigue correspondiendo al precio
del subyacente: no acredita un backtest de opciones. Gamma conserva el análisis
de trayectoria y no recibe un pronóstico de scalping desde cierres estáticos.

`historical-exercise.ts` y el panel de reproducción permiten elegir un cierre
pasado, mostrando únicamente el estado calculable al corte. Su disponibilidad
conservadora es las 06:00 UTC del día siguiente. Los hechos empresariales y macro
se consultan con ese corte. La evolución posterior se revela mediante una acción
separada; nunca entra en las señales ni en la HV inicial. El ejercicio utiliza
términos definidos por el usuario, multiplicador supuesto de 100 y primas BSM,
sin afirmar contratos listados ni fills históricos. Los datos macro ausentes
requieren supuestos explícitos. Se informa si falta evolución hasta el horizonte.

La comparación de cuatro estrategias del screener se calcula al abrirla. Los
espacios grandes se cargan mediante importaciones dinámicas y los selectores
reutilizan términos, vencimiento y spread durante cada ordenamiento. Los
pronósticos comparten resultados por snapshot y horizonte, sin mezclar cortes.

### Propuesta de API de IA (pendiente de implementación)

Integrar la explicación y sugerencia de alternativas dentro del recomendador,
con el detalle y la evidencia en la evaluación detallada. El modelo de lenguaje
recibiría un resumen acotado de los siete cores, estructuras, costes, riesgos,
preferencias, cobertura y corte. Los motores locales seguirían calculando precios,
rentabilidad y restricciones. La respuesta debería incluir estrategia, motivos,
alternativas, datos faltantes y acción «esperar/explorar/revisar», con referencias
a entradas del resumen; no podría inventar cotizaciones ni enviar órdenes.

La opción inicial propuesta es Responses API con Structured Outputs y validación
Zod en el servidor. Mantener la clave fuera del cliente, límites de consumo,
timeout, caché por usuario/snapshot/preferencias/versión y regreso al análisis local
ante fallos. Evaluar los modelos con casos financieros reproducibles antes de
elegir por calidad, latencia y coste; no se activa una API de pago en esta fase.
Referencias: [inicio oficial](https://developers.openai.com/api/docs/quickstart),
[salida estructurada](https://developers.openai.com/api/docs/guides/structured-outputs).

El histórico de investigación carga hasta 400 días de preparación anteriores al
corte si la ventana visible es corta. La gráfica y su CSV conservan el rango
elegido. El modo demo incluye métricas fundamentales y titulares sintéticos
identificados como tales. Un resultado vacío verificado de noticias es neutral;
un fallo de consulta sigue siendo «sin datos». La estructura combina niveles
confirmados con extremos provisionales de las 20 sesiones anteriores, sin
presentar estos últimos como rebotes confirmados.

## Cuenta, conexiones y modos de trabajo

La navegación incorpora Mi cuenta, Cadena de opciones y Conexiones; los modos
incluyen Mesa de órdenes, Screener, Evaluación detallada, Recomendador de contratos y
Simulación histórica. Se reutilizan las revisiones y confirmaciones manuales
de Alpaca Paper y Webull Sandbox. El recomendador filtra el bid neto de comisiones,
el capital para CSP y las acciones declaradas para CC; la cobertura real se
verifica posteriormente en el bróker. La anualización de prima es simple, a 365 días.

`GET /api/connections` devuelve únicamente configuración y capacidades públicas,
sin claves ni direcciones privadas. Configurado no equivale a conectado.
`?probe=supabase` y `?probe=mongodb` requieren sesión y realizan una lectura
limitada al propietario autenticado; no guardan ni migran datos. Seleccionar
una base utiliza el controlador de persistencia existente. Sin sesión, se
ofrece el inicio de sesión y se mantienen deshabilitadas las acciones remotas.
Las capturas del hub son `outputs/connections-desktop.png` y
`outputs/connections-mobile.png`.

Las siguientes secciones documentan la organización previa y los consumidores
que conservan compatibilidad; no describen los selectores actuales del escáner.

La definición confirmada por el usuario separa el núcleo cuantitativo de los
siete cores. Sustituye la ampliación anterior que trataba BSM, griegas,
probabilidad, volatilidad, tendencia, liquidez y riesgo como siete cores.

El núcleo cuantitativo ofrece BSM, griegas, equilibrio y probabilidad a los
módulos consumidores. Sus fórmulas existentes se conservan. Los identificadores
antiguos del ranking permanecen temporalmente como criterios de evaluación para
no romper listas guardadas, contratos HTTP ni pruebas. No equivalen a los nuevos
cores funcionales.

## Controles de ranking y gráfica

La sección «Evaluación del ranking» conserva los siete criterios anteriores y
sus pesos. Se agrupan en núcleo cuantitativo (BSM, griegas y probabilidad),
análisis técnico (volatilidad, tendencia y liquidez) y gestión de riesgos. Los
selectores quedan dentro de «Ajustar criterios del ranking»; las listas guardadas
conservan los identificadores y la configuración con que se generaron.

Las capas del gráfico tienen un estado independiente. Ocultar medias, MACD,
volumen o señales no excluye esos datos de los cálculos, de la regla de señales
ni del ranking. Cambiar la regla de señales sí cambia el análisis histórico.
Las bandas de volatilidad y el escenario −2σ son capas opcionales, inicialmente
ocultas; el escenario no reemplaza los límites operativos de riesgo.

La valoración y las sensibilidades del contrato se consultan en «Núcleo
cuantitativo». En las velas pueden mostrarse su strike y equilibrio, además de
los niveles de la estrategia. No se dibuja delta sobre la escala de precios.
Los datos financieros y noticias siguen en el panel de la empresa y la IA en su
panel propio. Esta separación conserva las fórmulas y dependencias existentes;
no añade pesos de noticias o de IA a un ranking que todavía no los utilizaba.

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
