# Configurar Supabase y MongoDB desde cero

La implementación está preparada para conectar tus proyectos. Supabase conserva los datos actuales y MongoDB sus archivos históricos. Puedes comenzar usando solo Supabase y añadir MongoDB después; si aún no configuras ninguno, el terminal sigue funcionando en modo local.

El [modelo de datos](../arquitectura/base-de-datos.md) explica las tablas, la identidad, las revisiones y la cola de archivos. La integración todavía debe verificarse contra tus propios proyectos una vez creados.

## 1. Preparar el proyecto local

Usa Node.js 22.18 o posterior. Desde la carpeta del proyecto:

```sh
npm ci
```

Si aún no existe `.env.local`, copia [`.env.example`](../../.env.example) a ese nombre. En PowerShell:

```powershell
if (!(Test-Path -LiteralPath .env.local)) {
  Copy-Item -LiteralPath .env.example -Destination .env.local
}
```

Los archivos `.env.local` y `.env.mongo.local` están ignorados por Git. Las variables de base de datos son exclusivas del servidor; no les añadas prefijos `NEXT_PUBLIC_` ni `VITE_`. La clave de Supabase, la URI de MongoDB y el token del servicio no pertenecen al código del navegador.

## 2. Crear el proyecto de Supabase

1. Entra en [Supabase](https://supabase.com/dashboard), crea una organización si todavía no tienes una y crea un proyecto.
2. Elige la región y guarda la contraseña de la base en tu gestor de contraseñas. La aplicación usará la API HTTPS; esa contraseña no se coloca en el frontend.
3. Espera a que el proyecto esté disponible.
4. Abre el editor SQL y ejecuta el contenido completo de [`202611130001_terminal_persistence.sql`](../../supabase/migrations/202611130001_terminal_persistence.sql) **una sola vez**. El archivo crea las siete tablas, índices y funciones de acceso.
5. Comprueba en el editor de tablas que aparecen `terminal_profiles`, `terminal_preferences`, `watchlists`, `watchlist_items`, `paper_orders`, `investment_cycles` y `analysis_outbox`.
6. Obtén la URL del proyecto y una clave **secreta de servidor** desde el panel de claves/conexión del proyecto. La clave recomendada empieza con `sb_secret_`; no uses una clave pública `sb_publishable_` ni una clave `anon` para este backend. Los tipos y ubicaciones actuales están en la [documentación oficial de claves](https://supabase.com/docs/guides/getting-started/api-keys).

La migración no crea usuarios de login de Supabase. El servidor ya recibe la identidad de Sites y utiliza su ID de texto para separar los registros. No hace falta configurar un segundo login con Supabase Auth.

Las migraciones aplicadas se conservan intactas. Para cambios futuros se añadirá un nuevo archivo SQL; no vuelvas a ejecutar esta migración sobre un esquema que ya la tenga aplicada. Si usas Supabase CLI en tu propio flujo, estos archivos también pueden aplicarse mediante sus migraciones, pero no es necesario instalarla para seguir esta guía.

## 3. Conectar el terminal a Supabase

Edita `.env.local` con tus valores:

```dotenv
SUPABASE_URL=https://REFERENCIA_DEL_PROYECTO.supabase.co
SUPABASE_SECRET_KEY=sb_secret_REEMPLAZAR_CON_TU_CLAVE
SUPABASE_SERVICE_ROLE_KEY=
MONGO_BRIDGE_URL=
MONGO_BRIDGE_TOKEN=
```

La variable `SUPABASE_SERVICE_ROLE_KEY` permite usar una clave JWT de servidor heredada cuando corresponda; usa una sola alternativa y prefiere `SUPABASE_SECRET_KEY` para proyectos nuevos. El servidor verifica que la clave heredada pertenezca al rol `service_role`.

Inicia o reinicia la aplicación después de cambiar las variables:

```sh
npm run dev
```

En desarrollo local, Sites aporta una identidad simulada para comprobar el flujo. Los datos que guardes con esa identidad son datos de prueba de desarrollo, distintos de los de un usuario real del sitio. Mantén el servidor de desarrollo accesible solo desde tu equipo; no lo uses como servidor público.

En una cuenta remota nueva, la interfaz permite **Importar datos de este navegador** o **Empezar sin importar**. Elige importar si quieres trasladar las listas, órdenes simuladas, ciclos y tasa guardados antes de la conexión. No se importan automáticamente a cualquier cuenta.

Haz un cambio pequeño y comprueba el estado **Datos sincronizados**. En el editor de Supabase debe aparecer el perfil correspondiente, sus agregados y una entrada de `analysis_outbox`. Es normal que los archivos sigan pendientes mientras MongoDB no esté configurado.

## 4. Crear el proyecto de MongoDB Atlas

1. Entra en [MongoDB Atlas](https://cloud.mongodb.com/), crea un proyecto y un clúster o despliegue de base de datos.
2. Crea un **usuario de base de datos** para la aplicación. Esa cuenta es diferente de tu usuario de acceso al panel de Atlas.
3. En el acceso de red, autoriza la IP pública desde la que se conectará el servicio Node. Para las pruebas locales es la salida de tu conexión de desarrollo; en producción es la salida del alojamiento del servicio. Los navegadores de los visitantes no se conectan a Atlas. Consulta la [lista de acceso IP de Atlas](https://www.mongodb.com/docs/atlas/security/ip-access-list/).
4. Obtén la cadena de conexión para el driver Node.js y reemplaza usuario y contraseña con los valores del usuario de base. Si incluyen caracteres especiales, usa su codificación correspondiente en la URI.
5. Elige una base, por ejemplo `tepic_terminal`. El paso de preparación creará la colección, su validador y sus índices.

El servicio usa el driver MongoDB actual, no Atlas Data API. La aplicación de Sites se comunica con el servicio por HTTP/HTTPS; el servicio abre la conexión a Atlas.

## 5. Preparar el servicio Node de MongoDB

Crea un archivo nuevo `.env.mongo.local` en la raíz del proyecto:

```dotenv
MONGODB_URI=mongodb+srv://USUARIO:CONTRASENA_CODIFICADA@HOST_DEL_CLUSTER/
MONGODB_DATABASE=tepic_terminal
MONGO_BRIDGE_TOKEN=REEMPLAZAR_CON_UN_SECRETO_ALEATORIO
MONGO_BRIDGE_HOST=127.0.0.1
MONGO_BRIDGE_PORT=8788
```

Genera el token en tu equipo con 32 bytes aleatorios, por ejemplo:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Coloca ese mismo valor en `.env.mongo.local` y, en el paso siguiente, en `.env.local`. El token identifica las llamadas del servidor del terminal al servicio Node; no es un token de los usuarios visitantes.

Con una cuenta de preparación que tenga permisos para crear la colección, cambiar el validador y crear índices, ejecuta:

```sh
npm run db:mongo:setup
```

Este comando prepara `analysis_snapshots`; si existe, actualiza su validación e índices sin borrar documentos. Antes de aplicar cambios de validación en una base con archivos existentes, comprueba que los documentos previos cumplen el nuevo formato. Para la operación habitual, configura un usuario de aplicación con permisos limitados a los datos que necesita el servicio.

Inicia el servicio en una terminal separada:

```sh
npm run db:mongo:serve
```

El proceso comprueba la conexión a MongoDB al arrancar. No crea colecciones ni índices al atender una petición. El [README del servicio](../../services/mongo-api/README.md) describe su contrato y operación.

## 6. Activar el archivo desde el terminal

Completa estas variables en `.env.local`, manteniendo las de Supabase:

```dotenv
MONGO_BRIDGE_URL=http://127.0.0.1:8788
MONGO_BRIDGE_TOKEN=EL_MISMO_TOKEN_DE_ENV_MONGO_LOCAL
```

Reinicia `npm run dev`. En tu equipo, la URL HTTP de loopback está permitida. En producción, aloja el servicio Node **por separado y detrás de HTTPS**, configura sus variables en ese alojamiento y usa una URL como `https://archivo.TU_DOMINIO`. Las variables de producción del terminal se configuran en su alojamiento, no en `.openai/hosting.json`.

Abre el terminal y guarda un cambio. Deben aparecer documentos en `analysis_snapshots` y `delivered_at` debe completarse en las entradas entregadas de `analysis_outbox`. Los accesos del usuario procesan lotes acotados: si hay muchos pendientes, varias consultas o guardados irán enviándolos. No hay un proceso programado de entrega para usuarios desconectados.

Si Atlas o el servicio no responden, Supabase conserva los datos y la interfaz puede indicar copias pendientes. Cuando se recupere la conexión, las siguientes consultas o escrituras reintentan la entrega. No cambies los IDs ni las revisiones de la cola para forzarla: el reintento con los mismos valores es idempotente.

## 7. Comprobar la implementación

Estas comprobaciones locales no necesitan credenciales reales:

```sh
npm test
npm run typecheck
npm run build
```

La suite incluye PostgreSQL real ejecutado localmente con PGlite, más pruebas de API, cola de archivos, controlador de sincronización y servicio MongoDB con repositorios de prueba. Comprueba las revisiones, el aislamiento entre usuarios y el rollback cuando falla un guardado. Esto verifica el código, no la disponibilidad, configuración de red ni credenciales de tus proyectos remotos.

Después de configurar los proyectos reales, revisa manualmente:

- Un cambio guardado aparece en Supabase y se recupera al recargar la cuenta.
- Una segunda sesión con datos antiguos produce un conflicto y conserva su borrador.
- El archivo aparece una sola vez en MongoDB al reintentar una entrega.
- Desconectar el servicio de archivo mantiene los cambios confirmados en Supabase y deja su copia pendiente.

Sin configurar ninguna variable remota, `npm run dev` conserva el modo local. Si configuras solo una parte de las variables necesarias, la interfaz informa que el guardado remoto no está disponible en lugar de presentar ese estado como una sincronización correcta.

## Recuperar una revisión histórica

El servicio permite consultar metadatos e instantáneas del propietario desde un backend autorizado. La primera versión no incluye una pantalla para navegar históricos ni una restauración automática desde MongoDB.

Para una recuperación administrativa, conserva una copia del estado vigente, obtén la instantánea del usuario correcto, valida su campo `state`, consulta la revisión actual de Supabase y guarda ese estado como **una nueva revisión** a través del flujo autenticado. Mantén el contador actual; el número de una instantánea histórica no se reutiliza como revisión vigente.

Los archivos históricos y las entradas del outbox no caducan automáticamente. Define una política de retención y copias de seguridad antes de acumular un volumen grande de datos. El [documento de diseño](../arquitectura/base-de-datos.md) detalla estos límites.
