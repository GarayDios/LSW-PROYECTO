# 2. Core de Inteligencia Artificial

**Para explicarlo:** «El modelo estima movimientos a partir de situaciones
históricas comparables; después comparamos alternativas con las preferencias del
usuario. Si los datos o los límites no permiten recomendar, propone esperar».

- `preferences.ts`: objetivo, capital, riesgo, horizonte, experiencia y estrategias.
- `forecast.ts`: regresión kNN y validación cronológica frente a referencias simples.
- `recommendations.ts`: filtros obligatorios y puntuación explicable de ajuste.
- `assistant.ts`: contrato del chat, instrucciones y resumen de evidencia para OpenRouter.
- `diagnostics.ts`: error global y reciente, cobertura descriptiva y variables fuera del rango entrenado.

## Asistente conversacional

La sección **Asistente IA** permite preguntas de seguimiento, explicaciones y
recomendaciones de revisión según el perfil. `/api/intelligence` consulta las
fuentes del servidor, calcula el pronóstico y la recomendación y envía un resumen
a la API de chat de OpenRouter. No acepta cotizaciones, pronósticos ni aprobaciones
enviadas por el navegador. Las noticias se filtran por su fecha disponible.

Configura en `.env.local` y reinicia el servidor:

```dotenv
OPENROUTER_API_KEY=tu_clave_privada
OPENROUTER_MODEL=inclusionai/ling-3.2-flash:free
# Solo hace falta si no usas el propietario del bróker:
INTELLIGENCE_OWNER_USER_ID=tu_id_autenticado
```

La clave permanece en el servidor. Cada pregunta envía los últimos mensajes,
el perfil y evidencia resumida; no envía credenciales ni la cuenta del bróker.
Solo se admite `openrouter/free` o un modelo terminado en `:free`; cada solicitud
fija el precio máximo de entrada y salida en cero. No hay reintentos con modelos
de pago. Los modelos gratuitos tienen límites de uso y disponibilidad: al agotarse,
se informa el error y se conserva la pregunta para reintentar. Sin clave,
la interfaz muestra cómo conectarla; no sustituye al modelo con respuestas prefijadas.
La conversación vive en memoria mientras está abierto el terminal y se reinicia
al cambiar de empresa, fuente o rango de fechas. No se archiva en la base de datos.

El modelo predeterminado es Ling 3.2 Flash gratuito, con razonamiento desactivado.
Si no está disponible, OpenRouter puede usar Particle 1 o Nemotron 3 Ultra,
ambos gratuitos y sin razonamiento obligatorio. El precio máximo sigue en cero.
`openrouter/free` sigue siendo una alternativa configurable que alterna modelos.
Se reservan 4096 tokens de salida y se piden respuestas breves por defecto.
Si el modelo agota el presupuesto sin producir texto visible, se reintenta una
sola vez con 8192 tokens y la misma selección gratuita, dentro de un plazo total de
60 segundos. Ese reintento también consume una solicitud de la cuota gratuita.
Si hay texto parcial, se conserva con una etiqueta y un botón para continuar;
no se muestra el razonamiento interno. El historial enviado se limita en tamaño
para que una respuesta larga no impida hacer la siguiente pregunta.
El contexto conserva las métricas y decisiones verificadas, con hasta tres
comparables de muestra, sin enviar todas las ventanas de validación al modelo.

La tarjeta de recomendación se calcula en el servidor, separada del texto del
modelo. Si faltan datos, el chat puede responder de forma educativa. El modelo
recibe instrucciones de explicar los descartes y proponer esperar cuando no hay
una alternativa verificada. El texto generado puede contener errores y requiere
revisión; no ejecuta operaciones.

Además de la validación global, proponer una revisión requiere que el MAE de los
últimos ocho periodos supere ambas referencias y que todas las variables estén
dentro de sus rangos de entrenamiento. Son reglas conservadoras de abstención,
sin optimizar sus umbrales en esta muestra. El reporte incluye ambos criterios:
`passed` conserva el contraste global y `diagnostics.ready` añade estas reglas.
La cobertura P10–P90 se mide con los rangos calculados antes de cada resultado;
no es una garantía ni un intervalo de confianza calibrado.

Referencia de integración: [modelos gratuitos de OpenRouter](https://openrouter.ai/docs/guides/routing/routers/free-router).

Las preferencias cambian la selección de alternativas, no los resultados del
mercado usados para entrenar. El modelo es experimental; no acredita rentabilidad
futura. Las pantallas y estilos están en `src/features/intelligence/`.

## Evaluación reproducible con históricos

`npm run intelligence:validate` consulta únicamente datos diarios de Alpaca usando
la configuración de `.env.local`. Por defecto evalúa AAPL, MSFT y SPY en los últimos
diez años solicitados, para horizontes de 5, 20 y 60 sesiones. No envía órdenes.
El proveedor puede entregar menos cobertura; el reporte conserva sus advertencias
y los casos sin evidencia suficiente o con huecos quedan sin aprobar.

```sh
npm run intelligence:validate -- --symbols AAPL,MSFT,SPY --start 2016-11-20 --end 2026-11-20
npm run intelligence:validate -- --snapshot outputs/intelligence/snapshot.json --out outputs/intelligence-replay
```

Los archivos locales `outputs/intelligence/snapshot.json` y `report.json` guardan
las velas, procedencia, fechas, advertencias, hashes de datos y código, errores y
periodos individuales. El replay no necesita credenciales ni red. Usa otro `--out`
para conservar una ejecución anterior; el directorio de salida se sobrescribe.
Estos artefactos están excluidos de Git y no contienen claves.

Se evalúa el modelo de producción sin ajustar sus parámetros: entrenamiento
cronológico creciente, resultados de evaluación sin solapamiento y hasta los
últimos 60 periodos por horizonte (no todas las fechas de los diez años).
La aprobación exige al menos ocho periodos y una mejora del MAE superior al 2%
frente a retorno cero y promedio histórico. MAE se expresa como fracción de
retorno: `0.02` son dos puntos porcentuales. El reporte desglosa errores por año
de resultado; grupos pequeños no acreditan estabilidad estadística.

`passed: false` es un resultado válido, no un error de ejecución. La evaluación
retrospectiva no equivale a una prueba prospectiva reservada, ni mide rentabilidad
de opciones, dividendos, costos de ejecución o sesgo de supervivencia. Los datos
ajustados actuales pueden incluir revisiones del proveedor. Una mejora del modelo
debe contrastarse después con una muestra nueva, sin elegir parámetros para
ganar en este mismo reporte.
