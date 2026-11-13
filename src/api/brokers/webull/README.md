# Integración Webull

La primera integración ejecutable utiliza **Alpaca Paper**. Webull tiene OpenAPI oficial y entornos de prueba, pero no se representa una cuenta Webull como conectada sin credenciales y autorización regional verificadas.

## Acceso y región

- La [documentación mexicana](https://developer.webull.com.mx/apis/docs/) ofrece datos y operaciones de acciones del mercado estadounidense.
- La [matriz regional del repositorio oficial](https://github.com/webull-inc/webull-openapi-skills/blob/main/references/api_reference.md) identifica la región `mx`, producción `api.webull.com.mx` y UAT `us-openapi-alb.uat.webullbroker.com`. Las claves pertenecen a su región y entorno: no se deben reutilizar claves de producción en un supuesto sandbox ni sustituir la URL manualmente.
- Esa matriz permite acciones en MX; las opciones están documentadas para las regiones US/HK. El laboratorio de opciones local no equivale a permiso para enviar contratos por Webull México.
- El usuario debe solicitar OpenAPI y obtener `App Key` y `App Secret` en el Developer Console. El [proceso oficial US](https://developer.webull.com/apis/docs/authentication/IndividualApplicationAPI/) distingue producción de PaperTrade; confirma las funciones efectivamente habilitadas en tu cuenta mexicana antes de implementar o activar su adaptador.

## Firma y autenticación

Cada solicitud necesita los headers `x-app-key`, `x-timestamp` UTC, `x-signature`, `x-signature-algorithm`, `x-signature-version`, `x-signature-nonce` y `x-version: v3`. La [firma oficial](https://developer.webull.com/apis/docs/authentication/signature/) usa los parámetros y headers ordenados, la ruta, el MD5 mayúsculo del cuerpo JSON compacto y HMAC-SHA1/Base64 con la clave `App Secret + '&'`. No se envía el App Secret al navegador ni como header. Los headers `x-signature` y `x-version` no forman parte de los datos firmados.

Si se habilita 2FA, también se necesita `x-access-token` y la verificación del usuario en la app. El [ciclo de token](https://developer.webull.com/apis/docs/authentication/token/) distingue tokens pendientes, activos, inválidos y expirados; el entorno de prueba no requiere esa verificación. No se automatizan códigos de verificación de una cuenta real.

## Pendiente para un adaptador Webull ejecutable

1. Confirmar acceso de la cuenta y región correctas, y sus credenciales de prueba.
2. Verificar los contratos concretos de cuentas, instrumentos, velas y órdenes que habilite ese entorno.
3. Implementar el cliente oficial de servidor, con firma probada contra los vectores oficiales, errores sanitizados, límites de tamaño y conciliación de órdenes por ID propio.
4. Comprobar sandbox con órdenes de práctica antes de ofrecer la conexión en el terminal.

No se emplean endpoints internos de la app, paquetes de ingeniería inversa ni una implementación ficticia para presentar una conexión que todavía no existe. Los datos de mercado de un sandbox pueden ser sintéticos o retrasados; no sustituyen por sí solos el histórico real de tres años.
