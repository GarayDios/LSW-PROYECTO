# Ciclo operativo, investigación y puesta en marcha

## Cambios de esta revisión

- Pausa de entradas que mantiene salidas configuradas y conciliación, incluso si la pausa llega durante una consulta de mercado.
- Bracket GTC opcional para acciones Paper: entrada, dos salidas, seguimiento por IDs, fills parciales, reducción de cantidad del stop y recuperación desde SQLite.
- Comparación real de hasta seis empresas en uno, tres y cinco años, con SMA20/50 con y sin filtro RSI14, costes iguales, validación 70/30, ventanas de 63 sesiones, pérdidas visibles y CSV.
- Acceso explícito a variables actuales desde el panel de investigación, para consultar cadenas actuales con un corte actual.
- Cola duradera de alertas JSON, deduplicación y reintentos. Receptor HTTPS opcional; no se configuró ni se enviaron avisos externos.
- Compose para el runner y el puente Mongo, con reinicio del proceso, volúmenes y rotación de logs. El healthcheck del runner detecta falta de evaluaciones completadas; Docker requiere supervisión adicional para reiniciar por estado unhealthy.
- `npm run db:check`: diagnóstico de lectura de la RPC Supabase y del archivo Mongo por propietario, sin modificar registros.

## Datos y matemáticas

Los cores matemáticos permanecen puros en `src/cores/`. Los adaptadores del servidor obtienen entradas y conservan fuente, unidad, fecha observada, fecha de publicación y motivo de ausencia. HV no sustituye IV. Una puntuación heurística y una probabilidad neutral al riesgo no equivalen a éxito futuro. Los fundamentales, noticias y macro son contexto separado; añadir APIs no entrena ni calibra un predictor.

Las fuentes preparadas son Alpaca para acciones, contratos/IV/griegas y noticias; SEC para estados financieros; FRED/ALFRED para tasas, inflación y PIB con vintage. El rendimiento continuo de dividendos futuro sigue ausente si no existe una fuente o supuesto explícito verificable. La tasa demo no se copia a un análisis real.

La comparación nueva evalúa reglas accionarias; las F5 completas requieren cadenas históricas, primas y spreads conocidos en cada fecha, además de un motor de backtest multipierna. Los ciclos siguen siendo simulaciones. No se presenta ese backtest de opciones como completado.

## Estado de las conexiones comprobadas

La comprobación de lectura `npm run research:check` devolvió 753 velas diarias de AAPL, 3,132 contratos en el feed indicative y 57 noticias. Indicative es un feed derivado; no son cotizaciones OPRA ejecutables. Los resultados son una instantánea de la comprobación, no una cantidad fija del proveedor.

SEC necesita `SEC_USER_AGENT` con un contacto real y FRED necesita `FRED_API_KEY`. `npm run db:check` informa que faltan las configuraciones Supabase y Mongo. No se crearon proyectos remotos ni se aplicaron migraciones a una cuenta externa. Para habilitarlos: [configuración de bases](../base-de-datos/configuracion.md).

El servicio remoto requiere un alojamiento Node con disco persistente y sus variables privadas. El archivo `services/compose.yaml` está preparado; Docker no está instalado en el entorno de comprobación. No se desplegó un servicio permanente ni se activó un plan para probar órdenes externas. Los casos de ejecución y envío de avisos se verifican con dobles de prueba.

## Carpeta de cada responsabilidad

| Responsabilidad | Ubicación |
|---|---|
| Cores puros y tipos matemáticos | `src/cores/` |
| Fuentes externas y límites HTTP | `src/api/research/`, `src/api/analysis/`, `src/api/brokers/` |
| Comparación y validación | `src/features/analysis/` |
| Panel de datos y procedencia | `src/features/research/` |
| Panel de órdenes y riesgo | `src/features/trading/` |
| Persistencia del terminal | `src/db/`, `supabase/migrations/` |
| Automatización y alertas duraderas | `services/trading-runner/` |
| Puente Mongo y contenedores | `services/mongo-api/`, `services/compose.yaml` |
| Diagnósticos sin credenciales en salida | `scripts/verify-*-connection.mjs` |
| Pruebas por naturaleza | `tests/trading/`, `tests/research/`, `tests/database/` |

Ver [riesgo y ejecución](../integraciones/riesgo-y-ejecucion.md), [variables y validación](../arquitectura/variables-y-validacion.md) y [fuentes](../integraciones/fuentes-y-variables.md).
