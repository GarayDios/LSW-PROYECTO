# Integración Webull

El adaptador de servidor `client.ts` y el servicio `services/trading-runner/webull-service.ts` implementan cuenta, revisión, envío manual y conciliación de **acciones y opciones US en sandbox**, además de revisión de cancelaciones y modificaciones. La interfaz está en «Brókers · órdenes manuales». Los flujos de opciones verifican contratos, garantías y permisos; su ejecución depende de lo autorizado por Webull. No se representa una cuenta Webull como conectada sin verificarla con OpenAPI.

El 24 de noviembre de 2026 se verificó la conexión real del usuario a **US sandbox**: autenticación, cuenta de efectivo, saldos, posiciones, órdenes abiertas, historial y actividades de opciones. La consulta NVDA devolvió 752 velas diarias y 2926 contratos después de paginar. Se consultaron 160 snapshots: 80 tenían bid/ask e IV válidos para analizar la última sesión cerrada, con sus fechas originales. El sandbox aceptó revisiones de Wheel, PMCC, Backspread 1:2 y Gamma. Se habilitó `WEBULL_MANUAL_ENABLED=true` en ambos procesos. Cada envío requiere además habilitar Webull durante la sesión y confirmar una revisión vigente. No se enviaron órdenes ni se acreditó ejecución. Los identificadores completos y las claves se conservan únicamente en archivos de entorno ignorados.

La [revisión del profesor](../../../../docs/mejoras-profesor/revision-manual-2026-11-18.md) describe el estado anterior. Las pruebas locales verifican firma, sesión, solicitudes v3, caducidad, permisos y ausencia de duplicados con respuestas controladas. La consulta real de cuenta no acredita ejecución de órdenes.

## Acceso y región

