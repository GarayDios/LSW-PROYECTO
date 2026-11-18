# Comparación de estrategias con contratos observados

El panel «Compara estrategias» del explorador evalúa las cuatro estructuras para la
empresa consultada. Los controles de capital, comisión, spread y plazo largo se
aplican también al generar oportunidades. La lista guarda esta política y un resumen
de los contratos y costes para conservar la trazabilidad al volver a abrirla.

## Entradas y selección

- Los contratos, bid, ask e IV proceden de la instantánea Alpaca. Se comprueba el
  subyacente, vencimiento, disponibilidad al corte, spread no cruzado y vigencia de
  la cotización. Las piernas deben tener cotizaciones separadas por hasta 15 minutos.
- Las compras se estiman al ask y las ventas al bid, con comisión por contrato.
  Esto es una estimación conservadora de entrada, no una promesa de ejecución.
- Wheel selecciona una put fuera o en el dinero respecto al cierre y reserva su
  nominal completo. La call posterior aún no existe como operación observada.
- PMCC selecciona una call larga dentro del dinero y otra de strike superior y
  vencimiento anterior. El plazo largo se configura; el valor residual al vencimiento
  corto usa BSM o CRR según estilo; además se muestran shocks configurables de IV.
- Backspread combina una call vendida y dos compradas a un strike superior, con
  vencimiento común. El cálculo incluye el valle de pérdida entre strikes.
- Gamma selecciona un straddle de call y put con el mismo strike y vencimiento.
  Sus escenarios son del straddle sin coberturas futuras.
- Se ordena por cercanía al plazo solicitado y spread relativo. No hay objetivos
  fijos de delta, IV o porcentaje del strike en el ranking observado. Esta selección
  estructural no busca exhaustivamente el óptimo económico de toda la cadena.

## Dividendos y datos ausentes

SEC no proporciona un dividendo continuo prospectivo. El usuario puede activar un
supuesto para cada símbolo; 0% requiere esa acción explícita. El supuesto se marca
como `assumed`, no sustituye el dato del proveedor y conserva su carácter de
escenario al aplicarse a una fecha histórica. No acredita información que hubiera
estado disponible entonces. Sin fuente o supuesto, los modelos dependientes de q
permanecen incompletos.

## Resultados

Se calculan cashflows firmados con el multiplicador de prima/ejercicio del proveedor,
las acciones entregables verificadas, débito/crédito neto,
coste respecto al midpoint, sensibilidades conjuntas, capital inicial, escenarios
de -30%, -15%, 0%, +15% y +30%, y extremos y equilibrios cuando todas las piernas
comparten vencimiento. Los extremos se obtienen de los strikes y pendientes del
payoff por tramos; no se deducen de una cuadrícula limitada de escenarios.

La prima teórica inicial usa CRR con pasos configurables para contratos americanos verificados
y BSM para los demás. Las griegas siguen siendo aproximaciones BSM europeas.
La probabilidad terminal para Wheel y Backspread integra las regiones de beneficio
del payoff conjunto bajo una distribución lognormal neutral al riesgo, con IV de
la primera pierna constante. Incluye comisiones de entrada; excluye financiación,
comisiones de salida y asignación anticipada. No es una frecuencia histórica.

PMCC no publica probabilidad conjunta ni máximos de pérdida/ganancia: el resultado
depende de IV futura, ejercicio, financiación y gestión de sus distintos vencimientos.
Su capital predeterminado incluye débito, nominal de la call corta y financiación
simple como reserva conservadora ante asignación. El usuario puede elegir solo
débito, con advertencia explícita; ninguna alternativa acredita margen oficial.
Gamma no publica probabilidad de scalping a partir del straddle estático. El panel
de trayectoria permite importar puntos para simular ajustes de delta con frecuencia,
bid/ask, comisiones, préstamo y límites de acciones/capital, sin enviar órdenes.

Los cores usan los pesos positivos configurados, normalizados por su suma. Por
defecto todos pesan uno. Se muestra la falta de un core con peso positivo en lugar
de eliminarlo del denominador. Peso cero lo excluye explícitamente. El usuario puede desactivar
explícitamente probabilidad para comparar con los otros seis cores. La puntuación
de liquidez usa el peor spread de las piernas; OI se muestra como evidencia. El
riesgo incorpora la pérdida máxima respecto al capital cuando puede determinarse.
La comparación no recomienda Gamma como si fuera equivalente a mantener opciones
sin cobertura. La demo conserva su ranking ilustrativo y no valida el observado.

## Límites pendientes que requieren datos o trabajo adicional

