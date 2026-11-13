# Evidencia de verificación

## Conexión Paper y servicio local — 13 de noviembre de 2026

- Se comprobó una conexión real de solo lectura con Alpaca Paper: cuenta `ACTIVE` e histórico AAPL con 753 velas diarias entre 2023-11-13 y 2026-11-12, feed IEX.
- La interfaz autenticada devuelve HTTP 200 al consultar cuenta, histórico, estado del servicio y planes. Se corrigió el transporte de servidor para usar `redirect: manual`, compatible con Workerd; las respuestas 3xx se rechazan sin reenviar credenciales.
- El servicio local permite preparar y activar planes desde la interfaz. En el arranque verificado había cero planes activos y no se enviaron órdenes al bróker.
- El rango de operación seleccionado se copia al plan. Si se cambia el rango después de prepararlo, la interfaz bloquea la activación del plan antiguo y mantiene disponible su desactivación.
- `npm test`: 117 pruebas aprobadas, 0 fallos y 1 integración MongoDB omitida. TypeScript y compilación correctos.
- `node scripts/verify-browser.mjs automation`: flujo de fechas, creación desactivada, activación explícita y desactivación después de cambiar el rango aprobado; las mutaciones de planes de esa prueba se simularon por completo, sin llegar al servicio real.
- Se comprobó que ninguna clave ni token local aparece en los archivos generados de `dist/`. Los archivos de entorno y la base operativa están ignorados por Git.

## Histórico, señales y Alpaca Paper — 13 de noviembre de 2026

- `npm test`: 113 pruebas aprobadas, 0 fallos y 1 prueba MongoDB omitida por falta de una URI de integración.
- `npm run typecheck` y `npm run build`: correctos. Se generan las rutas de histórico, empresa, cuenta Paper, estado, automatización y persistencia.
- El proveedor de datos se prueba con paginación de páginas cortas, rango de tres años, OHLC inválido, horarios de Nueva York, DST, sesiones reducidas, huecos de IEX, cierre diario completo y errores de permisos. Las consultas fallidas nunca se convierten en velas sintéticas.
- El motor se prueba para comprobar causalidad: añadir datos futuros no cambia ninguna señal anterior. La validación usa el último 30%, ejecución en la siguiente apertura y costes.
- La cuenta Paper se prueba con hosts fijos, propietario autenticado, permisos, efectivo, posiciones, órdenes duplicadas y respuestas ambiguas. El servicio verifica el calendario oficial y conserva planes/reservas tras reiniciar SQLite; bloquea cotizaciones antiguas y cobertura histórica incompleta.
- Recorridos Chrome `features`, `cycles`, `history` y `persistence`: aprobados con 0 excepciones de JavaScript. `history` utiliza un proveedor simulado identificado como prueba para comprobar años, señales, rango, CSV, identidad de empresa, errores y móvil; `persistence` simula únicamente su API.
- El bundle del navegador no contiene los nombres de variables secretas ni los clientes de servidor.

No hay claves de Alpaca configuradas y no se enviaron órdenes a una cuenta externa. El usuario eligió Alpaca Paper. La verificación con el proveedor real y la activación de un plan requieren seguir la [guía de Alpaca y automatización](../integraciones/alpaca-y-automatizacion.md). La [matriz de observaciones del profesor](../mejoras-profesor/observaciones-y-evidencia.md) detalla la implementación y sus límites.

## Supabase y MongoDB — 13 de noviembre de 2026

- `npm test`: 76 pruebas aprobadas, 0 fallos y 1 integración MongoDB omitida al no existir `MONGODB_TEST_URI`.
- Las migraciones se ejecutaron con PostgreSQL local mediante PGlite: permisos/RLS, aislamiento de propietarios, estados completos, revisiones, rollback y cola transaccional correctos.
- La prueba de integración conecta el adaptador HTTP con ese PostgreSQL y simula una caída del archivo: el estado queda guardado y la entrega se recupera al volver el servicio.
- `npm run typecheck` y `npm run build`: correctos. El bundle del navegador no contiene los nombres de claves secretas ni los adaptadores de servidor.
- `node scripts/verify-browser.mjs features` y `cycles`: recorridos aprobados, 0 errores de JavaScript.
- `node scripts/verify-browser.mjs persistence`: carga protegida, importación explícita, guardados seriales, conflictos, borrador, recarga y móvil aprobados; solo `/api/persistence` se simula para comprobar la interfaz, con 0 errores de JavaScript.
- `GET /api/persistence` real en desarrollo sin variables devuelve `{"mode":"local"}`.

