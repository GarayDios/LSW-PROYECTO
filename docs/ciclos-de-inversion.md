# Ciclos de inversión · TEPIC 1.1

Este laboratorio añade posiciones y resultados a las cuatro estrategias F5. Utiliza dinero ficticio, precios de escenario y un reloj que controla el usuario. No conecta con un bróker ni espera a que transcurra tiempo real.

## Cómo iniciar

1. Abre **Ciclos de inversión** en el menú izquierdo. También puedes usar **Simular ciclo** junto a Operar en el gráfico.
2. Elige empresa y estrategia. Para reproducir los ejercicios anteriores, selecciona NVDA.
3. Configura capital, contratos, fecha, precio inicial, strikes, primas y plazos. Los valores de NVDA vienen preparados como ejemplos numéricos.
4. Puedes añadir comisiones por contrato y por acción. Por defecto son cero para facilitar la comprobación aritmética.
5. Pulsa **Revisar ciclo** y después **Confirmar inicio del ciclo**.

La cuenta comienza con $100,000 de práctica. El capital asignado a ciclos abiertos deja de estar disponible para nuevos ciclos. Al cerrar un ciclo se libera su capital junto con su ganancia o pérdida. Las órdenes individuales de la versión anterior conservan su registro, pero no se convierten automáticamente en posiciones del laboratorio.

## Recorrido completo de Wheel

El ejemplo NVDA utiliza un capital de $20,000, una PUT vendida de strike $140 con prima $4 y una futura call cubierta de strike $145 con prima $3. Un contrato equivale a 100 acciones.

1. Al iniciar, se cobra la prima PUT de $400 y el efectivo queda en $20,400.
2. En **Fecha siguiente**, elige 11 de diciembre de 2026; en **Precio del escenario**, escribe 130 y pulsa **Avanzar paso**.
3. La PUT se asigna bajo la regla del ejercicio: recibes 100 acciones a $140. Quedan $6,400 en efectivo y una posición de 100 acciones. El historial muestra **Asignación simulada**.
4. Pulsa **Vender call cubierta**. Se cobran otros $300 y el efectivo queda en $6,700.
5. Pulsa **Usar próximo vencimiento**, escribe precio 150 y pulsa **Avanzar paso**.
6. La call se asigna: se entregan las 100 acciones a $145 y se reciben $14,500.
7. El ciclo termina sin posiciones abiertas, con efectivo final $21,200 y beneficio realizado $1,200 si no configuraste comisiones.

Si la PUT vence sin quedar dentro del dinero, se cierra una vuelta de primas sin comprar acciones. Si la call vence sin asignación, las acciones permanecen y puedes vender otra call cubierta. Si cierras las acciones por debajo de su coste, la pérdida aparece en el resultado; las primas no la ocultan.

## PMCC

El ejemplo abre simultáneamente una call larga de strike $100, prima $52 y plazo 375 días, y una call corta de strike $160, prima $4 y plazo 32 días. Se pagan $4,800 netos por contrato base, antes de comisiones.

- Si la call corta vence fuera del dinero, queda la call larga. **Renovar call corta** abre otra con vencimiento anterior al de la larga y prima recalculada con BSM.
- Si la call corta se asigna, el laboratorio entrega 100 acciones, registra una posición de −100 acciones y conserva la call larga. El estado cambia a **Asignación por resolver**.
- **Cerrar todas las posiciones ahora** compra las acciones necesarias y vende la call larga a su valor teórico, dejando el resultado realizado.
- Si se alcanza el vencimiento largo, se aplican los ejercicios correspondientes y se liquida cualquier exposición restante.

La aplicación muestra las dos piernas y las acciones por separado. Una call larga no se convierte automáticamente en 100 acciones al asignarse la corta: se conserva hasta su cierre o ejercicio.

## Call Ratio Backspread 1:2

El ejemplo vende una call de strike $140 con prima $12 y compra dos calls de strike $150 con prima $7, al mismo vencimiento. El débito inicial es $200 y la pérdida máxima al vencimiento del ejemplo es $1,200, antes de comisiones.

Al avanzar al vencimiento, se ejercen/asignan mecánicamente los contratos dentro del dinero y se liquidan las acciones resultantes para cerrar el conjunto.

| Precio de NVDA al vencimiento | Resultado sin comisiones |
|---:|---:|
| $130 | −$200 |
| $150 | −$1,200 |
| $162 | $0 |
| $170 | +$800 |

## Gamma Scalping

