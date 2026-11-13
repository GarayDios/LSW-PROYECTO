# Archivo de análisis en MongoDB

Servicio Node separado para conservar instantáneas inmutables de los datos del terminal. Supabase sigue siendo la fuente principal de listas, órdenes y ciclos. Este servicio recibe las instantáneas de la cola de salida de Supabase después de confirmar cada guardado.

El Worker de Sites llama al servicio mediante HTTPS. El proceso Node abre la conexión MongoDB; la URI y el token nunca llegan al navegador. No utiliza Atlas Data API ni Atlas App Services, servicios retirados.

## Preparación de MongoDB Atlas

1. Crea un proyecto y un clúster Atlas, o utiliza un despliegue MongoDB propio.
2. Crea un usuario de base de datos y permite el acceso de red desde el alojamiento del servicio Node.
3. Obtén la URI de conexión del driver Node y elige una base, por ejemplo `tepic_terminal`.
4. Prepara un archivo local `.env.mongo.local` ignorado por Git:

```dotenv
MONGODB_URI=mongodb+srv://USUARIO:CONTRASENA@HOST/
MONGODB_DATABASE=tepic_terminal
MONGO_BRIDGE_TOKEN=REEMPLAZAR_POR_UN_SECRETO_ALEATORIO_DE_AL_MENOS_32_BYTES
MONGO_BRIDGE_HOST=127.0.0.1
MONGO_BRIDGE_PORT=8788
```

Codifica los caracteres especiales de usuario/contraseña en la URI según las instrucciones de Atlas. Genera un token aleatorio, por ejemplo con `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. El mismo token debe configurarse en el servidor del terminal.

Con las dependencias del proyecto instaladas, ejecuta una vez:

```sh
node --env-file=.env.mongo.local services/mongo-api/setup.ts
```

Este paso crea la colección `analysis_snapshots`, su validador y los índices. Si la colección existe, actualiza su validador e índices sin borrar documentos. Revisa cambios de validación antes de aplicarlos sobre datos existentes; las futuras migraciones deben ser aditivas.

Inicia el servicio:

```sh
node --env-file=.env.mongo.local services/mongo-api/server.ts
```

En producción, aloja el proceso Node detrás de HTTPS y configura la URL privada y el token en el servidor del terminal. Usa un usuario de aplicación con los permisos mínimos de lectura/escritura de esta colección; el usuario de preparación puede necesitar permisos adicionales para crear índices y cambiar validadores. El servicio comprueba conectividad al arrancar; no crea ni modifica el esquema durante las solicitudes.

## Contrato HTTP

Todas las rutas de datos requieren `Authorization: Bearer <MONGO_BRIDGE_TOKEN>`. No hay CORS ni acceso directo desde el navegador. La autorización de usuarios finales ocurre en la API del terminal; el token del bridge autoriza al servicio de confianza, por lo que no debe entregarse a visitantes.

| Ruta | Resultado |
|---|---|
| `GET /healthz` | Liveness, `{ "status": "ok" }`; no comprueba ni revela estado de Atlas. |
| `PUT /snapshots` | Recibe `{id, ownerId, revision, state, createdAt}`. Devuelve `201` al crear y `200` en un reintento idéntico. |
| `GET /snapshots?ownerId=…&limit=20` | Lista metadatos, sin el estado completo, en orden descendente de revisión. Límite entre 1 y 100. |
| `GET /snapshots/:id?ownerId=…` | Devuelve `{snapshot}` solo si la instantánea pertenece al propietario indicado. |

El cuerpo máximo es 2 MiB. Los documentos guardan `_id` UUID, `ownerId`, `revision`, `schemaVersion: 1`, `state` y `createdAt` como fecha BSON. El índice único `(ownerId, revision)` y `$setOnInsert` conservan la inmutabilidad y permiten reintentos. Un UUID o revisión ya existentes con contenido distinto devuelven `409`.

La API y el bridge comparten la validación completa del modelo del terminal. Los límites actuales son 200 listas, 5,000 órdenes y 200 ciclos por instantánea, sujetos al límite total del cuerpo. Esta primera versión conserva instantáneas completas; una política de retención debe definirse según el uso antes de acumular históricos grandes. No elimina automáticamente archivos.

## Comprobación

```sh
node --test tests/database/mongo-api.test.ts
```

Las pruebas HTTP usan un repositorio en memoria y verifican autenticación, aislamiento de búsquedas por usuario, límites, UTF-8 válido, errores e idempotencia. El adaptador del driver también tiene una prueba aislada. Estas pruebas no certifican una conexión real a Atlas.

La prueba de integración real se omite si no existe `MONGODB_TEST_URI`. Cuando tengas una base de pruebas, crea un archivo local ignorado `.env.mongo.test.local` con `MONGODB_TEST_URI` y, opcionalmente, `MONGODB_TEST_DATABASE` (por defecto `tepic_test`). Ejecuta:

```sh
node --env-file=.env.mongo.test.local --test tests/database/mongo-api.test.ts
```

La integración crea una colección exclusiva `analysis_snapshots_test_<UUID>` dentro de esa base, comprueba el validador, índices, idempotencia y consultas por propietario, y elimina solo esa colección al terminar. No borra bases ni toca `analysis_snapshots`. El usuario de pruebas necesita permisos para crear/modificar/eliminar esa colección y sus índices. No se descarga ni inicia un servidor MongoDB automáticamente.
