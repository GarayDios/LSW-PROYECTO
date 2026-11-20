# TEPIC · Options Lab

Terminal de opciones en español con diseño oscuro y naranja, inspirado en la distribución de un bróker. Aplicación independiente: no está afiliada a Alpaca ni al Tecnológico de Tepic.

## Ejecutar

Requiere Node.js 22.18 o posterior para ejecutar las pruebas TypeScript directamente; se usó Node 25.8.0.

```sh
npm ci
npm run dev
```

Abre la URL que imprime el servidor (normalmente http://localhost:5173). Para indicar otro puerto: `npm run dev -- --port 3000`.

MongoDB y el servicio de brókers son auxiliares en desarrollo: si alguno falla al
iniciar, la interfaz permanece disponible y se informa el error. Las funciones de
ese servicio requieren resolver su configuración o conectividad; no se cambia
automáticamente la base de datos elegida. Si termina la interfaz, se cierran los
servicios iniciados por esa sesión.

```sh
npm test
npm run typecheck
npm run build
```

La evidencia y los pasos para repetir la prueba de navegador están en [la documentación de verificación](docs/verificacion/verificacion.md).

## Funciones

- **Gráfica técnica:** paneles RSI/MACD, ATR y volumen relativo, soportes y
  resistencias confirmados sin retrotraer la fecha conocida, marcas de compra/venta
  y regla de confluencia opcional. Vistas de 3/6 meses conservan los datos del análisis
  y del CSV. El fundamental añade 25 métricas posibles con cobertura y fuentes.
  Consulta [el estado verificable de los siete cores](docs/verificacion/estado-de-los-siete-cores.md).

- **IA según preferencias:** pronóstico experimental con histórico diario observado,
  perfil de objetivo/riesgo/capital y comparación de estructuras que respetan sus
  límites. Puede recomendar esperar; no envía órdenes. Consulta la
  [separación entre núcleo cuantitativo y siete cores](docs/arquitectura/cores-y-nucleo-cuantitativo.md)
  para el alcance, la validación y los módulos que siguen pendientes.

- **Ciclos de inversión:** posiciones multipierna, efectivo, acciones, asignaciones de práctica, cierres y resultado realizado/no realizado para Wheel, PMCC, Backspread y Gamma Scalping. Lee [el recorrido de cada ciclo](docs/usuario/ciclos-de-inversion.md).

- Fechas y horario de operación entre 09:30 y 16:00 ET. Se usa la zona America/New_York; no se supone una diferencia UTC fija.
- Histórico por fechas inclusivas y temporalidad (5m, 15m, 1h, 1d), con selector explícito entre demostración y Alpaca. Los botones 3A y 5A consultan varios años de velas diarias; se muestran fechas con año, OHLC, volumen y exportación CSV completa. El proveedor real se pagina, ajusta splits y usa el calendario para sesiones intradía, incluidos festivos y cierres anticipados. Un error del proveedor se muestra sin inventar datos de sustitución. Los rangos grandes se agrupan únicamente en la vista.
- Señales gráficas de entrada/salida por cruce SMA20/50 y RSI14, con zona de validación temporal del último 30%. La prueba histórica ejecuta en la apertura siguiente, incluye costes y compara con comprar/mantener. Son reglas educativas explicables, no predicciones garantizadas.
- Alpaca Paper con órdenes y posiciones conciliadas, cantidades y precios ejecutados, salidas por reglas o bracket GTC opcional, límites de capital/exposición/pérdida diaria y pausa de nuevas entradas. El servicio usa SQLite duradero e identificadores para evitar duplicados. Las opciones F5 siguen en el laboratorio de simulación.
- Comparación de hasta seis empresas en uno, tres y cinco años: SMA20/50 con y sin filtro RSI14, costes iguales, resultados negativos, validación por ventanas, incertidumbre descriptiva y exportación CSV.
- Núcleo cuantitativo con Black–Scholes–Merton, griegas y equilibrio/probabilidad. El ranking conserva siete criterios históricos de evaluación, incluidos volatilidad, tendencia, liquidez/volumen y riesgo; sus identificadores no representan los siete cores funcionales de la arquitectura confirmada.
- Comparación inmediata de las cuatro estrategias y top tres de empresas; pulsar una empresa la muestra en la gráfica. Las listas guardadas son copias del análisis, no cambian con la vista previa.
- F5: The Wheel, Poor Man’s Covered Call (PMCC), Call Ratio Backspread 1:2 y Gamma Scalping.
- Generar oportunidades calcula compatibilidad y conserva la configuración original. En demo usa el universo de muestra; en Alpaca usa snapshots y contratos verificables, con evidencia y exclusiones cuando faltan entradas.
- Listas manuales, buscador por empresa/símbolo/sector, ordenación de columnas, exportación CSV y eliminación de listas creadas.
- Simulación de compra y venta de calls/puts, strike, vencimiento, contratos, prima límite, revisión y confirmación. El registro conserva fechas y horario elegidos.
- Órdenes con filtros, exportación y eliminación del registro local; vista de portafolio de práctica y biblioteca de estrategias.
- Sin configuración remota, listas, órdenes, ciclos y tasa se guardan en este navegador. Al conectar Supabase, se guardan por usuario y se pueden recuperar desde otros dispositivos; MongoDB archiva las revisiones confirmadas. La importación de los datos locales es explícita.
- Manifest e iconos de PWA. En producción se registra un service worker que muestra una página de reconexión si falla la navegación; no se ofrece el terminal completo offline ni se cachean páginas autenticadas.
- Cada puntuación permite consultar sus motivos y parámetros originales. Consulta [la especificación y decisiones de arquitectura](docs/arquitectura/alcance-y-arquitectura.md) para la correspondencia con la solicitud y las guías adjuntas.

## Alcance de la simulación

El análisis actual obtiene automáticamente los dividendos históricos y estima
su rendimiento anual; cuando falta IV publicada intenta calcularla con una
cotización válida. Las estimaciones se identifican y los ajustes técnicos quedan
plegados. Consulta [el flujo simplificado y su verificación](docs/cambios/datos-automaticos-y-vista-simple.md).

En demostración, el ranking, la IV, los dividendos y las opciones son ilustrativos. El modo Alpaca usa velas reales y contratos/snapshots de opciones; muestra feed, cobertura, procedencia y datos faltantes. SEC y FRED aportan estados financieros y contexto macro cuando se configuran. El feed indicative usa cotizaciones modificadas y se etiqueta como estimación. Las cadenas actuales no se usan para reconstruir decisiones históricas. El panel permite consultar variables actuales explícitamente.

Las órdenes individuales de opciones y los ciclos siguen siendo simulaciones del terminal. El servicio separado puede enviar compras y salidas de acciones a Alpaca Paper cuando tiene credenciales, habilitación de servidor y un plan activado. No hay envío a una cuenta de dinero real. Una orden enviada no equivale a ejecución confirmada. El código compartido excluye claves. En esta revisión se verificaron datos reales mediante consultas de lectura; las pruebas de órdenes y alertas usan respuestas simuladas.

Los ciclos usan un reloj simulado y capital de práctica inicial de $100,000. Los eventos al vencimiento aplican una convención mecánica de ejercicio dentro del dinero; las asignaciones anticipadas se fuerzan manualmente. No se predicen las asignaciones reales ni se calcula margen real de bróker. Las posiciones abiertas se valoran con BSM. Al completar una trayectoria de muestra se liquidan todas las exposiciones restantes; el usuario también puede avanzar paso a paso, renovar calls permitidas y cerrar antes del vencimiento. Se conservan los registros individuales anteriores.

El ranking observado es una heurística de compatibilidad con pesos configurables,
no una expectativa de rendimiento. Analiza las piernas de cada estructura, costes,
capital y escenarios. El modo estimado requiere elección explícita y conserva la
procedencia de cada supuesto; no convierte HV ni primas teóricas en cotizaciones.
PMCC incluye reserva ante asignación y financiación; Gamma tiene un replay separado
de coberturas. La validación histórica de opciones importa cadenas y salidas con
fecha, separa entrenamiento de prueba y no acredita capacidad predictiva sin datos.
La demo conserva parámetros ilustrativos. Los fundamentales y noticias son contexto.

Consulta [el cierre de pendientes y sus límites](docs/verificacion/cierre-pendientes.md)
y [la guía para explicar arquitectura, fórmulas y estrategias](docs/entrega/guia-defensa.md).
`npm run verify:clean` comprueba una instalación aislada sin secretos. Para FRED,
agrega tu clave personal a `.env.local`, reinicia y ejecuta `npm run fred:check`.

Para la puesta en marcha y los pendientes de configuración consulta [el estado de esta revisión](docs/cambios/ciclo-operativo-y-datos.md), [riesgo y ejecución](docs/integraciones/riesgo-y-ejecucion.md) y [servicio continuo y alertas](docs/integraciones/servicio-continuo.md). `npm run research:check` y `npm run db:check` comprueban las conexiones sin escribir registros. No se ha desplegado un servicio remoto.

## Modelo cuantitativo

`src/cores/` implementa BSM europeo con dividendos continuos, valores por acción, 365 días al año y casos límite de vencimiento/volatilidad cero. Delta y gamma usan las unidades naturales; theta se expresa por día, vega y rho por un punto porcentual. Un contrato se simula con multiplicador 100.

Equilibrio: call = strike + prima; put = strike − prima. La probabilidad de beneficio corresponde a una sola pierna, su lado compra/venta y el umbral de equilibrio bajo la medida neutral al riesgo; no es una predicción del mundo real ni la probabilidad de toda una estrategia. No contempla ejercicio anticipado, comisiones, asignación, garantía, dividendos discretos ni financiación de la prima.

Referencias primarias: [fórmula Black–Scholes, OIC](https://www.optionseducation.org/advancedconcepts/black-scholes-formula), [griegas, OIC](https://www.optionseducation.org/advancedconcepts/volatility-the-greeks), [comportamiento del precio, OIC](https://www.optionseducation.org/referencelibrary/faq/option-price-behavior) y [opciones en Alpaca](https://docs.alpaca.markets/us/docs/options-trading).

## Organización del código

El [mapa del proyecto](docs/arquitectura/estructura-del-proyecto.md) explica cada sección y dónde hacer cambios.

| Sección | Carpeta | Contenido |
|---|---|---|
| Entrada y estilos | `app/` | Página, layout y estilos globales del framework. |
| Siete cores funcionales | `src/cores/01-...` a `07-...` | Lógica real de técnico, IA, noticias, fundamental, señales, riesgos y portafolio. Empieza por [su guía](src/cores/README.md). |
| Núcleo cuantitativo y evaluación | `src/cores/nucleo-cuantitativo/`, `src/cores/evaluacion/` | Fórmulas matemáticas separadas del ranking y las estructuras de opciones. |
| Pantalla de IA | `src/features/intelligence/` | Formulario del perfil y presentación del pronóstico y las alternativas. |
| APIs e integración | `src/api/` | Autenticación de ChatGPT y conectores del servidor. |
| Funciones del terminal | `src/features/` | Terminal, mercado, oportunidades, órdenes, ciclos y estrategias. |
| Pantallas de análisis y servicio | `src/features/analysis/`, `src/features/trading/`, `services/trading-runner/` | Interfaz de señales, planes, eventos y ejecución Paper. |
| Interfaz compartida | `src/components/`, `src/hooks/`, `src/lib/` | Componentes UI, registro PWA, hooks y utilidades comunes. |
| Base de datos | `src/db/`, `supabase/`, `services/mongo-api/` | Modelo, migración PostgreSQL, archivo MongoDB y acceso desde servidor. |
| Pruebas | `tests/cores/`, `tests/cycles/`, `tests/market/`, `tests/database/` | Modelos, persistencia, aislamiento y sincronización. |
| Herramientas | `scripts/` | Instalación, compilación, verificación, exportación y empaquetado. |
| Documentación | `docs/` | Usuario, guías, arquitectura, verificación y cambios. |

La [guía de usuario](docs/usuario/guia-de-usuario.md), la [guía PMCC/Backspread](docs/guias/Guia-PMCC-Call-Ratio-Desde-Cero.pdf) y el [registro de cambios](docs/cambios/cambios-noviembre-2026.md) están agrupados según su propósito.

## Supabase y MongoDB

Consulta el [modelo y los diagramas](docs/arquitectura/base-de-datos.md) y la [guía de configuración desde cero](docs/base-de-datos/configuracion.md). La migración crea siete tablas con aislamiento por usuario, revisiones para detectar conflictos y una cola transaccional de archivo. El servicio Node de MongoDB conserva instantáneas inmutables y admite reintentos.

El terminal sigue funcionando sin proyectos remotos. Para conectarlos, prepara Supabase, aplica `supabase/migrations/202611130001_terminal_persistence.sql` y configura las variables exclusivas del servidor usando `.env.example`. Para MongoDB, configura `.env.mongo.local`, ejecuta `npm run db:mongo:setup` y `npm run db:mongo:serve` en otra terminal. El servicio MongoDB requiere alojamiento Node independiente y HTTPS en producción.

`npm run test:db` comprueba SQL, API, sincronización y archivo sin credenciales. La prueba de integración MongoDB se habilita con `MONGODB_TEST_URI`; sin esa variable se omite. La conexión a tus proyectos remotos debe comprobarse después de configurarlos.

React 19, TypeScript y Vinext/Vite sobre el starter de Sites. La identidad del sitio está en `.openai/hosting.json`. El modo local no requiere secretos; la persistencia remota utiliza las variables documentadas en `.env.example`.

## Observaciones del profesor y Alpaca Paper

La [revisión vigente del profesor](docs/mejoras-profesor/revision-manual-2026-11-18.md)
añade controles de usuario, destinos de «Operar», niveles en la gráfica y órdenes
manuales. El servicio arranca sin ejecución automática. Alpaca Paper se verificó
en lectura; Webull tiene un adaptador de pruebas y su conexión requiere que el
usuario obtenga acceso OpenAPI. El adaptador Webull actual opera acciones, no Wheel.

El [recorrido de cada observación y su evidencia](docs/mejoras-profesor/observaciones-y-evidencia.md) permite explicar las carpetas, el histórico, las señales y la automatización. La [guía de Alpaca y del servicio](docs/integraciones/alpaca-y-automatizacion.md) describe las claves de práctica y cómo ejecutar `npm run trading:serve` con `.env.trading.local`. La automatización permanece desactivada hasta revisar y activar un plan.

`npm run test:trading` comprueba las reglas, la paginación real, los permisos y los controles de Paper con respuestas controladas. `npm run test:browser -- history` revisa la interfaz con un proveedor simulado. Las conexiones reales requieren configurar la cuenta. Webull OpenAPI tiene requisitos regionales documentados; la integración ejecutable elegida es Alpaca Paper.
