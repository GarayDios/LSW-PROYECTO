# Integración Webull

El adaptador de servidor `client.ts` y el servicio `services/trading-runner/webull-service.ts` implementan cuenta, revisión, envío manual y conciliación de **acciones US en sandbox**. La interfaz está en «Brókers · órdenes manuales». No se representa una cuenta Webull como conectada sin credenciales y autorización regional verificadas. El usuario confirmó que todavía no tiene acceso OpenAPI; la verificación contra su cuenta está pendiente.

La configuración y evidencia vigente está en [la revisión del profesor](../../../../docs/mejoras-profesor/revision-manual-2026-11-18.md). Las pruebas locales verifican firma, solicitudes v3, caducidad, permisos y ausencia de duplicados con respuestas controladas; no acreditan ejecución en una cuenta Webull externa.

## Acceso y región

- La [documentación mexicana](https://developer.webull.com.mx/apis/docs/) ofrece datos y operaciones de acciones del mercado estadounidense.
- La [matriz regional del repositorio oficial](https://github.com/webull-inc/webull-openapi-skills/blob/main/references/api_reference.md) identifica la región `mx`, producción `api.webull.com.mx` y UAT `us-openapi-alb.uat.webullbroker.com`. Las claves pertenecen a su región y entorno: no se deben reutilizar claves de producción en un supuesto sandbox ni sustituir la URL manualmente.
- La documentación pública de Trading API México revisada describe acciones US. Las capacidades dependen de la cuenta, región y producto autorizado. Este adaptador implementa acciones; no afirma tener opciones, Wheel ni combinaciones multipierna habilitadas para Webull México.
- El usuario debe solicitar OpenAPI y obtener `App Key` y `App Secret` en el Developer Console. El [proceso oficial US](https://developer.webull.com/apis/docs/authentication/IndividualApplicationAPI/) distingue producción de PaperTrade; confirma las funciones efectivamente habilitadas en tu cuenta mexicana antes de implementar o activar su adaptador.

## Firma y autenticación

Cada solicitud necesita los headers `x-app-key`, `x-timestamp` UTC, `x-signature`, `x-signature-algorithm`, `x-signature-version`, `x-signature-nonce` y `x-version: v3`. La [firma oficial](https://developer.webull.com/apis/docs/authentication/signature/) usa los parámetros y headers ordenados, la ruta, el MD5 mayúsculo del cuerpo JSON compacto y HMAC-SHA1/Base64 con la clave `App Secret + '&'`. No se envía el App Secret al navegador ni como header. Los headers `x-signature` y `x-version` no forman parte de los datos firmados.

Si se habilita 2FA, también se necesita `x-access-token` y la verificación del usuario en la app. El [ciclo de token](https://developer.webull.com/apis/docs/authentication/token/) distingue tokens pendientes, activos, inválidos y expirados; el entorno de prueba no requiere esa verificación. No se automatizan códigos de verificación de una cuenta real.

## Pendiente para verificar la conexión del usuario

1. Confirmar acceso de la cuenta y región correctas, y sus credenciales de prueba.
2. Verificar los contratos concretos de cuentas, instrumentos, velas y órdenes que habilite ese entorno.
3. Configurar las credenciales de pruebas en `.env.trading.local`, con `WEBULL_REGION`, `WEBULL_ENVIRONMENT=sandbox` y `WEBULL_ACCOUNT_ID`. El host queda fijado por región; este adaptador rechaza producción.
4. Consultar la cuenta y, cuando el usuario decida probar un envío, revisar y confirmar una orden de sandbox. Comprobar su referencia y su estado en Webull antes de acreditar una ejecución.

No se emplean endpoints internos de la app, paquetes de ingeniería inversa ni una implementación ficticia para presentar una conexión que todavía no existe. Los datos de mercado de un sandbox pueden ser sintéticos o retrasados; no sustituyen por sí solos el histórico real de tres años.
