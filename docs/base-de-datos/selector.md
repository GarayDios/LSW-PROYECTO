# Elegir Supabase o MongoDB

En Configuración, el selector permite elegir Este navegador, Supabase o MongoDB.
La elección se conserva en este navegador. Cambiar recarga el terminal y consulta la base elegida, sin copiar ni borrar datos de otra base. Se bloquea el cambio mientras hay guardados o borradores pendientes. Cada base conserva su propia revisión y sus borradores se separan por usuario y proveedor.

- Supabase usa las tablas y funciones de la migración existente. No requiere MongoDB cuando se elige explícitamente.
- MongoDB usa el servicio protegido mongo-api y la colección terminal_states, con un documento por identidad y actualización atómica por revisión. No requiere Supabase. La colección se crea con el primer guardado autorizado. Las rutas de snapshots continúan disponibles para el flujo anterior de archivo.
- Este navegador funciona sin cuentas externas y es la selección inicial.

## Crear y conectar

Primero seguir la guía configuracion.md para crear las cuentas. No introducir secretos en la interfaz ni en Git.

Supabase: configurar SUPABASE_URL y SUPABASE_SECRET_KEY en .env.local; aplicar la migración SQL existente. Verificar con npm.cmd run db:check:supabase.

MongoDB: configurar MONGODB_URI, MONGODB_DATABASE y MONGO_BRIDGE_TOKEN en .env.mongo.local. El token debe ser aleatorio, privado y tener al menos 32 caracteres. En .env.local configurar MONGO_BRIDGE_URL=http://127.0.0.1:8788 y el mismo MONGO_BRIDGE_TOKEN. Ejecutar npm.cmd run db:mongo:serve en otra terminal y comprobar con npm.cmd run db:check:mongo. No es necesario configurar Supabase para este recorrido. db:mongo:setup prepara el archivo histórico de snapshots, no es necesario para el guardado principal.

Reiniciar el terminal después de editar variables. Iniciar sesión local y seleccionar la base. Una cuenta remota vacía permite empezar sin importar o importar explícitamente datos locales. Si el servicio no está configurado o falla, se indica error, sin sustituirlo silenciosamente por guardado local.

## Prueba de entrega

1. Seleccionar Supabase, guardar una lista llamada Prueba Supabase y recargar.
2. Seleccionar MongoDB, comenzar sin importar y guardar una lista Prueba MongoDB.
3. Volver a Supabase y comprobar que conserva su lista, sin que aparezca automáticamente la de MongoDB.
4. Desconectar el servicio Mongo y comprobar que se muestra error, no éxito.
5. Verificar conflicto de revisiones y aislamiento de identidad con las pruebas automatizadas.

La identidad local de desarrollo no equivale a un inicio de sesión multiusuario de producción. Las conexiones reales están pendientes hasta crear las cuentas y configurar las credenciales. Las pruebas con dobles controlados no acreditan conexión con Atlas.
