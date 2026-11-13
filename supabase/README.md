# Base principal: Supabase / PostgreSQL

Aplica `migrations/202611130001_terminal_persistence.sql` una sola vez en el editor SQL de tu proyecto Supabase, o mediante su flujo de migraciones. No se ejecuta DDL al atender peticiones del terminal. Conserva las migraciones aplicadas sin modificarlas; los cambios siguientes deben usar un nuevo archivo.

El servidor usa una clave secreta de Supabase y las funciones `load_terminal_state`, `save_terminal_state`, `list_analysis_outbox` y `mark_analysis_delivered`. Los roles del navegador (`anon` y `authenticated`) no tienen acceso a esas funciones ni a las tablas; todas las tablas tienen RLS habilitado. La API del proyecto verifica la identidad de Sites y suministra el `owner_id`, de tipo texto. No requiere introducir Supabase Auth ni una tabla `auth.users`.

`terminal_profiles` mantiene la revisión de cada usuario; `terminal_preferences`, `watchlists`, `watchlist_items`, `paper_orders` e `investment_cycles` conservan sus datos. Los ciclos son agregados JSONB: configuración, efectivo, posiciones y eventos se guardan en la misma transacción. Listas y elementos mantienen un orden explícito. Los IDs de listas, órdenes y ciclos son únicos dentro de cada usuario.

Cada guardado compara la revisión esperada y reemplaza el estado del usuario de forma atómica. Un estado desactualizado genera `PT409`. La misma transacción genera un archivo pendiente en `analysis_outbox`, incluso si MongoDB todavía no está configurado; la entrega se confirma únicamente después de que este acepte el documento. La combinación usuario/revisión identifica una sola instantánea. Los límites son 200 listas, 5,000 órdenes y 200 ciclos; el estado completo admite hasta 2 MiB menos 8 KiB medidos como texto JSONB UTF-8, reservando espacio para el sobre del archivo.

Los datos actuales son simulaciones. MongoDB conserva archivos históricos, mientras que PostgreSQL mantiene el estado vigente de la cuenta de práctica.

Consulta el [diseño completo](../docs/arquitectura/base-de-datos.md) y la [guía de configuración](../docs/base-de-datos/configuracion.md) para crear ambos proyectos y conectar la aplicación.
