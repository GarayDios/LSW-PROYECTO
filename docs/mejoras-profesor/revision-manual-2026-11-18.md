# Revisión del profesor: control del usuario y órdenes manuales

Revisión local del 18 de noviembre de 2026, basada en la fotografía de observaciones.
El usuario aclaró que los datos deben seguir consultándose automáticamente y las
órdenes deben revisarse y confirmarse manualmente.

| Solicitud | Implementación | Evidencia y límite |
|---|---|---|
| Habilitar y deshabilitar desde la interfaz | Menú «Brókers · órdenes manuales»: interruptor independiente para Alpaca y Webull durante la sesión. Los cores e indicadores también pueden activarse individualmente. | Los interruptores empiezan deshabilitados. Permiten confirmar operaciones cuando el servidor también lo autoriza; habilitarlos no envía ninguna orden. Deshabilitar no cancela órdenes ya recibidas por un bróker. |
| Acceso a las funciones | «Operar» permite elegir simulación local, Alpaca Paper o Webull pruebas. La barra lateral abre las conexiones y sus registros. | La simulación se conserva separada de los registros de los brókers. Las claves permanecen en el servidor. |
| Alpaca conectada | Interfaz F5 enlazada con el servicio existente: contratos, Wheel PUT/CALL, otras estrategias F5, revisión, envío, cierre y coberturas manuales. | Cuenta real Paper ACTIVE, nivel de opciones 3. Consulta de lectura: 194 contratos AAPL con cotización para 2026-11-20 y consulta individual de contrato americano estándar. No se enviaron ni cancelaron órdenes reales durante esta revisión. |
| Webull conectada | Cliente de servidor con firma del protocolo oficial y pantalla de cuenta, revisión, envío manual y conciliación de acciones US en sandbox MX/US. | El usuario confirmó que todavía no tiene acceso OpenAPI. La firma pasa el vector oficial; el contrato de solicitudes y el flujo de órdenes se probaron con respuestas controladas. La conexión y el envío contra su cuenta siguen pendientes de credenciales y permisos. No se afirma que Webull esté conectado. Opciones/Wheel en Webull no están implementadas en este adaptador. |
| Mandar órdenes a los dos | Alpaca usa el servicio F5 existente. Webull dispone de revisión de 60 segundos, ID propio, reserva atómica SQLite, envío una sola vez y conciliación por referencia. | Las pruebas de envío de ambos usan fixtures; las pruebas de Alpaca contra cuenta externa fueron de lectura. La habilitación de servidor y de sesión no sustituye la confirmación de cada orden. |
| Gráfica marcada con estrategias elegidas | Selección de F5; strikes y equilibrios de una estructura calculable; selección de cruce SMA20/50 con o sin RSI; interruptores de señales/cores/estrategia; hasta ocho niveles propios por empresa. | Los niveles manuales llevan nombre, precio y opción de quitar; duran la sesión. No generan señales de ejecución ni órdenes. Las líneas calculadas no se inventan si faltan contratos válidos. Una regla personalizada adicional del profesor requiere su definición. |
| Nada de órdenes automáticas | Se retiraron los controles de automatización del recorrido principal. Los proxies bloquean activación/evaluación automática. El arranque del servicio fuerza modo manual y no inicia el reloj de ejecución automática. | La librería antigua de automatización sigue cubierta por sus pruebas, pero no se habilita desde el runtime entregado. La actualización periódica de datos sigue siendo de lectura. |

## Usar la interfaz

1. En el explorador elige empresa y estrategia. «Habilitar indicadores y dibujar
   niveles» permite controlar la gráfica y añadir las marcas solicitadas.
2. Pulsa «Operar». Conserva «Simulación local» para un ejercicio, o elige Alpaca
   Paper/Webull pruebas para ir a la conexión correspondiente.
3. Habilita las órdenes manuales del bróker durante la sesión. Consulta los
   contratos, elige cantidad y límite, y revisa la orden. Solo el botón final de
   confirmación intenta enviarla.
4. Consulta el registro. «Enviada» no significa «Ejecutada»; los estados inciertos
   deben conciliarse por su referencia. No prepares otra orden para sustituir a
   una solicitud cuyo resultado todavía no está confirmado.

Al conectar Alpaca, los contratos se cargan automáticamente para la empresa y el
vencimiento elegidos. Cambiar cualquiera de esos datos vuelve a consultar y borra
la selección anterior. «Consultar contratos de Alpaca» permite actualizar a mano.
Los selectores muestran cuántos contratos corresponden a cada pierna de la
estrategia; si no hay ninguno, indican que debe probarse otro vencimiento. Esta
carga no elige contratos ni envía órdenes. Se comprobó el recorrido automático y
el caso sin contratos en navegador, además de TypeScript y compilación.

