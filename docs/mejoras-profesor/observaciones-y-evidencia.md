# Observaciones del profesor y cómo demostrarlas

> La revisión vigente está en [control del usuario y órdenes manuales, 18 de noviembre](revision-manual-2026-11-18.md).
> Sustituye la observación anterior de automatizar operaciones: los datos siguen
> automáticos, pero cada orden debe revisarse y confirmarse individualmente.
> El contenido inferior conserva la revisión anterior como antecedente.

Este documento relaciona las observaciones con el código que las atiende y con una demostración reproducible. Distingue la implementación local de una conexión real con una cuenta externa: sin claves de Alpaca Paper no se presenta una consulta de demostración como un histórico real ni una orden local como una orden enviada al bróker.

| Observación | Implementación y ubicación | Demostración y límite |
|---|---|---|
| Que funcione el histórico de velas y se marque gráficamente | [Consulta real de Alpaca](../../src/api/market/alpaca-history.ts), [carga del histórico](../../src/features/market/hooks/use-market-history.ts) y [gráfico](../../src/features/market/components/market-chart.tsx). La gráfica representa OHLC y volumen, muestra las fechas del rango, permite consultar una vela y exportar la serie. | Seleccionar una empresa y cambiar fechas o temporalidad; comprobar las etiquetas, OHLC y CSV. Con fuente Alpaca se muestran las velas recibidas del proveedor. Un error queda visible, sin reemplazar silenciosamente el histórico real por datos sintéticos. |
| Estructurar el código por carpetas para explicarlo mejor | [Mapa de carpetas](../arquitectura/estructura-del-proyecto.md): `src/cores/`, `src/api/`, `src/features/`, `src/db/`, `services/`, `supabase/` y pruebas por sección. | Seguir el recorrido pantalla → hook → API → proveedor → normalización → gráfico. Mostrar que los cores, las integraciones y las pantallas tienen responsabilidades diferentes. |
| Conectar las APIs con Alpaca/Webull | [Cliente Alpaca Paper](../../src/api/brokers/alpaca/client.ts), [configuración de servidor](../../src/api/brokers/config.ts) y [estado de Webull](../../src/api/brokers/webull/README.md). | Configurar una cuenta Alpaca Paper y verificar cuenta, activo y mercado desde el servidor. El host de operaciones queda fijado a Paper. Webull tiene OpenAPI oficial, pero el adaptador ejecutable de esta versión es Alpaca; no se afirma que Webull esté conectado. |
| Obtener información de empresas y al menos tres años de histórico | Alpaca aporta identidad del activo y barras reales. [El adaptador](../../src/api/market/alpaca-history.ts) recorre la paginación, ajusta splits y conserva la cobertura recibida. Los rangos de varios años usan velas diarias. | Usar `3A` o `5A` y revisar la primera y última fecha recibidas. La cobertura publicada por Alpaca comienza en 2016, pero un símbolo reciente puede tener menos años y el feed IEX no representa todas las bolsas. Nombre, símbolo, bolsa y negociabilidad no equivalen a un informe de fundamentales. |
| Seleccionar fechas y estimar cuándo entrar | [Reglas de señales](../../src/features/analysis/signals.ts) y [panel de análisis](../../src/features/analysis/components/analysis-panel.tsx). Cruce SMA20/SMA50 y filtro RSI14; marcas de entrada/salida en la gráfica y validación sobre el tramo final del rango. | Mostrar una señal y explicar sus parámetros. El cálculo de cada fecha usa solo información conocida hasta ese cierre; la prueba histórica ejecuta en la siguiente apertura y aplica costes. Las reglas estiman condiciones de entrada; no predicen una fecha futura ni garantizan una inversión rentable. |
| Que lo haga automáticamente | [Servicio de ejecución](../../services/trading-runner/runner.ts), [planes y eventos](../../services/trading-runner/model.ts), [persistencia del servicio](../../services/trading-runner/store.ts) y cliente Alpaca Paper. | Crear un plan desactivado, revisar fechas/límites y activarlo explícitamente con los servidores habilitados. El proceso independiente evalúa las señales aunque se cierre el navegador, mientras permanezca encendido. Solo compra acciones completas de práctica; no automatiza las estrategias F5 de opciones, ventas en corto ni cierres de posiciones manuales. |

