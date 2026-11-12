# TEPIC · Options Lab

Terminal de opciones en español con diseño oscuro y naranja, inspirado en la distribución de un bróker. Aplicación independiente: no está afiliada a Alpaca ni al Tecnológico de Tepic.

## Ejecutar

Requiere Node.js 22.18 o posterior para ejecutar las pruebas TypeScript directamente; se usó Node 25.8.0.

```sh
npm ci
npm run dev
```

Abre la URL que imprime el servidor (normalmente http://localhost:5173). Para indicar otro puerto: `npm run dev -- --port 3000`.

```sh
npm test
npm run typecheck
npm run build
```

La evidencia y los pasos para repetir la prueba de navegador están en [docs/verificacion.md](docs/verificacion.md).

## Funciones

- **Ciclos de inversión:** posiciones multipierna, efectivo, acciones, asignaciones de práctica, cierres y resultado realizado/no realizado para Wheel, PMCC, Backspread y Gamma Scalping. Lee [el recorrido de cada ciclo](docs/ciclos-de-inversion.md).

- Fechas y horario de operación entre 09:30 y 16:00 ET. Se usa la zona America/New_York; no se supone una diferencia UTC fija.
- Histórico de velas sintéticas por fechas inclusivas y temporalidad (5m, 15m, 1h, 1d), sesiones lunes–viernes 09:30–16:00 ET con horario de verano, gráfico velas/línea, consulta OHLC con ratón o teclado y exportación completa a CSV. No modela festivos ni medias sesiones. Rangos grandes se agrupan solo en la vista, conservando extremos y volumen.
- Siete cores independientes: Black–Scholes–Merton, griegas, equilibrio/probabilidad, volatilidad, tendencia, liquidez/volumen y riesgo. Sus indicadores se activan en la gráfica y sus puntuaciones tienen el mismo peso en el ranking. Los cuatro últimos son la ampliación propuesta ante la falta de nombres específicos en la solicitud.
- Comparación inmediata de las cuatro estrategias y top tres de empresas; pulsar una empresa la muestra en la gráfica. Las listas guardadas son copias del análisis, no cambian con la vista previa.
- F5: The Wheel, Poor Man’s Covered Call (PMCC), Call Ratio Backspread 1:2 y Gamma Scalping.
- Botón Generar oportunidades: calcula compatibilidad, ordena 14 activos de muestra y guarda una nueva lista en Mis listas, conservando la configuración original.
- Listas manuales, buscador por empresa/símbolo/sector, ordenación de columnas, exportación CSV y eliminación de listas creadas.
- Simulación de compra y venta de calls/puts, strike, vencimiento, contratos, prima límite, revisión y confirmación. El registro conserva fechas y horario elegidos.
- Órdenes con filtros, exportación y eliminación del registro local; vista de portafolio de práctica y biblioteca de estrategias.
- Listas, órdenes y tasa libre de riesgo se guardan en localStorage de este navegador. No existe sincronización entre dispositivos.
- Manifest e iconos de PWA. En producción se registra un service worker que muestra una página de reconexión si falla la navegación; no se ofrece el terminal completo offline ni se cachean páginas autenticadas.
- Cada puntuación permite consultar sus motivos y parámetros originales. Consulta [la especificación y decisiones de arquitectura](docs/alcance-y-arquitectura.md) para la correspondencia con la solicitud y las guías adjuntas.

## Alcance de la simulación

Los precios, IV, volúmenes, índices y velas son ilustrativos; no son cotizaciones ni históricos reales. Cambiar el histórico modifica el gráfico sintético, no realiza un backtest ni recalibra los datos de muestra del ranking.

Las órdenes individuales registran una intención local. El nuevo laboratorio de ciclos abre y cierra posiciones de práctica, registra asignaciones según reglas educativas y ajusta las coberturas Gamma en los puntos de escenario que avanza el usuario. Nada se envía a Alpaca ni se ejecuta en un mercado. No se han incorporado credenciales de un bróker. Una integración posterior requeriría un adaptador de datos/cadenas y un servicio de órdenes autenticado con secretos en servidor.

Los ciclos usan un reloj simulado y capital de práctica inicial de $100,000. Los eventos al vencimiento aplican una convención mecánica de ejercicio dentro del dinero; las asignaciones anticipadas se fuerzan manualmente. No se predicen las asignaciones reales ni se calcula margen real de bróker. Las posiciones abiertas se valoran con BSM. Al completar una trayectoria de muestra se liquidan todas las exposiciones restantes; el usuario también puede avanzar paso a paso, renovar calls permitidas y cerrar antes del vencimiento. Se conservan los registros individuales anteriores.

El ranking es una heurística determinista de compatibilidad, no una expectativa de rendimiento. Los núcleos activos tienen el mismo peso. Cada estrategia ajusta objetivos de volatilidad, plazo, delta y prima; la puntuación se calcula con proxies de una sola opción, sin valorar el payoff completo de las estrategias multipierna. El plazo mínimo del ranking es un día, incluso para una ventana operativa intradía. La tasa de Configuración se propaga a todos los modelos.

## Modelo cuantitativo

`lib/quant.ts` implementa BSM europeo con dividendos continuos, valores por acción, 365 días al año y casos límite de vencimiento/volatilidad cero. Delta y gamma usan las unidades naturales; theta se expresa por día, vega y rho por un punto porcentual. Un contrato se simula con multiplicador 100.

Equilibrio: call = strike + prima; put = strike − prima. La probabilidad de beneficio corresponde a una sola pierna, su lado compra/venta y el umbral de equilibrio bajo la medida neutral al riesgo; no es una predicción del mundo real ni la probabilidad de toda una estrategia. No contempla ejercicio anticipado, comisiones, asignación, garantía, dividendos discretos ni financiación de la prima.

Referencias primarias: [fórmula Black–Scholes, OIC](https://www.optionseducation.org/advancedconcepts/black-scholes-formula), [griegas, OIC](https://www.optionseducation.org/advancedconcepts/volatility-the-greeks), [comportamiento del precio, OIC](https://www.optionseducation.org/referencelibrary/faq/option-price-behavior) y [opciones en Alpaca](https://docs.alpaca.markets/us/docs/options-trading).

## Código

- `app/page.tsx`: estado de la plataforma, filtros, listas, vistas y persistencia.
- `app/globals.css`: diseño responsive, navegación y componentes visuales.
- `components/market-chart.tsx`: gráfico SVG interactivo.
- `lib/chart-history.ts`: sesiones sintéticas reproducibles y agregación coherente entre temporalidades.
- `components/opportunity-overview.tsx`: comparación de estrategias y mejores empresas en vivo.
- `docs/cambios-noviembre-2026.md`: alcance, indicadores y comprobaciones de esta ampliación.
- `components/order-ticket.tsx`: formulario y confirmación de simulaciones.
- `components/cycle-lab.tsx`: configuración, avance de escenarios, posiciones, resultados e historial de ciclos.
- `lib/cycle-simulator.ts`: motor determinista de efectivo, acciones, ejercicios, asignaciones, coberturas y cierres.
- `tests/cycle-simulator.test.ts`: ciclos completos, conservación contable, pérdidas, comisiones, presupuesto y persistencia.
- `lib/quant.ts`: precios, griegas, probabilidades y ranking.
- `lib/market-data.ts`: universo y metadatos de muestra.
- `tests/quant.test.ts`: benchmarks BSM, paridad, diferencias finitas, probabilidades, extremos y selección del ranking.

React 19, TypeScript y Vinext/Vite sobre el starter de Sites. El despliegue utiliza el Worker generado en `dist/server/index.js`; la identidad del sitio está en `.openai/hosting.json`. No se requieren secretos para esta versión.