No se crearon proyectos de Supabase ni Atlas y no se verificó una conexión remota: el usuario solicitó dejar la configuración preparada. La [guía de conexión](../base-de-datos/configuracion.md) explica cómo completar esa verificación.

## Reorganización por secciones — 13 de noviembre de 2026

Comprobaciones realizadas en Windows con Node 25.8.0 después de mover el código a `src/` y separar los siete cores:

- `npm test`: 31 pruebas aprobadas, 0 fallos.
- `npm run typecheck` y `npm run build`: salida 0.
- `node scripts/verify-learning-examples.mjs`: ejemplos de PMCC y Backspread correctos.
- `node scripts/verify-browser.mjs features`: indicadores de los siete cores, comparación de estrategias, selección de empresas, histórico, CSV, generación y vista móvil correctos.
- `node scripts/verify-browser.mjs cycles`: validación de capital, revisión, asignaciones Wheel y PMCC, cierres de las cuatro estrategias, coberturas Gamma, pérdidas, persistencia y vista móvil correctos.
- Ambos recorridos se ejecutaron contra el servidor local de desarrollo y terminaron con 0 errores de JavaScript.
- Equivalencia exacta de los cores frente a la versión anterior: 3,000 valoraciones BSM, 6,000 probabilidades y 9,144 rankings. Los dos PDFs se conservaron sin modificar su contenido.

El [mapa del proyecto](../arquitectura/estructura-del-proyecto.md) describe las rutas actuales.

## Verificación anterior

Fecha: 9 de noviembre de 2026. Entorno Windows, Node 25.8.0, Chrome headless.

- `node --test tests/cores/quant.test.ts`: 11 pruebas aprobadas, 0 fallos. La ruta se actualizó al reorganizar el proyecto; el resultado corresponde a la verificación de la fecha indicada.
- `node node_modules/typescript/bin/tsc --noEmit`: salida 0, sin errores.
- `node <plugin-sites>/scripts/build-site.mjs`: compilación completa de Vinext/Vite; Worker y recursos cliente generados.
- Recorrido automatizado contra el Worker de producción en localhost: creación de listas de 14 empresas, ranking descendente, consulta de motivos/tasa original, cambio de estrategia, búsqueda, estado vacío, compra de call, venta de put, revisión/confirmación, filtro de ventas y persistencia tras recarga.
- Validaciones verificadas: fin operativo anterior al inicio y ausencia de núcleos impiden generar una lista.
- Vista móvil de 390 × 844: sin desbordamiento horizontal de la página. Escritorio revisado a 1440 × 1000.
- PWA de producción: manifest sin errores, página controlada por el service worker y fallback explícito de desconexión verificado con la red desactivada tanto en la página como en el worker.
- Excepciones de JavaScript en el recorrido final: 0.

El recorrido reproducible está en `scripts/verify-browser.mjs`. Requiere una instancia local sirviendo el proyecto y Chrome instalado; se puede indicar otro ejecutable mediante `CHROME_BIN`. La URL por defecto es http://127.0.0.1:5173. Para revisar producción con PowerShell:

```powershell
# Después de compilar, en una terminal:
npm start -- --port 3001

# En otra terminal:
$env:QA_URL='http://127.0.0.1:3001'
$env:QA_PWA='1'
npm run test:browser
```

Las capturas se guardan en `outputs/` (ignorado por Git). La verificación utiliza un perfil temporal aislado y no interactúa con la cuenta de bróker del usuario.

No se verificó conexión a mercados, API de órdenes, rentabilidad, estrategia multipierna ni cuenta real; esas capacidades no están implementadas en esta versión.
