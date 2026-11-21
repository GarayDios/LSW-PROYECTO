# Monte Carlo en el núcleo cuantitativo

El panel «Núcleo cuantitativo · Monte Carlo» aparece debajo de la gráfica. Puede
simular una opción individual del modelo o las piernas seleccionadas por el
analizador de estrategias con datos de Alpaca. Es un análisis independiente del
ranking, las órdenes y los ciclos guardados.

## Modelo

Se utiliza movimiento browniano geométrico bajo la medida neutral al riesgo Q:

`S(t+dt) = S(t) × exp((r − q − σ²/2)dt + σ√dt Z)`, con `Z ~ N(0,1)`.

Los pasos son fracciones iguales de días naturales, no un calendario bursátil.
Todas las piernas comparten subyacente, vencimiento y una volatilidad constante.
El adaptador toma la IV de la primera pierna y declara ese supuesto: no reproduce
una superficie de IV. Las primas de entrada mantienen ask para compras, bid para
ventas, cantidades firmadas, multiplicadores y acciones entregables verificados.
El débito incluye la comisión de entrada por contrato. El ejercicio individual
usa una acción entregable y cero comisiones de opciones; si falta una prima se
identifica explícitamente la prima teórica BSM como supuesto educativo.

La valoración es el promedio del payoff europeo descontado a `r`. Se compara
con BSM usando exactamente la misma volatilidad común. El resultado sin cobertura
es `payoff − débitoInicial × exp(rT)`, con financiación/remuneración de la prima
y las comisiones. Por ello puede diferir de probabilidades que excluyen financiación.

La cobertura opcional toma `round(−delta de las opciones)` acciones en cada paso,
incluidos apertura y cierre. La caja firmada paga o recibe `r`; las acciones
reciben o pagan dividendos continuos `q`. El spread completo se divide entre dos
para operar contra bid/ask, y se cobran comisiones por acción y préstamo anual de
acciones cortas. Dividendos y préstamo se integran con el precio al inicio del
paso. No se imponen restricciones de margen ni límites de financiación o posiciones
cortas. La caída máxima se mide en USD entre máximos y mínimos de la posición
valorada con BSM en los pasos de cobertura; no es una caída porcentual del capital.

## Resultados y alcance

- Media, mediana, percentiles 5/95 y frecuencia de ganancias y pérdidas.
- VaR de pérdida al 95%: `max(0, −percentil5(PnL))`.
- Expected Shortfall: pérdida media de las peores `ceil(0.05 × N)` trayectorias,
  limitada por debajo a cero. Estas métricas no son pérdidas máximas.
- Error estándar e intervalo normal aproximado al 95% de la valoración y la media.
  Intervalo Wilson de la frecuencia de beneficio. Ambos reflejan muestreo dentro
  del modelo, no incertidumbre sobre los supuestos ni probabilidad real calibrada.
- Banda P5–P95 del subyacente en cada fecha, doce trayectorias e histograma.

Wheel representa solo la put inicial. Backspread conserva la proporción −1/+2.
Gamma representa el straddle con o sin cobertura. PMCC se rechaza explícitamente
por sus vencimientos distintos; también se rechazan dividendos discretos. El
modelo liquida en efectivo y no simula ejercicio anticipado, asignación, cambios
de IV, saltos, margen ni fills reales. Para contratos americanos es un escenario
europeo, no una valoración de su ejercicio anticipado.

## Ejecución y reproducibilidad

El generador local Mulberry32 y la transformación Box–Muller permiten repetir una
ejecución con la misma semilla y entradas sin modificar el azar global. Un Web
Worker evita bloquear los controles; cancelar termina ese worker. El motor limita
trayectorias a 100–50000, pasos a 1–128 y el producto trayectorias × pasos × piernas
a dos millones. Admite vencimiento inmediato y volatilidad cero. Rechaza valores
no finitos y resultados fuera del rango numérico.

La exportación JSON conserva las entradas, semilla, procedencia, advertencias y
resultados de la ejecución. Cambiar controles o datos identifica el resultado
anterior; exportarlo conserva sus entradas originales.

Referencia matemática: [Monte Carlo methods, Mike Giles, Oxford](https://people.maths.ox.ac.uk/gilesm/mc/nanjing/giles_lecs-2x2.pdf).

Validación: pruebas de convergencia frente a BSM y probabilidad analítica, signos,
ratios, entregables ajustados, costes de cobertura, casos límite y límites de
trabajo. `node scripts/verify-browser.mjs monte-carlo` comprueba el worker real,
exportación, cancelación, resultados anteriores y presentación móvil con datos QA.