## Configuración local del servidor

Terminal y servicio conservan sus claves en archivos locales ignorados por Git.
`.env.example` contiene los nombres y campos vacíos, sin claves personales.

Para Alpaca, configura en `.env.local` y `.env.trading.local` las claves Paper,
`BROKER_OWNER_USER_ID`, `TRADING_RUNNER_TOKEN` y `ALPACA_F5_ENABLED`. En el terminal,
`TRADING_RUNNER_URL` identifica el servicio. El envío requiere
`ALPACA_F5_ENABLED=true` en los dos procesos; conservarlo en false permite dejar
el envío bloqueado. No actives flags antiguos de automatización: esta revisión
se ejecuta en modo manual.

Para Webull, solicita primero acceso OpenAPI y credenciales de UAT/sandbox de la
región correcta. En `.env.trading.local` configura `WEBULL_APP_KEY`,
`WEBULL_APP_SECRET`, `WEBULL_ACCOUNT_ID`, `WEBULL_REGION=mx` o `us` y
`WEBULL_ENVIRONMENT=sandbox`. El cliente fija el host por región y rechaza un
entorno de producción. `WEBULL_MANUAL_ENABLED` debe existir en los dos procesos;
su valor inicial false mantiene el envío deshabilitado. La base de referencias
es `TRADING_WEBULL_DB`, por defecto `.sites-runtime/trading-webull.sqlite`.

```sh
# En una terminal: servicio manual de brókers
npm run trading:serve

# En otra: interfaz
npm run dev
```

`npm run dev` también inicia el servicio manual de brókers cuando la dirección
local, el token compartido y el propietario están configurados. Reutiliza los
servicios que ya estén escuchando para no iniciar instancias duplicadas.
Reinicia los procesos después de cambiar su configuración. Iniciarlos no envía
órdenes. No copies claves en el código ni en capturas de la presentación.

## Corrección de la conexión local

Se detectó que `.env.local` no tenía dirección ni token de servicio, y que
`.env.trading.local` correspondía a una cuenta Paper distinta. El usuario eligió
la cuenta del terminal (`.env.local`). Se sincronizó el servicio con esa cuenta,
se reutilizó el token privado existente y se asignaron bases SQLite separadas
por cuenta, conservando los archivos anteriores. La comparación de cuentas y
la consulta a través del proxy F5 confirmaron coincidencia, HTTP 200, cuenta
ACTIVE y permisos nivel 3. Las órdenes automáticas siguen deshabilitadas.

El enlace de inicio de sesión ahora aparece solo ante `auth_required`. Los
errores de configuración o servicio no vuelven a pedir autenticación.

## Verificación reproducible

- `npm test`: 288 aprobadas, una integración MongoDB omitida, cero fallos.
- `npm run typecheck` y `npm run build`.
- `npm run test:browser -- manual`: niveles, controles, destinos de «Operar»,
  bloqueo por sesión, revisiones, confirmación y doble clic en ambos brókers;
  escritorio/móvil y cero excepciones JavaScript. Todas las respuestas de órdenes
  son fixtures. Capturas: `outputs/manual-brokers-desktop.png` y
  `outputs/manual-brokers-mobile.png`.
- `npm run test:browser -- delivery`: recorrido anterior de ranking, órdenes
  simuladas, persistencia y herramientas avanzadas sin regresiones.
- `node scripts/verify-f5-connection.mjs`: cuenta y contratos reales de Alpaca
  Paper, exclusivamente lectura.
- Servicio iniciado con la configuración local existente: `GET /status` devolvió
  ejecución automática deshabilitada y proceso de evaluación inactivo;
  `GET /f5/status` confirmó cuenta ACTIVE con nivel 3; `GET /webull/status`
  informó credenciales pendientes y conexión deshabilitada. Solo se hicieron
  consultas GET; no se envió ni canceló ninguna orden.

Referencias primarias: [firma oficial Webull](https://developer.webull.com/apis/docs/authentication/signature/),
[Trading API México](https://developer.webull.com.mx/apis/docs/trade-api/overview/),
[ejemplo v3 del SDK oficial](https://github.com/webull-inc/webull-openapi-python-sdk/blob/master/samples/trade/trade_client_v3.py)
y [Alpaca Paper](https://docs.alpaca.markets/us/docs/paper-trading).