## Guion de explicación

1. Mostrar el [mapa del proyecto](../arquitectura/estructura-del-proyecto.md) e identificar código visual, cores, APIs, persistencia y procesos independientes.
2. Abrir la aplicación con `npm run dev`. Primero identificar la fuente: demostración o Alpaca. Los datos de demostración sirven para enseñar el funcionamiento, sin afirmar que sean precios observados.
3. Elegir una empresa y seleccionar tres años de velas diarias. Con Alpaca configurado, revisar la cobertura efectiva, los ajustes por splits y la advertencia del feed IEX.
4. Modificar el rango, explorar una vela con ratón o teclado, y exportar CSV. Los valores exportados corresponden al histórico completo, aunque la vista agrupe velas para caber en pantalla.
5. Explicar la regla de medias móviles y RSI, las marcas de entrada/salida y la división temporal de validación. Mostrar también señales de espera y resultados negativos: no se optimiza el relato seleccionando únicamente operaciones ganadoras.
6. Separar tres conceptos: señal histórica, simulación del resultado y envío de una orden paper. Ninguno implica que una orden se haya ejecutado a un precio determinado.
7. Revisar un plan de automatización: propietario, símbolo, fecha inicial/final, presupuesto máximo, estado desactivado y habilitación posterior. Un rango operativo futuro hace que el servicio espere; no convierte el histórico en datos del futuro.
8. Mostrar el registro de eventos del servicio. Mercado cerrado, cotización antigua, posición existente, datos insuficientes o una respuesta ambigua deben producir espera/bloqueo, no una compra forzada.

## Comprobaciones

Desde la raíz del proyecto:

```sh
npm test
npm run typecheck
npm run build
```

Las pruebas de código usan respuestas HTTP controladas para revisar paginación, validación, aislamiento de credenciales, errores y envío seguro a Paper. El análisis se prueba con series conocidas y casos que detectan uso de información futura. La ejecución automática se prueba con un bróker de prueba inyectado y persistencia del servicio.

Una prueba con respuestas controladas no demuestra que las credenciales, permisos o disponibilidad de una cuenta externa funcionen. Para esa comprobación se necesita completar la [configuración de Alpaca y del servicio](../integraciones/alpaca-y-automatizacion.md), consultar el proveedor y verificar el resultado en el panel Paper del bróker. La guía no exige realizar operaciones con dinero real.

## Alcance que debe quedar claro en la entrega

- El histórico real depende de claves y permisos de datos. Un rango solicitado de tres años no crea datos anteriores a la cotización de una empresa ni rellena huecos del proveedor.
- Las señales son reglas causales y explicables sobre cierres diarios; no son un modelo de rentabilidad garantizada ni un asesoramiento personalizado.
- El ranking F0 y los ciclos F5 educativos conservan su universo de muestra. Una gráfica con precios reales no convierte automáticamente la volatilidad implícita ni una cadena de opciones de muestra en datos reales.
- El servicio independiente automatiza compras de acciones en Alpaca Paper. No realiza cierres automáticos ni envía opciones multipierna en esta versión.
- La programación solo continúa mientras el servicio esté ejecutándose y tenga almacenamiento duradero, conexión y permisos. Una pestaña abierta no sustituye ese proceso.
- La conexión Webull sigue pendiente de un adaptador específico y de verificar el acceso regional; sus [requisitos oficiales](../../src/api/brokers/webull/README.md) están documentados.

## Fuentes del proveedor

- [Histórico de Alpaca y paginación](https://docs.alpaca.markets/us/reference/stockbarsingle-1).
- [Planes y cobertura de mercado](https://docs.alpaca.markets/us/v1.1/docs/about-market-data-api).
- [Entorno Alpaca Paper y diferencias de simulación](https://docs.alpaca.markets/us/docs/paper-trading).
- [Webull OpenAPI México](https://developer.webull.com.mx/apis/docs/).
