# Datos automáticos y pantalla simplificada

Revisión local del 18 de noviembre de 2026.

El flujo principal consulta mercado, contratos, dividendos y tasa sin pedir que
el usuario escriba un dividendo para desbloquear el ranking. El capital disponible
y el dividendo aplicado se muestran junto a la comparación de estrategias.
Los ajustes, fuentes, sensibilidades y herramientas técnicas quedan plegados.

El dividendo anual se estima con los pagos ordinarios recibidos de los últimos
365 días, divididos por el precio disponible de la acción. No garantiza pagos
futuros. Un historial recibido vacío permite una estimación identificada de cero;
los errores, páginas incompletas, fechas inválidas y pagos contradictorios
conservan el dato como no disponible. Un split requiere revisar los pagos previos;
si no hay pagos históricos, no altera la suma de cero.

Cuando falta IV publicada, se intenta calcularla a partir de una cotización
recibida válida, la tasa y el dividendo del modelo. No usa HV ni genera bid/ask
para completar ese cálculo. Una cotización con bid igual a ask también puede
utilizarse. La IV calculada conserva su procedencia estimada y no constituye
evidencia independiente de infravaloración.

Los errores de consulta aparecen en la comparación con un botón para reintentar,
sin abrir herramientas avanzadas. Después de generar, el resumen muestra cuántas
empresas pudieron evaluarse. «Ver empresas pendientes» permite consultar las
causas restantes en un detalle plegado. Un resultado sin puntuaciones conserva
los motivos y no crea una lista vacía.

## Comprobaciones

- `npm test`: 275 pruebas aprobadas, una integración MongoDB omitida, cero fallos.
- `npm run typecheck` y `npm run build`: completados correctamente.
- `npm run test:browser -- delivery`: datos automáticos identificados, error
  visible y reintento, pendientes plegados, ranking sin dividendo manual,
  simulación y recuperación de órdenes, herramientas avanzadas, escritorio y
  móvil; cero errores JavaScript. Las fuentes y el bróker de este recorrido son fixtures.
- `npm run research:check`: AAPL con consultas reales de solo lectura.
- Comprobación de las 14 empresas mediante el mismo handler de ranking: dividendos
  estimados e IV calculadas disponibles en las 14, cero consultas fallidas en la
  comprobación final. Algunas estructuras siguen excluidas por capital, spread o
  compatibilidad de las piernas. Los resultados varían entre consultas; el feed
  utilizado fue indicative, identificado como estimación.

La [documentación de corporate actions de Alpaca](https://docs.alpaca.markets/us/reference/corporateactions-1)
describe paginación, calidad y posibles retrasos del proveedor. Las consultas
actuales no reconstruyen dividendos ni cadenas conocidos en fechas históricas.
No se enviaron órdenes a Alpaca ni se publicó un sitio remoto.
