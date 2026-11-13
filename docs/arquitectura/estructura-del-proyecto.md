# Estructura del proyecto

Las ampliaciones del ciclo operativo mantienen esta organización: cálculo y comparación en `src/features/analysis/`, rutas autenticadas en `src/api/analysis/`, controles en `src/features/trading/`, y ejecución, ledger y alertas en `services/trading-runner/`. Los contenedores están en cada servicio y la composición en `services/compose.yaml`. Consulta [el mapa y estado de la revisión](../cambios/ciclo-operativo-y-datos.md).

El código se agrupa por sección. `app/` conserva los puntos de entrada del framework y `src/` contiene la implementación de la aplicación.

```text
tepic-terminal/
├── app/                       Página, layout y estilos globales
├── src/
│   ├── cores/                 Análisis cuantitativo F0
│   │   ├── bsm.ts             Precio Black–Scholes–Merton y criterio BSM
│   │   ├── greeks.ts          Sensibilidades y criterio de griegas
│   │   ├── probability.ts     Equilibrio y probabilidad de beneficio
│   │   ├── volatility.ts      Criterio de volatilidad
│   │   ├── trend.ts           Criterio de tendencia
│   │   ├── liquidity.ts       Criterio de liquidez y volumen
│   │   ├── risk.ts            Criterio de riesgo
│   │   ├── ranking.ts         Combinación de cores y ranking de empresas
│   │   ├── catalog.ts         Nombres y descripciones de los cores
│   │   ├── types.ts           Tipos compartidos del análisis
│   │   ├── math.ts            Funciones matemáticas comunes
│   │   ├── validation.ts      Validación compartida de entradas
│   │   └── index.ts           Exportaciones públicas del análisis
│   ├── api/
│   │   ├── auth/              Autenticación de ChatGPT
│   │   ├── connectors/        Cliente, contrato, contexto y errores
│   │   ├── brokers/           Cliente Alpaca Paper y requisitos Webull
│   │   ├── market/            Histórico del proveedor y normalización de velas
│   │   ├── trading/           Permisos, estado de cuenta y proxy de automatización
│   │   └── persistence/       Validación y guardado autenticado del terminal
│   ├── features/
│   │   ├── terminal/          Estado, navegación, listas y persistencia
│   │   ├── market/            Datos de muestra, histórico y gráfico
│   │   ├── analysis/          Medias, RSI, señales causales y validación temporal
│   │   ├── trading/           Panel de cuenta, planes y registro Paper
│   │   ├── opportunities/     Comparación de estrategias y empresas
│   │   ├── persistence/       Guardado, importación y sincronización por usuario
│   │   ├── orders/            Formulario y revisión de órdenes simuladas
│   │   ├── cycles/            Motor, interfaz y estilos de los ciclos
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
| Fórmulas, puntuación o motivo de un core | Su archivo en `src/cores/`. |
| Selección y media de los cores, parámetros por estrategia o desempates | `src/cores/ranking.ts`. |
| Títulos y descripciones de los cores | `src/cores/catalog.ts`. |
| Autenticación y datos del usuario de ChatGPT | `src/api/auth/chatgpt-auth.ts`. |
| Llamadas a conectores | `src/api/connectors/client.ts`; contrato y contexto junto a él. |
| Errores recuperables de conectores | `src/api/connectors/errors.mts` y `connector-error.tsx`. |
| Flujo principal, filtros, listas, órdenes guardadas y navegación | `src/features/terminal/terminal.tsx`. |
| Empresas de muestra | `src/features/market/data.ts`. |
| Sesiones sintéticas y agregación de velas | `src/features/market/chart-history.ts`. |
| Gráfico e indicadores visuales | `src/features/market/components/market-chart.tsx`. |
| Comparador de empresas y estrategias | `src/features/opportunities/opportunity-overview.tsx`. |
| Revisión y confirmación de órdenes | `src/features/orders/order-ticket.tsx`. |
| Contabilidad, escenarios, asignaciones y cierres | `src/features/cycles/cycle-simulator.ts`. |
| Formulario e historial de ciclos | `src/features/cycles/cycle-lab.tsx` y `cycle-lab.css`. |
| Descripción de Wheel, PMCC, Backspread y Gamma Scalping | `src/features/strategies/catalog.ts`. |
| Componentes comunes y aspecto general | `src/components/ui/` y `app/globals.css`. |
| Esquema y acceso a datos | `supabase/migrations/` y `src/db/`. |
| Colección y archivo MongoDB | `services/mongo-api/`. |
| Guardado de datos del terminal | `src/features/persistence/`; API en `app/api/persistence/route.ts`. |
| Velas reales, calendario y paginación | `src/api/market/alpaca-history.ts`. |
| Cuenta y órdenes de práctica | `src/api/brokers/alpaca/client.ts`; acceso autorizado en `src/api/trading/handlers.ts`. |
| Reglas de entrada y prueba temporal | `src/features/analysis/signals.ts`. |
| Ejecución automática con el navegador cerrado | `services/trading-runner/`; requiere un proceso activo y almacenamiento duradero. |

`src/api/` reúne la infraestructura de integración que ya existe. Actualmente la aplicación usa datos de muestra y operaciones simuladas; no contiene una API de cotizaciones ni de envío de órdenes a un bróker. Las rutas HTTP que se añadan al framework deben declararse en `app/api/`; su lógica de integración puede ubicarse en `src/api/`.

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
- [Modelo de base de datos](base-de-datos.md) y [configuración de Supabase y MongoDB](../base-de-datos/configuracion.md).
- [Observaciones del profesor](../mejoras-profesor/observaciones-y-evidencia.md) y [Alpaca Paper y automatización](../integraciones/alpaca-y-automatizacion.md).
- [Manual de usuario](../usuario/guia-de-usuario.md) y [manual en PDF](../usuario/guia-de-usuario.pdf).
- [Ciclos de inversión](../usuario/ciclos-de-inversion.md).
- [Guía PMCC/Backspread en PDF](../guias/Guia-PMCC-Call-Ratio-Desde-Cero.pdf) y [HTML editable](../guias/guia-pmcc-call-ratio-desde-cero.html).
- [Cambios de noviembre de 2026](../cambios/cambios-noviembre-2026.md).
