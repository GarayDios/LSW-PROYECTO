# Estructura del proyecto

Los siete cores funcionales y sus cálculos están en `src/cores/`, separados del núcleo cuantitativo. Cada carpeta numerada tiene un README y un `index.ts`. Las pantallas permanecen en `src/features/`, los adaptadores en `src/api/` y la ejecución en `services/trading-runner/`. Empieza por [la guía de cores para la revisión](../../src/cores/README.md).

El código se agrupa por sección. `app/` conserva los puntos de entrada del framework y `src/` contiene la implementación de la aplicación.

```text
tepic-terminal/
├── app/                       Página, layout y estilos globales
├── src/
│   ├── cores/                 Lógica de los siete cores y biblioteca matemática
│   │   ├── 01-analisis-tecnico/        Indicadores y métricas de mercado
│   │   ├── 02-inteligencia-artificial/ Predicción y preferencias
│   │   ├── 03-noticias-financieras/    Normalización y fechas de noticias
│   │   ├── 04-analisis-fundamental/    Hechos SEC y ratios financieros
│   │   ├── 05-indicadores-y-senales/   Reglas y validación de señales
│   │   ├── 06-gestion-de-riesgos/      Exposición, delta y límites
│   │   ├── 07-gestion-de-portafolio/   Posiciones y contabilidad de ciclos
│   │   ├── nucleo-cuantitativo/        BSM, griegas, equilibrio y probabilidad
│   │   ├── evaluacion/                Ranking y estructuras de opciones
│   │   ├── compartido/                Tipos, procedencia y normalización
│   │   ├── catalog.ts                 Los siete cores funcionales
│   │   └── index.ts                   Entrada compatible del terminal
│   ├── api/
│   │   ├── auth/              Autenticación de ChatGPT
│   │   ├── connectors/        Cliente, contrato, contexto y errores
│   │   ├── brokers/           Cliente Alpaca Paper y requisitos Webull
│   │   ├── market/            Histórico del proveedor y normalización de velas
│   │   ├── research/          Adaptadores SEC, Alpaca y FRED
│   │   ├── trading/           Permisos, estado de cuenta y proxy de automatización
│   │   └── persistence/       Validación y guardado autenticado del terminal
│   ├── features/
│   │   ├── terminal/          Estado, navegación, listas y persistencia
│   │   ├── market/            Datos de muestra, histórico y gráfico
│   │   ├── analysis/          Pantallas de señales y comparación
│   │   ├── intelligence/      Formulario del perfil y pantalla de IA
│   │   ├── trading/           Panel de cuenta, planes y registro Paper
│   │   ├── opportunities/     Comparación de estrategias y empresas
│   │   ├── persistence/       Guardado, importación y sincronización por usuario
│   │   ├── orders/            Formulario y revisión de órdenes simuladas
│   │   ├── cycles/            Interfaz y estilos de los ciclos
│   │   └── strategies/        Catálogo de estrategias F5
│   ├── components/
│   │   ├── ui/                Componentes visuales compartidos
│   │   └── pwa/               Registro del service worker
│   ├── hooks/                 Hooks compartidos
│   ├── lib/                   Utilidades compartidas
│   └── db/                    Contratos y acceso HTTP a Supabase y al archivo MongoDB
├── tests/
│   ├── cores/                 Modelos, probabilidades y ranking
│   ├── cycles/                Simulación y contabilidad de ciclos
│   ├── market/                Histórico y agregación de velas
│   ├── trading/               Señales, proveedores, permisos y ejecución Paper
│   └── database/              SQL, API, archivos y sincronización
├── docs/
│   ├── usuario/               Manual y recorrido de ciclos
│   ├── guias/                 Guía PMCC/Backspread en HTML y PDF
│   ├── arquitectura/          Alcance y mapa del proyecto
│   ├── verificacion/          Evidencia y procedimiento de comprobación
│   ├── base-de-datos/         Configuración de los proyectos remotos
│   └── cambios/               Registro de ampliaciones
├── public/                    Iconos, manifest, recursos y service worker
├── scripts/                   Herramientas de desarrollo y entrega
├── worker/                    Entrada del servidor Cloudflare
├── supabase/                  Migraciones PostgreSQL
├── services/mongo-api/         Servicio Node, colección e índices MongoDB
├── services/trading-runner/    Evaluación continua, planes y reservas en SQLite
├── drizzle/                   Metadatos vacíos heredados de D1; no se utilizan
└── vendor/                    CSS y licencias externas incluidas
```

## Dónde hacer cada cambio

