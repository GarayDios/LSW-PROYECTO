# F5 con contratos de Alpaca Paper

F5 consulta contratos existentes y envía órdenes a la cuenta **Alpaca Paper** del propietario autenticado. El saldo sigue siendo virtual. Las posiciones, precios medios ejecutados, rechazos, cancelaciones y actividades proceden del bróker. La revisión de una orden no abre una posición: hay que confirmar el envío y luego comprobar la ejecución.

## Configuración

1. Usa claves **Paper** en `ALPACA_API_KEY` y `ALPACA_SECRET_KEY`, con `BROKER_OWNER_USER_ID` correspondiente a tu identidad del terminal. No publiques los archivos `.env.local` y `.env.trading.local`.
2. Configura `TRADING_RUNNER_URL` y `TRADING_RUNNER_TOKEN` en el terminal. El token debe coincidir con el del servicio Node, tener al menos 32 caracteres y permanecer en servidor. El servicio requiere HTTPS fuera de localhost.
3. En el terminal y el servicio, configura `ALPACA_F5_ENABLED=true` para habilitar el envío manual de órdenes de opciones. Este ajuste es independiente de `ALPACA_AUTOMATION_ENABLED`, utilizado por los planes de acciones.
4. Elige `ALPACA_OPTIONS_FEED=indicative` o `opra` en el servicio. OPRA requiere permisos de datos; indicative usa cotizaciones modificadas y se identifica como estimación. No hay cambio silencioso de feed.
5. Ejecuta `npm run trading:serve` y `npm run dev`. El servicio conserva el registro F5 en SQLite en `TRADING_RUNNER_DB`, junto a tablas separadas de los planes de acciones. El archivo y su volumen deben sobrevivir reinicios.

La cuenta necesita permisos de opciones: nivel 1 para Wheel, nivel 3 para las combinaciones multipierna. El servidor comprueba los permisos efectivos, los bloqueos, el mercado, los contratos, las cotizaciones y el capital al revisar y antes del envío. La aprobación final corresponde a Alpaca.

## Estrategias

| Estrategia | Orden de apertura | Seguimiento |
| --- | --- | --- |
| Wheel | Una put vendida con efectivo reservado, o una call vendida cubierta por 100 acciones disponibles por contrato. | Las acciones y asignaciones se leen de posiciones y actividades del bróker. La siguiente etapa requiere nueva revisión y confirmación. |
| PMCC | Una call comprada de vencimiento posterior y strike menor o igual, junto con una call vendida de menor plazo. | Una orden multipierna de débito; cierre completo inverso. Se exige una reserva conservadora para la exposición de asignación. |
| Backspread | Una call vendida de strike inferior y dos calls compradas de strike superior, al mismo vencimiento. | Ratios 1:2 en una sola orden; el servidor calcula una reserva conservadora de capital. El bróker puede rechazar la combinación. |
| Gamma | Straddle largo: una call y una put del mismo strike y vencimiento. | Las coberturas se revisan como órdenes separadas de acciones completas. No se implementa rebalanceo autónomo ni venta corta de acciones. |

Solo se admiten contratos estándar americanos, negociables, de 100 acciones y del subyacente seleccionado. PMCC y Backspread se envían juntos como `mleg`; un rechazo nunca dispara órdenes sueltas. Las órdenes son límite y de duración diaria. El límite multipierna es positivo para débito y negativo para crédito, por acción y por unidad de estrategia; el importe de opciones usa multiplicador 100. Una orden single-leg usa un precio positivo y su lado compra/venta determina el flujo de efectivo.

## Flujo y recuperación

1. Selecciona empresa, estrategia y contratos recibidos de Alpaca; revisa vencimientos, strikes, bid/ask, fecha de cotización y feed.
2. Define unidades completas, precio límite y capital máximo. En la revisión aparecen las piernas y la reserva calculada por el servidor.
3. Confirma el envío a Paper antes de que venza la revisión. El servidor vuelve a validar el estado de la cuenta.
4. Actualiza el estado para consultar órdenes, cantidades ejecutadas, posiciones y actividades. Una aceptación no se presenta como ejecución.
5. Para cerrar una apertura ejecutada, prepara su orden inversa completa y confírmala. Una posición parcialmente ejecutada o incierta requiere conciliación; no se adivinan cantidades. Las coberturas atribuidas a Gamma deben quedar resueltas antes del cierre de opciones.

Cada revisión tiene propietario, vencimiento e identificador estable. SQLite registra la reserva antes del POST. Una respuesta incierta se recupera consultando ese identificador; el servicio no repite a ciegas el envío, tampoco después de reiniciar. La cancelación se solicita a Alpaca y conserva su estado pendiente hasta que el bróker la confirma.

La vista de posiciones corresponde a la cuenta, y puede incluir posiciones creadas fuera de F5. Los cierres y coberturas de F5 se validan contra sus operaciones registradas. Las órdenes pendientes que afectan las mismas posiciones impiden preparar una operación incompatible. La revisión del estado no inventa asignaciones, no adelanta el reloj y no convierte los antiguos ciclos locales en contratos del bróker.

En Paper, las actividades de ejercicio, asignación y vencimiento pueden aparecer al siguiente día aunque el saldo y las posiciones ya hayan cambiado. No hay una transición automática de Wheel basada en que el precio local atraviese un strike.

## Alcance

El módulo es una ejecución **manual revisada** de opciones en Paper. No opera con dinero real, no automatiza los ciclos completos, no ofrece rolls individuales de PMCC ni simula protección bracket para opciones. Gamma puede necesitar una cobertura corta que esta versión no envía; en ese caso no se promete neutralidad delta. El histórico de acciones y el backtest SMA/RSI siguen siendo análisis distintos de la ejecución F5.

Las pruebas usan respuestas controladas para verificar permisos, contratos, capital, órdenes, conciliación y persistencia sin operar una cuenta externa. Una conexión real de lectura se indica por separado en el registro de verificación.

`npm run f5:check` comprueba cuenta, permisos, contratos y una consulta individual usando las claves del servidor, sin enviar órdenes. `npm run test:browser` prueba por defecto el flujo F5 con una API controlada; requiere el servidor de desarrollo y Chrome. Los resultados y límites están en [la verificación de F5](../verificacion/f5-alpaca-paper.md).

## Referencias oficiales

- [Opciones: permisos, contratos, posiciones y actividades](https://docs.alpaca.markets/us/docs/options-trading).
- [Órdenes: ratios, intenciones y signo del precio neto](https://docs.alpaca.markets/us/reference/postorder).
- [Combinaciones multipierna y restricciones](https://docs.alpaca.markets/us/docs/options-level-3-trading).
- [Ejemplo oficial de calendar con vencimientos diferentes](https://alpaca.markets/learn/calendar-spread).
- [Cierre de calendar y diagonal](https://alpaca.markets/support/i-have-a-calendar-or-diagonal-spread-and-i-cant-buy-to-close-the-short-term-leg-what-are-my-options).
