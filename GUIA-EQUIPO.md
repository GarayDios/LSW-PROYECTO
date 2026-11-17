# Ejecutar la entrega del equipo

1. Instala Node.js 22.18 o superior y Git.
2. Clona el repositorio y cambia a la rama de entrega indicada por María.
3. En la carpeta con package.json ejecuta `npm.cmd ci` (Windows) o `npm ci`.
4. Copia `.env.example` a `.env.local`. Solicita las credenciales por un canal privado; nunca las subas a GitHub.
5. Completa Supabase, Alpaca Paper, FRED y SEC según la plantilla. Para MongoDB completa MONGODB_URI, MONGO_BRIDGE_TOKEN y MONGO_BRIDGE_URL=http://127.0.0.1:8788. Autoriza la IP del equipo en Atlas. No ejecutes migraciones sobre una base compartida ya preparada.
6. Para la identidad de desarrollo compartida usa BROKER_OWNER_USER_ID=local_seedy. No es autenticación de producción.
7. Ejecuta `npm.cmd run dev`. Inicia interfaz y MongoDB si está configurado. Abre la URL que imprime la terminal. No inicies otro MongoDB en el mismo puerto.
8. Si solicita sesión, usa el enlace de inicio de sesión de la aplicación. En Configuración selecciona Supabase o MongoDB. Cada base conserva sus datos por separado.

Sin credenciales se puede usar el almacenamiento del navegador; las fuentes externas no estarán disponibles. Los datos de las bases no están incluidos en Git: se consultan en los servicios configurados. Los ciclos y las órdenes de opciones son simulaciones locales; sus resultados no son el saldo de Alpaca Paper. Los supuestos de las griegas educativas no completan el ranking observado.

## Comprobaciones

`npm.cmd run typecheck`

`npm.cmd test`

`npm.cmd run db:check:supabase`

`npm.cmd run db:check:mongo`

El servicio de automatización de acciones es independiente y no se activa con este comando. No habilitarlo para reproducir las pruebas locales. Las claves, node_modules y archivos generados se excluyen del repositorio.