| Cambio | Archivos o carpeta |
|---|---|
| Fórmulas BSM, griegas, equilibrio y probabilidad | `src/cores/nucleo-cuantitativo/`. |
| Lógica de cada core | Su carpeta numerada en `src/cores/`. |
| Media de criterios, parámetros por estrategia o desempates | `src/cores/evaluacion/`. |
| Títulos y responsabilidades de los siete cores | `src/cores/catalog.ts`. |
| Títulos de los criterios históricos del ranking | `src/cores/evaluacion/catalog.ts`. |
| Autenticación y datos del usuario de ChatGPT | `src/api/auth/chatgpt-auth.ts`. |
| Llamadas a conectores | `src/api/connectors/client.ts`; contrato y contexto junto a él. |
| Errores recuperables de conectores | `src/api/connectors/errors.mts` y `connector-error.tsx`. |
| Flujo principal, filtros, listas, órdenes guardadas y navegación | `src/features/terminal/terminal.tsx`. |
| Empresas de muestra | `src/features/market/data.ts`. |
| Sesiones sintéticas y agregación de velas | `src/features/market/chart-history.ts`. |
| Gráfico e indicadores visuales | `src/features/market/components/market-chart.tsx`. |
| Comparador de empresas y estrategias | `src/features/opportunities/opportunity-overview.tsx`. |
| Revisión y confirmación de órdenes | `src/features/orders/order-ticket.tsx`. |
| Contabilidad, escenarios, asignaciones y cierres | `src/cores/07-gestion-de-portafolio/cycle-simulator.ts`. |
| Formulario e historial de ciclos | `src/features/cycles/cycle-lab.tsx` y `cycle-lab.css`. |
| Descripción de Wheel, PMCC, Backspread y Gamma Scalping | `src/features/strategies/catalog.ts`. |
| Componentes comunes y aspecto general | `src/components/ui/` y `app/globals.css`. |
| Esquema y acceso a datos | `supabase/migrations/` y `src/db/`. |
| Colección y archivo MongoDB | `services/mongo-api/`. |
| Guardado de datos del terminal | `src/features/persistence/`; API en `app/api/persistence/route.ts`. |
| Velas reales, calendario y paginación | `src/api/market/alpaca-history.ts`. |
| Cuenta y órdenes de práctica | `src/api/brokers/alpaca/client.ts`; acceso autorizado en `src/api/trading/handlers.ts`. |
| Reglas de entrada y prueba temporal | `src/cores/05-indicadores-y-senales/signals.ts`. |
| Ejecución automática con el navegador cerrado | `services/trading-runner/`; requiere un proceso activo y almacenamiento duradero. |

`src/api/` reúne los adaptadores y permisos de datos y brókers. Las rutas HTTP se declaran en `app/api/`; las consultas externas y secretos permanecen en el servidor. El envío a los entornos de práctica requiere configuración, revisión y confirmación manual. Las noticias y fundamentales conservan su procedencia; el enlace a Finviz es una consulta externa y no cambia la fuente SEC del terminal.

Los imports con `@/` apuntan a `src/`. Las funciones que se ejecutan directamente con Node en las pruebas usan rutas relativas con extensión `.ts`.

## Scripts y configuración

Los comandos siguen definidos en `package.json`. Los scripts de instalación, ejecución, Vite y vista previa de conectores conservan sus rutas en `scripts/` para mantener la integración de Sites. `vite.config.ts`, `next.config.ts`, `tsconfig.json`, `components.json` y los demás archivos de configuración permanecen en la raíz.

- `scripts/verify-browser.mjs`: recorridos del terminal en el navegador.
- `scripts/verify-learning-examples.mjs`: ejemplos numéricos de la guía.
- `scripts/export-learning-guide.mjs`: genera el PDF desde `docs/guias/guia-pmcc-call-ratio-desde-cero.html`.
- `scripts/package-for-classmates.py`: empaqueta el código organizado y la documentación para compartir.

Para comprobar cambios de código, ejecuta `npm test`, `npm run typecheck` y `npm run build`. Los recorridos de navegador se explican en [verificación](../verificacion/verificacion.md).

## Documentación relacionada

- [Alcance y arquitectura](alcance-y-arquitectura.md).
- [Núcleo cuantitativo y siete cores](cores-y-nucleo-cuantitativo.md).
- [Comparación de SEC y Finviz](../integraciones/sec-y-finviz.md).
- [Modelo de base de datos](base-de-datos.md) y [configuración de Supabase y MongoDB](../base-de-datos/configuracion.md).
- [Observaciones del profesor](../mejoras-profesor/observaciones-y-evidencia.md) y [Alpaca Paper y automatización](../integraciones/alpaca-y-automatizacion.md).
- [Manual de usuario](../usuario/guia-de-usuario.md) y [manual en PDF](../usuario/guia-de-usuario.pdf).
- [Ciclos de inversión](../usuario/ciclos-de-inversion.md).
- [Guía PMCC/Backspread en PDF](../guias/Guia-PMCC-Call-Ratio-Desde-Cero.pdf) y [HTML editable](../guias/guia-pmcc-call-ratio-desde-cero.html).
- [Cambios de noviembre de 2026](../cambios/cambios-noviembre-2026.md).
