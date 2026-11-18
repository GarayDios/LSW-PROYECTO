# Revisión vigente: órdenes manuales

El arranque `npm run trading:serve` fuerza modo manual: no inicia evaluaciones
de órdenes en segundo plano. F5 usa revisión y confirmación individual, y Webull
dispone de un adaptador de acciones en sandbox. Consulta la
[revisión del profesor del 18 de noviembre](../../docs/mejoras-profesor/revision-manual-2026-11-18.md).
Las secciones siguientes de automatización se conservan como documentación de la
librería histórica; no describen la habilitación del runtime actual.

## Referencia histórica de automatización

# Automatización de acciones en Alpaca Paper

Este servicio Node evalúa planes cada 60 segundos aunque el navegador esté cerrado. Compra acciones completas en **Paper** y gestiona las salidas configuradas por reglas o mediante bracket GTC. Conciliación, fills, posiciones propias, controles de riesgo y alertas se conservan en SQLite. No opera dinero real, no envía las simulaciones de opciones del terminal y no vende posiciones manuales. Consulta [riesgo y ejecución](../../docs/integraciones/riesgo-y-ejecucion.md).

El precio de una señal no garantiza ejecución ni rentabilidad. El runner exige mercado abierto según el reloj del bróker, una señal de compra en la última vela diaria cerrada y una cotización bid/ask de menos de 60 segundos. Usa una orden límite, un presupuesto explícito y un identificador estable por plan/señal. Un estado `submitted` significa **orden enviada**, no compra ejecutada.

## Configuración

Usa Node.js 22.18 o posterior y un archivo ignorado `.env.trading.local`:

```dotenv
ALPACA_API_KEY=
ALPACA_SECRET_KEY=
ALPACA_DATA_FEED=iex
BROKER_OWNER_USER_ID=
ALPACA_AUTOMATION_ENABLED=false
TRADING_RUNNER_TOKEN=
TRADING_RUNNER_HOST=127.0.0.1
TRADING_RUNNER_PORT=8790
TRADING_RUNNER_DB=.sites-runtime/trading-runner.sqlite
TRADING_MAX_ORDER_USD=1000
```

`BROKER_OWNER_USER_ID` debe ser la identidad autenticada del propietario del terminal, no un correo. El token debe contener al menos 32 bytes aleatorios y coincide con el token privado del proxy del terminal. Las claves solo permanecen en el entorno del servidor; no se escriben en SQLite ni se envían al navegador.

```sh
node --env-file=.env.trading.local services/trading-runner/server.ts
```

El plan se crea **desactivado**. Para permitir su activación hacen falta `ALPACA_AUTOMATION_ENABLED=true` en este servicio y la acción explícita de activar el plan desde la interfaz. Mantener la variable en `false` permite preparar y consultar los planes sin enviar órdenes. Detener un plan impide evaluaciones nuevas; una solicitud ya enviada al bróker debe revisarse en Alpaca Paper.

## Datos y ejecución

- La regla fija usa SMA20/SMA50 y RSI14. Evalúa un cruce confirmado de la última sesión completa según el calendario oficial, incluidos festivos. Una compra antigua no se recicla como una nueva señal. El calendario y los cierres se reutilizan durante la sesión para evitar descargar tres años cada minuto.
- El histórico solicitado cubre tres o cinco años; sus datos proceden del proveedor configurado y respetan sus permisos de acceso.
- La orden no supera el menor de los límites del plan, del servicio y del capital de práctica disponible. El límite por acción es el ask actual más 0.5%, redondeado al centavo superior. Un diferencial mayor al 2% o una cotización caducada bloquean la entrada.
- Los planes, registros y reservas se conservan en un archivo SQLite duradero. Un índice admite un único plan activo por usuario/símbolo. Una reserva única por señal se escribe antes del envío.
- Después de un timeout o un reinicio ambiguo se consulta `client_order_id`; si no puede confirmarse la orden, la reserva se conserva para revisión y **no se reenvía a ciegas**.
- El historial registra estados de espera, bloqueo, envío y ambigüedad. El bróker mantiene la fuente de verdad de posiciones y órdenes; no se copian saldos de práctica a la simulación de opciones.

## Contrato interno HTTP

Solo `/healthz` es público. El resto requiere `Authorization: Bearer <TRADING_RUNNER_TOKEN>` y el `ownerId` autorizado. No se habilita CORS: el navegador llama al proxy autenticado de la aplicación.

| Método y ruta | Entrada / salida |
|---|---|
| `GET /status?ownerId=...` | Estado `{mode:'paper', available:true, configured, enabled, ownerId, maxOrderUsd, buyOnly, paused, running}`. `buyOnly` depende de las políticas configuradas. |
| `GET /plans?ownerId=...` | `{plans:[...]}`. |
| `GET /events?ownerId=...` | `{events:[...]}`, últimos 50 eventos del propietario. |
| `GET /executions?ownerId=...` | Cantidad, precio y estado conciliado de entradas y salidas. |
| `GET /positions?ownerId=...` | Ledger de acciones y resultados de los planes. |
| `GET /risk?ownerId=...` | Pausa, límites y exposición agregada. |
| `POST /pause` | `{ownerId,paused:boolean}`; pausa entradas y mantiene salidas habilitadas. |
| `POST /plans` | `{ownerId,symbol,historyYears:3|5,startDate,endDate,maxOrderUsd,maxPositionUsd,enabled:false}` → `{plan}`. |
| `PATCH /plans/:id` | `{ownerId,enabled:boolean}` → `{plan}`. |
| `POST /tick` | `{ownerId}` → `{events:[...]}`, evaluación inmediata sin saltarse guardas. |

## Alojamiento y límites

En producción este es un servicio Node independiente, detrás de HTTPS y con un **volumen persistente** para SQLite. El Worker del terminal se comunica por HTTP; no se necesita mantener una pestaña abierta. Ejecuta una única instancia por archivo de datos. La reserva del bróker y las transacciones locales protegen contra duplicados, pero no constituyen una transacción distribuida con Alpaca.

Las salidas son optativas y no se añaden a planes heredados. El runner no ejecuta opciones multipierna ni una predicción entrenada. El backtest usa validación temporal, costes y ejecución en la apertura siguiente; no demuestra rendimiento futuro. El seguimiento por polling puede retrasar estados; los stops por reglas requieren el servicio activo y los brackets residen en Alpaca. [Compose, reinicio y alertas](../../docs/integraciones/servicio-continuo.md) explican el alojamiento y sus límites.