- La [documentación mexicana](https://developer.webull.com.mx/apis/docs/) ofrece datos y operaciones de acciones del mercado estadounidense.
- La [matriz regional del repositorio oficial](https://github.com/webull-inc/webull-openapi-skills/blob/main/references/api_reference.md) identifica la región `mx`, producción `api.webull.com.mx` y UAT `us-openapi-alb.uat.webullbroker.com`. Las claves pertenecen a su región y entorno: no se deben reutilizar claves de producción en un supuesto sandbox ni sustituir la URL manualmente.
- La documentación pública de Trading API México revisada describe acciones US. Las capacidades dependen de la cuenta, región y producto autorizado. Los flujos locales de opciones y combinaciones multipierna no acreditan su habilitación para Webull México; la conexión aquí comprobada corresponde a US sandbox.
- El usuario debe solicitar OpenAPI y obtener `App Key` y `App Secret` en el Developer Console. El [proceso oficial US](https://developer.webull.com/apis/docs/authentication/IndividualApplicationAPI/) distingue producción de PaperTrade; confirma las funciones efectivamente habilitadas en tu cuenta mexicana antes de implementar o activar su adaptador.

## Firma y autenticación

Cada solicitud necesita los headers `x-app-key`, `x-timestamp` UTC, `x-signature`, `x-signature-algorithm`, `x-signature-version`, `x-signature-nonce` y `x-version: v3`. Se sigue el [compositor actual del SDK oficial](https://github.com/webull-inc/webull-openapi-python-sdk/blob/main/webull/core/auth/composer/default_signature_composer.py): SHA256 del cuerpo compacto y firma HMAC-SHA256/Base64 con `App Secret + '&'`. Los vectores SHA1/MD5 anteriores quedan como comprobación explícita de compatibilidad del helper; no se usan para las consultas actuales. No se envía el App Secret al navegador ni como header. Los headers `x-signature`, `x-access-token` y `x-version` no forman parte de los datos firmados.

Antes de consultar cuentas se crea/reutiliza el token y se incluye `x-access-token`. Se utilizan las rutas `/auth/tokens/create` y `/auth/tokens/check` del SDK; solo un 404 confirmado permite la ruta anterior documentada `/openapi/auth/token/...`. La sesión es privada, en memoria, y comparte la solicitud inicial entre consultas concurrentes. No se persisten tokens en SQLite, archivos del proyecto ni navegador. Una validación NORMAL se reutiliza por hasta cinco minutos, limitada por el vencimiento informado. Los errores de autenticación esperan al menos quince segundos antes de otro intento.

El [ciclo de token](https://developer.webull.com/apis/docs/authentication/token/) distingue tokens pendientes, activos, inválidos y expirados. PENDING muestra instrucciones para verificar en la app y vuelve a consultar el mismo token con un mínimo de tres segundos entre comprobaciones; no inicia un bucle de SMS ni pide códigos en el terminal. Los tokens de pruebas pueden quedar NORMAL directamente. Las órdenes no se reenvían automáticamente después de errores o timeouts.

## Configuración y comprobación

1. Elegir la región de la cuenta: `us` para el portal webull.com, `mx` para webull.com.mx. Confirmar sus credenciales de pruebas.
2. Verificar los contratos concretos de cuentas, instrumentos, velas y órdenes que habilite ese entorno.
3. Configurar las credenciales de pruebas en `.env.trading.local`, con `WEBULL_REGION`, `WEBULL_ENVIRONMENT=sandbox` (o alias `uat`) y `WEBULL_ACCOUNT_ID`. Este último debe ser `account_id` devuelto por Account List; no se presume que sea el número visible de la cuenta. El host queda fijado por región; este adaptador rechaza producción. Para permitir confirmaciones manuales, establecer `WEBULL_MANUAL_ENABLED=true` tanto en `.env.local` como en `.env.trading.local` y reiniciar ambos procesos. La habilitación de sesión se activa desde la interfaz.
4. Consultar la cuenta y, cuando el usuario decida probar un envío, revisar y confirmar una orden de sandbox. Comprobar su referencia y su estado en Webull antes de acreditar una ejecución.

`npm run trading:serve` carga `.env.local` y después `.env.trading.local` con el mismo mecanismo que `npm run dev`, conserva las variables del proceso y arranca el servicio en modo manual. Hay que reiniciar este servicio al cambiar sus credenciales; reiniciar solo la interfaz no cambia un servicio ya abierto en 8790. `npm run broker:check:webull` verifica token y cuenta en modo lectura sin imprimir claves ni IDs completos. Añadir `-- --data` comprueba también cartera, histórico y cobertura de opciones, sin enviar órdenes.

`npm run broker:check:webull -- --data --preview` consulta también capital, actividades y cuatro revisiones de diagnóstico contra Webull. El transporte permite las revisiones pero bloquea colocar, modificar o cancelar órdenes; los precios del diagnóstico no son propuestas de ejecución.

## Motor F5 compartido

`f5-adapter.ts` implementa el contrato del mismo motor `createF5Service` que usa Alpaca. La ruta autenticada `/api/webull-f5` se comunica exclusivamente con `/webull/f5/*`. No necesita claves Alpaca para cuenta, contratos, estrategias, órdenes o reportes. El proveedor y el feed se identifican como `Webull Sandbox`.

- **Wheel:** puts con efectivo liquidado y calls con acciones disponibles; cantidades y eventos se verifican con el proveedor.
- **PMCC:** call larga posterior y corta anterior, reserva de capital y cierre. La renovación tiene dos revisiones manuales: cerrar la corta, esperar su ejecución confirmada y revisar la nueva venta conservando la larga. No se presenta como un roll atómico y no se envía su segunda etapa automáticamente. Se usan los enlaces `LEG_OUT`/`LEG_IN` y el identificador real de posición cuando corresponde.
- **Backspread:** una call corta inferior y dos largas superiores, conservando la proporción 1:2 y el sentido de débito/crédito del límite neto.
- **Gamma:** straddle comprado y coberturas en acciones atribuidas al ciclo, con reducción de delta, cierre de coberturas y cierre de opciones.

Las revisiones y el registro sobreviven al reinicio en SQLite. El nombre predeterminado del archivo F5 incluye una huella de la cuenta; `TRADING_WEBULL_F5_DB` permite una ruta explícita, que queda vinculada a esa cuenta. No se reutiliza para otra configuración. La mesa genérica y F5 comparten la reserva de cuenta y bloquean exposición nueva mientras existen envíos sin conciliar. Un timeout no vuelve a colocar la orden. Las referencias del motor se transforman de forma determinista al máximo de 32 caracteres admitido por Webull, incluso después de reiniciar.

Webull Account List no devuelve un nivel efectivo de opciones en la respuesta consultada. Se muestra «Permisos: revisión del proveedor»; cada revisión y envío vuelve a pasar por el preview de Webull. No se inventa un nivel 3. El horario regular se calcula con las reglas publicadas del [calendario NYSE](https://www.nyse.com/trade/hours-calendars), incluidos festivos, DST y cierres anticipados. No certifica cierres de emergencia: también se requieren cotizaciones vigentes y aceptación del proveedor.

El reporte F5 usa cantidades/precios acumulados confirmados, posiciones, actividades y los campos `actual_commission`/`actual_value` del detalle de orden. No convierte un fill parcial del conjunto en fills por pata sin evidencia. Las comisiones, fechas de ejecución, cantidades de asignación o atribuciones ausentes quedan sin determinar; no se completan con cero ni con diferencias de saldo. Las actividades se consultan por año con timestamps UTC **con milisegundos**, sin limitar silenciosamente el historial a los siete días predeterminados.

## Datos y pantallas

La mesa está en **Brókers → Webull → Estrategias F5 Webull**. «Acciones y gestión Webull» conserva la mesa genérica y sus revisiones de modificación/cancelación. Los paneles de trayectoria Gamma, validación y comparación histórica aceptan también la fuente Webull. Al pasar del análisis a operar se conserva el bróker, la estrategia y la fase Wheel.

El [contrato de velas](https://developer.webull.com/apis/docs/reference/historical-bars/) declara ajuste forward en diario y ausencia de ajuste en intradía. La descarga retrocede desde la vela más antigua para superar el máximo de 1200 filas por respuesta; rechaza páginas repetidas o contradictorias. Se admiten hasta cinco años diarios o 180 días intradía. La cadena pagina metadatos y consulta una muestra de hasta 160 snapshots por petición de análisis, en lotes de 20, conservando cobertura parcial y las fechas/retrasos. Para ejecutar se exigen cotizaciones de hasta 20 minutos durante mercado abierto; una cotización de la última sesión cerrada sirve para análisis, sin cambiar su fecha ni convertirla en precio actual ejecutable.

Las [noticias Webull](https://developer.webull.com/apis/docs/reference/list-stock-news/) y las acciones corporativas publicadas respondieron 404 en este sandbox. Noticias utiliza entonces el complemento Finnhub configurado y lo identifica en la procedencia; las fechas de la gráfica se filtran por Nueva York y el corte excluye noticias futuras. Dividendos usa el calendario Webull y, si falta rendimiento anual, una métrica indicada Finnhub con fecha y origen. Una lista parcial de dividendos no demuestra doce meses completos ni rendimiento cero. SEC 13F intenta verificar splits con Webull; si ese endpoint no está disponible y Alpaca está configurada, utiliza su complemento de acciones corporativas, identificado en cada gestor. Sin una fuente verificable de splits, esa comparación queda no disponible.

Las pruebas controladas cubren apertura, cierres, renovación en dos pasos, coberturas, reportes, referencias tras reinicio, permisos, datos ausentes y aislamiento entre brókers. El navegador comprueba revisión/confirmación, reporte, exportación disponible y diseño móvil con proveedores simulados. La validación de fills y cancelaciones contra el proveedor requiere una orden de sandbox revisada y confirmada durante una sesión abierta; los previews aceptados no prueban ejecución.

No se emplean endpoints internos de la app, paquetes de ingeniería inversa ni una implementación ficticia para presentar una conexión que todavía no existe. Los datos de mercado de un sandbox pueden ser sintéticos o retrasados; no sustituyen por sí solos el histórico real de tres años.
