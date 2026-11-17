# Configuración del equipo y lista de interfaz

Carpeta activa: C:\Users\maria\OneDrive\Documentos\LSW\ProyectoFinal

## Qué se comparte

El equipo comparte código, .env.example, migraciones y documentación. Cada instalación configura .env.local, que está excluido de Git. Las cuentas y claves no se crean automáticamente al descargar el proyecto. Para una entrega alojada, las claves se configuran en el servidor y se utiliza la identidad autenticada de ese entorno; local_seedy es únicamente la identidad de desarrollo local, no un sistema de acceso multiusuario.

## Primer paso: Alpaca Paper

1. Entrar a la cuenta propia de Alpaca y seleccionar Paper Trading.
2. Obtener las claves del panel API Keys de Paper.
3. Abrir .env.local y completar únicamente ALPACA_API_KEY y ALPACA_SECRET_KEY.
4. Conservar ALPACA_DATA_FEED=iex y ALPACA_OPTIONS_FEED=indicative inicialmente. La disponibilidad depende de la cuenta. Indicative no equivale a OPRA en tiempo real.
5. BROKER_OWNER_USER_ID=local_seedy corresponde a este servidor local; en alojamiento debe ser la identidad autorizada real.
6. Ejecutar npm.cmd run broker:check. Comprueba cuenta e histórico sin enviar órdenes.
7. Reiniciar npm.cmd run dev después de editar la configuración.
8. Ejecutar npm.cmd run research:check y revisar qué variables faltan. Cuenta conectada no implica disponer de todos los datos de opciones, dividendos o tasa.

No escribir claves en notas, capturas, chats o archivos compartidos. .env.local debe permanecer fuera de Git.

## Lista de interfaz para completar

- Barra superior: fuente de datos y modalidad de operación independientes; errores explícitos; ayuda y configuración.
- Mercado: datos consultados con fecha, fuente, cobertura y mensajes de datos faltantes.
- Núcleos: usar entradas observadas con procedencia. No sustituir faltantes con cifras demo en modo Alpaca.
- Estrategias: identificar contratos y vencimientos; diferenciar el ranking de una estrategia completa. Los ciclos F5 actuales siguen siendo locales.
- Operaciones: revisión, confirmación Paper, estados de orden y precio ejecutado. El servicio actual de ejecución es de acciones; opciones requiere implementación específica.
- Portafolio: separar saldo y posiciones del laboratorio de la cuenta Paper.
- Guardado: mostrar local, sincronizando, sincronizado, error o conflicto; comprobar recuperación en otra sesión.
- Entrega: conservar evidencia de conexiones, pruebas, límites y funciones pendientes.

## Bases de datos: siguiente etapa

Supabase: crear proyecto, aplicar la migración existente y configurar URL y clave secreta de servidor. MongoDB: crear base y usuario, configurar el servicio puente y comprobar archivo. Seguir docs/base-de-datos/configuracion.md. Ninguna de estas conexiones se da por lista al crear el archivo local.

## Estado

Configuración local preparada. Claves pendientes de introducir por la usuaria. No se crearon cuentas externas, no se conectaron bases y no se enviaron órdenes. La automatización permanece desactivada.
