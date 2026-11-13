# Verificación del ciclo operativo y los datos

Comprobaciones realizadas en Windows con Node 25.8.0 sobre el checkout local:

| Comprobación | Resultado |
|---|---|
| `npm test` | 167 casos: 166 aprobados, uno omitido, cero fallos |
| `npm run typecheck` | Aprobado |
| `npm run build` | Aprobado; incluye `/api/research/comparison` |
| `npm run test:browser -- automation` | Fechas, planes, activación/desactivación, bracket optativo y pausa de entradas con API simulada; cero errores de JavaScript |
| `npm run test:browser -- comparison` | Pérdidas, exclusiones, ventanas, CSV, límite de empresas y anchura móvil con API simulada; cero errores de JavaScript |
| `npm run research:check` | Lectura real de Alpaca: velas, opciones indicative y noticias disponibles; SEC/FRED sin configuración |
| `npm run db:check` | Supabase y Mongo sin configuración; no se escribieron datos |

Las pruebas de trading verifican pausa durante una consulta, salidas mientras las entradas están pausadas, bracket y sus dos hijos, recuperación tras reinicio, take profit parcial, stop reducido, IDs desconocidos, cancelación de entradas GTC fuera de ventana y señal de salud cuando el loop se atasca. Las alertas prueban persistencia del reintento, deduplicación, aislamiento por propietario y entrega solo tras 2xx.

El caso omitido es la integración contra un Mongo real, que necesita una instancia configurada. La migración Supabase se ejecuta contra PostgreSQL local en las pruebas mediante PGlite; no demuestra conexión a un proyecto Supabase remoto. Los contenedores no se construyeron porque Docker no está instalado.

No se enviaron órdenes externas, no se activó un plan real del servicio y no se enviaron alertas a destinatarios externos. Las consultas reales fueron de lectura. Los pantallazos y perfiles de navegador se generan en carpetas excluidas de Git.

Para repetir las pruebas de navegador, usa `npm run dev` y luego cada modo por separado. Requieren Chrome; `CHROME_BIN` y `QA_URL` permiten ajustar el ejecutable y la URL. Los modos de automatización interceptan mutaciones para que la comprobación no opere contra una cuenta.
