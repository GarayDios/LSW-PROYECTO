# 2. Core de Inteligencia Artificial

**Para explicarlo:** «El modelo estima movimientos a partir de situaciones
históricas comparables; después comparamos alternativas con las preferencias del
usuario. Si los datos o los límites no permiten recomendar, propone esperar».

- `preferences.ts`: objetivo, capital, riesgo, horizonte, experiencia y estrategias.
- `forecast.ts`: regresión kNN y validación cronológica frente a referencias simples.
- `recommendations.ts`: filtros obligatorios y puntuación explicable de ajuste.

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