Los criterios siguen siendo heurísticos y no están calibrados para predecir
rentabilidad. Validarlos exige cadenas históricas de opciones con sus marcas de
tiempo, selección de parámetros fuera de muestra y costes realistas. Las cadenas
actuales no reconstruyen cortes históricos. No se rellenan esos huecos con precios
de demostración. Tampoco se aprende de noticias ni se convierte automáticamente
la contabilidad SEC en una señal de compra.

Se consulta además el punto medio de la cotización actual de la acción. Cuando
existe, se limita su desfase respecto a las opciones en minutos. Si solo hay cierre
diario se identifica y se aplica la tolerancia de sesiones elegida. El horizonte se
estima con calendario de sesiones y atributo `options_late_close` del subyacente,
incluyendo cierres anticipados, vencimientos en días sin sesión y conversión ET/UTC
con horario de verano. Es una inferencia para valorar, no el plazo legal de ejercicio
ni el límite de recepción de órdenes del bróker. Si falta el calendario o atributo,
se identifica el supuesto de 16:00 ET; ya no se utiliza 21:00 UTC todo el año.
Se puede elegir dividendo continuo o el ajuste aproximado de spot por valor presente
de dividendos discretos recibidos. La cobertura del calendario no se considera
completa y no se anualizan pagos pasados como si fueran anuncios futuros. El modo
discreto no publica probabilidad lognormal ni se combina con un segundo q continuo.
Permanece pendiente una valoración americana exacta con dividendos discretos y
condiciones de liquidación/ejercicio por contrato.
El universo de la interfaz sigue siendo el catálogo de 14 empresas.

## Parámetros y características del contrato

«Parámetros y pesos del análisis» permite cambiar coeficientes de tendencia,
reparto drawdown/volatilidad bajista, pesos de los siete cores, importancia de
plazo/spread al elegir contratos, pasos CRR y escenarios de precio. También puede
restringirse la antigüedad de cotizaciones y la distancia temporal entre piernas
y subyacente. Los límites de validación acotan el coste numérico y la disponibilidad
del proveedor; no son parámetros de inversión óptimos. La política completa se
guarda con la lista y se restaura al seleccionarla. Las listas anteriores, sin estos
ajustes, siguen siendo válidas y usan los valores predeterminados documentados.

El proveedor solicita `show_deliverables=true`. `multiplier` convierte prima y
strike a importes monetarios; `size` y el único entregable de tipo equity indican
las acciones. No se sustituye un multiplicador ausente por 100. El análisis admite
una entrega única verificada del mismo subyacente: su strike efectivo es
`strike × multiplier / acciones`, y las sensibilidades se escalan por acciones.
No combina piernas de distintos multiplicadores/entregables como si fueran la
misma unidad. Cestas, efectivo y liquidaciones diferidas permanecen sin calcular.

Los 365 días para tiempo BSM y las 252 sesiones de anualización histórica son
convenciones consistentes del modelo; no se ofrecen como parámetros para mejorar
un ranking. Los escenarios no modifican los máximos de pérdida/ganancia calculados
analíticamente a partir de los puntos de quiebre del payoff.

Referencias de integración: [contratos y entregables de Alpaca](https://docs.alpaca.markets/us/v1.1/reference/get-options-contracts),
[calendario de mercado](https://docs.alpaca.markets/us/v1.1/reference/getcalendar-1),
[atributo de cierre tardío](https://docs.alpaca.markets/us/reference/getassets).

## Integración Paper

El runner conecta las rutas `/f5/*` al servicio de opciones con token privado,
validación del propietario y exclusión mutua mediante la misma reserva de cuenta
que el runner de acciones. La ejecución sigue requiriendo `ALPACA_F5_ENABLED=true`;
esta mejora no activa órdenes. Las reservas F5 se guardan por defecto en
`.sites-runtime/trading-f5.sqlite` (`TRADING_F5_DB` permite cambiarla). Las pruebas
de cuenta usan posiciones valoradas y conservan un caso explícito que verifica
el bloqueo cuando falta el valor de mercado.
La ejecución Paper sigue soportando solo contratos estándar: comprueba multiplicador
100 y entrega única de 100 acciones en los metadatos del bróker. No hereda la
capacidad de analizar entregas ajustadas como permiso para operarlas.

## Verificación

- `npm test`: cálculos de payoff, estructura, costes, capital, datos ausentes,
  procedencia de supuestos, API y controles Paper.
- `npm run typecheck` y `npm run build`.
- Con la app en el puerto 5173: `node scripts/verify-browser.mjs strategies`.
  Este modo intercepta proveedores con fixtures etiquetadas; verifica comparación,
  consentimiento de dividendos, selección de estrategia, probabilidad incompleta y
  vista móvil. No demuestra conexión a Alpaca ni rendimiento real de inversión.
