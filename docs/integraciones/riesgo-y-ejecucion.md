# Ciclo de operación y controles de riesgo

El servicio de `services/trading-runner/` opera acciones completas exclusivamente en Alpaca Paper. Las simulaciones F5, sus posiciones y su efectivo son independientes de la cuenta del bróker. Los planes nacen desactivados y los planes existentes conservan sus políticas.

## Conciliación

Antes de evaluar señales se consultan las órdenes no terminales por su ID de Alpaca o por su `client_order_id` persistido. La interfaz distingue reserva, envío, ejecución parcial, ejecución completa, cancelación, rechazo, vencimiento y confirmación incierta. Muestra cantidad, precio límite, precio de activación del stop y precio medio ejecutado cuando corresponde.

La propiedad de acciones procede de ejecuciones confirmadas, nunca de aceptar una orden. El ledger aplica solo el incremento de la cantidad y del importe acumulados; volver a consultar una ejecución no duplica acciones ni ganancias. Una venta solo reduce las acciones atribuidas al plan. Una discrepancia con el bróker bloquea nuevas órdenes para revisión. No se vende automáticamente una posición manual para corregirla.

Una reserva se escribe antes del envío. Un timeout mantiene la reserva y provoca conciliación, sin repetir a ciegas el POST. SQLite conserva planes, ejecuciones, posiciones, pausa y alertas; el volumen persistente debe sobrevivir reinicios. Las correcciones retroactivas del bróker y las sustituciones de órdenes no verificadas se consideran inciertas; no se reinterpretan silenciosamente.

## Dos modalidades de salida

| Modalidad | Entrada y salidas | Referencia de porcentajes | Requiere servicio activo |
|---|---|---|---|
| Por reglas | Entrada límite diaria; venta límite al detectar stop, take profit, señal diaria o fin de ventana habilitados | Precio medio de entrada confirmado | Sí; evaluación cada 60 segundos |
| Bracket | Entrada límite GTC con take profit límite y stop a mercado GTC en Alpaca | Límite de entrada, fijado antes del envío | El bróker conserva las órdenes; el servicio sigue siendo necesario para seguimiento y alertas |

En bracket se registran las dos órdenes hijas con su identidad de bróker y se aplican sus ejecuciones después de la entrada. Se admite la reducción de cantidad del stop tras una ejecución parcial de take profit. El runner no envía ventas por reglas que compitan con estas salidas. No se combina bracket con cierre por señal o fecha en un mismo plan. Los nuevos planes permiten elegir la modalidad en la interfaz.

Las salidas bracket se activan cuando se completa la entrada. Una entrada parcial puede estar todavía sin protección activa; la interfaz registra el bloqueo si no confirma un stop activo. Una entrada GTC pendiente fuera de la ventana solicita su cancelación por ID propio; una cancelación no equivale a confirmación inmediata y podría coincidir con un fill. Una entrada parcial cancelada o una salida cancelada requiere revisar la protección restante. No se inventa una ejecución ni se envía una venta adicional para resolver un estado ambiguo.

Pausar detiene **nuevas entradas**; mantiene las salidas configuradas de planes habilitados y la conciliación. Las compras previamente enviadas siguen vigentes. Desactivar un plan detiene sus nuevas órdenes del servicio, pero no cancela órdenes ya aceptadas, incluidas las bracket. Detener el servicio tampoco cancela las órdenes del bróker. Las salidas GTC pueden continuar después de la fecha final del plan.

Los umbrales por reglas pueden cruzarse entre consultas y sus ventas límite pueden quedar pendientes. Un stop bracket a mercado no garantiza precio; una salida take profit límite no garantiza ejecución. No se habilitan extended hours. Alpaca puede cancelar o rechazar órdenes; ningún modo garantiza evitar pérdidas.

## Riesgo de cuenta

La exposición agrega el valor absoluto de todas las posiciones de la cuenta, incluidas las manuales, y el importe pendiente de compras límite. Las reservas locales aún no visibles en Alpaca también cuentan. No se crean entradas si hay órdenes, datos de exposición o identidades inciertas. El presupuesto se acota por orden, posición, servicio, efectivo/poder de compra y exposición disponible.

`TRADING_MAX_TOTAL_EXPOSURE_USD` y `TRADING_MAX_DAILY_LOSS_USD` permiten límites generales. Se usa el menor límite configurado entre el servicio y los planes habilitados. Alcanzarlos bloquea entradas y mantiene las salidas habilitadas. No constituye una liquidación forzosa.

La pérdida diaria compara equity con la primera lectura persistida del día de Nueva York. Incluye toda la cuenta y movimientos de efectivo; no reconstruye pérdidas anteriores a esa lectura. Una vez alcanzado el límite, las entradas quedan bloqueadas hasta la siguiente fecha de Nueva York.

## Referencias

[Órdenes y bracket en Alpaca](https://docs.alpaca.markets/us/docs/orders-at-alpaca), [creación de órdenes](https://docs.alpaca.markets/us/reference/postorder), [servicio permanente y alertas](servicio-continuo.md).
