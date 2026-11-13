# Ampliación · noviembre 2026

## Funcionalidades

- Histórico con fechas inclusivas, incluido un solo día. Velas 5m, 15m, 1h y 1d que agregan la misma serie base; la última vela horaria dura 30 minutos. Sesiones lunes–viernes de Nueva York con ajuste de verano. Los fines de semana sin sesiones muestran un estado vacío. No se simulan festivos ni medias sesiones.
- Exportación de todas las velas originales a CSV con fecha UTC y OHLCV. Se agrupan los rangos grandes para mostrar hasta 180 velas sin perder extremos ni volumen; los indicadores de medias se calculan sobre las velas visibles agrupadas.
- Siete cores independientes, activados inicialmente, con botones para activar todos o limpiar. Al cambiar la selección se actualizan los indicadores, sus etiquetas y los resultados de compatibilidad.
- Comparador de las cuatro estrategias con su primera empresa y puntuación; top tres de la estrategia elegida, motivos y acceso a la gráfica. No hace falta crear listas para ver la comparación.
- Las listas generadas conservan sus resultados originales. Al recuperarlas también se restaura su tasa, además de los filtros existentes.
- Contraste y tamaños de controles mejorados; fechas, número de cores y estado de simulación visibles.

## Los siete cores

La petición menciona siete cores sin nombrarlos. Se conservan los tres existentes y se proponen cuatro adicionales. Estos nombres son una decisión de implementación, no una especificación académica confirmada.

| Core | Visualización | Criterio de clasificación |
|---|---|---|
| BSM | Strike ATM, prima teórica call | Ajuste de prima, IV y plazo |
| Griegas | Línea rosa de delta en escala 0–1; valores delta/gamma | Ajuste de sensibilidad, liquidez y plazo |
| Equilibrio/probabilidad | Nivel de equilibrio y probabilidad de call comprada | Probabilidad neutral al riesgo de la pierna proxy |
| Volatilidad | Niveles de cierre ± IV × raíz(plazo/365) | Proximidad de IV al objetivo de cada estrategia |
| Tendencia | Media 9 naranja y media 21 azul | Cambio diario de muestra como proxy; no usa la serie histórica |
| Liquidez/volumen | Barras de volumen sintético | Liquidez y volumen de muestra |
| Riesgo | Escenario de caída de 2σ | Exposición relativa por volatilidad y plazo, con liquidez |

Los niveles del gráfico se calculan al último cierre sintético, no al precio fijo del encabezado. La tira inferior de griegas conserva la referencia al precio actual de muestra y se etiqueta como tal. Los niveles BSM son de una call ATM comprada, no el payoff completo de la estrategia elegida. Ninguno es una señal histórica, margen, VaR, recomendación ni pérdida máxima.

## Verificación

```sh
npm test
npm run typecheck
npm run build
npm run test:browser
npm run test:browser -- features
npm run test:browser -- cycles
```

La aplicación debe estar levantada en `http://127.0.0.1:5173` para las pruebas de navegador, que utilizan Chrome instalado en Windows. `QA_URL` permite indicar otra URL.

Se conservan los ciclos, órdenes y listas previos. Esta ampliación no conecta un bróker ni incorpora datos reales, autenticación o backtesting. El alcance de datos de muestra del README sigue vigente.
