# Ejecución continua de Alpaca Paper

La pestaña puede cerrarse porque el runner es un proceso Node separado. La computadora o el servidor que lo aloja debe seguir encendido. No se contrató ni desplegó un servidor remoto. El contenedor preparado permite llevar el mismo servicio a un alojamiento Node con disco persistente.

## Ejecución local

Configura `.env.trading.local` a partir de `.env.example`, únicamente con las variables del servicio. Ejecuta `npm run trading:serve`. El terminal usa `TRADING_RUNNER_URL` y `TRADING_RUNNER_TOKEN` en `.env.local`; el token y el propietario deben coincidir. Las claves permanecen en el servidor y los archivos de entorno están excluidos de Git.

Los planes nuevos nacen desactivados. La interfaz permite revisar fechas, presupuesto, modalidad de salidas y límites antes de activarlos. Las salidas nuevas son optativas; un plan antiguo no recibe ventas automáticas por actualizar el código. Pausar bloquea entradas nuevas y mantiene salidas configuradas y conciliación. Desactivar un plan detiene sus nuevas órdenes del servicio. Ninguna de estas acciones cancela órdenes aceptadas en Alpaca, incluidas las bracket.

El servicio consulta cada 60 segundos. En modalidad por reglas, el stop genera una venta límite al detectar el umbral; en bracket, Alpaca mantiene las órdenes de salida GTC. Ninguna modalidad garantiza el precio o la ejecución. La pérdida diaria usa equity de la cuenta y una referencia persistida en la primera consulta del día; incluye otras posiciones y puede verse afectada por movimientos de efectivo. No reconstruye pérdidas anteriores a esa primera lectura.

## Contenedor preparado

Desde la raíz del repositorio:

```sh
docker build -f services/trading-runner/Dockerfile -t tepic-paper .
docker volume create tepic-paper-data
docker run -d --name tepic-paper --restart unless-stopped --env-file .env.trading.local -e TRADING_RUNNER_HOST=0.0.0.0 -e TRADING_RUNNER_DB=/data/trading-runner.sqlite -p 127.0.0.1:8790:8790 -v tepic-paper-data:/data tepic-paper
```

El Dockerfile mantiene la automatización desactivada por defecto. El archivo de entorno decide su habilitación. La publicación del ejemplo solo escucha en la interfaz local del host; un terminal alojado necesita una URL HTTPS privada/autenticada que alcance el servicio. No expongas el token en la URL ni en el navegador. La imagen no incluye los archivos de entorno ni la base SQLite local.

Usa una sola instancia por cuenta/base SQLite. Conserva el volumen; eliminarlo perdería las reservas y el ledger que evitan duplicados. Antes de migrar un servicio existente, pausa, detén el proceso y copia la base cerrada junto a sus archivos WAL/SHM si los hay. Una copia mientras SQLite sigue escribiendo puede ser inconsistente. No inicies con un volumen vacío contra órdenes antiguas pendientes.

La política de reinicio ayuda cuando el proceso termina; el healthcheck expone disponibilidad HTTP. Docker por sí solo no reinicia automáticamente un contenedor que permanece vivo pero pasa a estado unhealthy: el alojamiento debe supervisarlo si necesita esa capacidad. El Dockerfile está preparado y no se ejecutó en esta entrega porque Docker no estaba disponible en la verificación local.

## Estado y avisos

`GET /healthz` confirma disponibilidad sin publicar datos de cuenta y responde 503 si pasan cuatro minutos sin completar una evaluación desde que inicia el loop. Las consultas de estado, riesgo, posiciones propias, ejecuciones y eventos requieren el token del servicio y el propietario. La interfaz muestra esos eventos y bloqueos.

Las ejecuciones y fallos relevantes generan una alerta JSON en la misma transacción SQLite que el evento. `TRADING_ALERT_WEBHOOK_URL` permite un receptor HTTPS propio; `TRADING_ALERT_WEBHOOK_TOKEN` añade un Bearer privado de al menos 32 caracteres. No se permiten credenciales en URL, parámetros de consulta ni redirecciones. Con URL vacía no se envían mensajes. El evento puede incluir IDs propios de órdenes y planes; utiliza un receptor de confianza.

Se envían como máximo cinco avisos por tanda, con timeout de tres segundos por petición y reintentos persistidos de uno a sesenta minutos. Los errores repetidos se agrupan en intervalos de quince minutos. La cabecera `Idempotency-Key` identifica el aviso: el receptor debe deduplicarlo, porque un corte después de recibirlo puede causar un reintento. Solo respuestas 2xx marcan entrega. La cola conserva avisos previos a configurar el receptor, que se entregarán al habilitarlo. No se configuraron receptores ni se enviaron mensajes externos en esta revisión.

## Compose y Mongo

Desde la raíz: `docker compose -f services/compose.yaml up -d --build trading-runner`. Usa `.env.trading.local`, conserva el volumen `trading-data` y publica el puerto solo en loopback. Para el puente, configura `.env.mongo.local`, prepara su esquema con `npm run db:mongo:setup` y ejecuta `docker compose -f services/compose.yaml --profile mongo up -d --build`. El puente se conecta al Mongo indicado en su entorno; no instala un Mongo público. Al reiniciar, los procesos vuelven a arrancar. Los logs rotan y los contenedores usan un usuario sin privilegios.

Para que continúe al apagar tu computadora, estos contenedores deben ejecutarse en un servidor remoto, con HTTPS autenticado delante de los puertos locales. Copiar el archivo Compose a tu equipo no crea ese alojamiento. Docker no está instalado aquí, por lo que la construcción de las imágenes queda pendiente de comprobar en el host de despliegue.

El ledger y la pausa se guardan en SQLite del runner; Supabase conserva el estado del terminal y MongoDB archiva sus revisiones. Esas bases no sustituyen el disco persistente del runner. La guía de [riesgo y ejecución](riesgo-y-ejecucion.md) detalla conciliación, salidas y límites.