El ejemplo compra una call de strike $150 por prima $8.37 y abre una cobertura inicial de aproximadamente −49 acciones con el precio de muestra de NVDA a $147.22.

Cada vez que pulsas **Avanzar paso**, se recalcula la delta de la opción y se ajusta la posición en acciones enteras. El historial registra las ventas y recompras de cobertura. Al vencer o cerrar el ciclo se liquidan tanto la opción como las acciones.

Las ganancias de cobertura se suman a los cambios de valor de la opción y se restan las comisiones. El deterioro temporal puede superar esas ganancias y producir pérdidas. La cobertura solo se ajusta en los puntos que avances; no hay un proceso de negociación real funcionando en segundo plano.

## Completar un escenario con un botón

En un ciclo abierto, elige una trayectoria y pulsa **Completar escenario**:

- **Baja y recuperación:** en Wheel recorre asignación de PUT y posterior asignación de call cubierta. En Gamma usa una trayectoria oscilante.
- **Subida:** trayectoria alcista ilustrativa.
- **Caída:** trayectoria bajista, que puede cerrar con pérdidas.
- **Lateral:** precio estable mientras transcurre el plazo.

El botón aplica la trayectoria determinista y liquida todas las posiciones pendientes al final del escenario. No garantiza beneficios y no representa datos de mercado. En PMCC puede cerrar la call larga antes de su vencimiento para finalizar el ejercicio, conservando su valor temporal BSM.

Para una asignación anticipada de práctica, primero avanza a un precio donde una opción vendida esté dentro del dinero. Aparecerá **Forzar asignación de práctica**. Esta acción es una decisión educativa del usuario, no una estimación de la probabilidad de asignación.

## Cómo leer los resultados

- **Efectivo:** saldo después de primas, compras/ventas, ejercicios y comisiones.
- **Acciones:** cantidad positiva si las posees y negativa si están vendidas en corto.
- **Opciones · valor neto:** valor BSM de las opciones compradas menos las vendidas.
- **Resultado realizado:** primas ya contabilizadas al vencer/asignar/cerrar y ganancias/pérdidas de acciones cerradas, menos comisiones.
- **Resultado no realizado:** diferencia de valor de las posiciones todavía abiertas.
- **Resultado total:** patrimonio actual del ciclo menos su capital inicial. Coincide con realizado más no realizado, salvo redondeos de centavos.
- **Ciclo completado:** todas las opciones y acciones se han cerrado; el resultado final está realizado.

Las primas iniciales se pueden introducir manualmente. Si difieren del valor BSM, el resultado no realizado inicial puede ser distinto de cero. El precio manual de entrada no cambia la volatilidad para hacer coincidir el modelo.

El historial guarda cada movimiento con fecha del escenario, precio, efectivo, acciones y resultado acumulado. La flecha de descarga exporta ese historial a CSV. Las listas, órdenes y ciclos se guardan en este navegador; no existe sincronización entre dispositivos. **Portafolio** resume todos los ciclos.

## Supuestos y límites

La valoración de opciones abiertas usa BSM europeo con dividendos continuos. El módulo de ciclos añade por separado una convención de ejercicio físico al vencimiento cuando el valor intrínseco llega a $0.01. Esa regla no reproduce todas las decisiones de tenedores ni los procesos reales de OCC o un bróker. La asignación anticipada solo se modela cuando la fuerza el usuario.

Si avanzas saltando varios vencimientos, los precios en esas fechas intermedias se interpolan linealmente entre el precio anterior y el nuevo precio que introdujiste. El historial lo indica. Para controlar el precio exacto de cada vencimiento, avanza de uno en uno.

No se modelan calendario bursátil, festivos, dividendos en efectivo, intereses de cuenta, préstamo de acciones, deslizamiento, horquillas ni garantías reales de bróker. El requisito de capital de Gamma es una reserva propia del ejercicio, no una cotización de margen. Un escenario extremo puede provocar pérdidas y el laboratorio cierra posiciones si se agota el patrimonio.

Referencias de estructura: [Wheel, OIC](https://www.optionseducation.org/videolibrary/what-is-the-wheel-strategy), [diagonal con calls, Fidelity](https://www.fidelity.com/learning-center/investment-products/options/options-strategy-guide/long-diagonal-spread-calls), [Backspread, OIC](https://prd-web.optionseducation.org/strategies/all-strategies/long-ratio-call-spread) y [Gamma Scalping, Alpaca](https://alpaca.markets/learn/gamma-scalping). Los parámetros numéricos y trayectorias de esta aplicación son ejercicios propios de muestra.
