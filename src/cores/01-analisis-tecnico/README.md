# 1. Core de Análisis Técnico

**Para explicarlo:** «Este core calcula indicadores que describen precio,
tendencia, volumen y volatilidad. Todavía no decide una compra o venta».

Recibe velas OHLCV válidas y ordenadas. `indicators.ts` calcula SMA20, SMA50,
RSI14, MACD12/26/9, ATR14 y volumen relativo contra las 20 velas anteriores.
`support-resistance.ts` confirma niveles con dos pivotes y los dibuja desde la
fecha en que pudieron conocerse. `market-analysis.ts` obtiene retornos, volatilidad histórica, volumen medio
y drawdown usando cierres diarios completos conocidos en el corte.

El core 5 consume los indicadores para producir señales; los módulos de inteligencia
artificial consumen los datos históricos para su pronóstico. `trend.ts`, `volatility.ts` y `liquidity.ts`
conservan criterios del ranking de demostración, identificados como heurísticos.
Las velas se consultan en `src/api/market/`; la gráfica vive en
`src/features/market/`.

La [matriz de revisión](../../../docs/verificacion/estado-de-los-siete-cores.md)
explica el algoritmo de soportes y lo que sigue pendiente en los demás cores.

## Cómo leer el código documentado

Cada línea de código de los siete archivos TypeScript tiene una explicación en
español inmediatamente antes. Los comentarios de continuidad explican también
las condiciones que ocupan varias líneas. Los comentarios de cierre señalan
dónde termina un bloque. El código conserva sus cálculos y tipos originales.

| Archivo | Entrada y responsabilidad | Salida |
| --- | --- | --- |
| `index.ts` | Expone la entrada pública del core. | Funciones y tipos reexportados. |
| `indicators.ts` | Valida velas y recorre sus cierres, rangos y volúmenes. | Un `TechnicalIndicator` por vela. |
| `market-analysis.ts` | Selecciona velas diarias disponibles en `asOf`. | Un `ObservedMarket` con métricas, fechas y faltantes. |
| `support-resistance.ts` | Confirma pivotes y agrupa contactos cercanos. | Niveles finales e historia de lo conocido en cada vela. |
| `liquidity.ts` | Puntúa liquidez, volumen y plazo del contexto de demostración. | Puntuación y motivo legible. |
| `trend.ts` | Compara el cambio ilustrativo con objetivos por estrategia. | Heurística de tendencia de demostración. |
| `volatility.ts` | Combina cercanía a IV objetivo y ajuste de plazo. | Heurística de volatilidad de demostración. |

## `indicators.ts`, en orden de ejecución

1. Importa el tipo `Candle`. Sus campos OHLCV son apertura, máximo, mínimo,
   cierre y volumen; `time` representa el instante en milisegundos.
2. Declara `TechnicalIndicator`. Los tipos `number | null` distinguen un indicador
   calculado de otro al que todavía le faltan observaciones.
3. Fija ventanas SMA20, SMA50 y RSI14. Son decisiones de configuración del código,
   no parámetros que se hayan optimizado automáticamente.
4. Inicializa acumuladores. Mantener sumas móviles evita recorrer de nuevo las
   últimas 20 o 50 velas en cada iteración.
5. Valida números finitos, precios positivos, coherencia del rango y orden
   temporal. Una entrada inválida detiene el cálculo con `RangeError`.
6. Prepara EMA12 y EMA26 con medias simples iniciales; después aplica
   `EMA = cierre × alfa + EMA anterior × (1 − alfa)` y `alfa = 2/(períodos+1)`.
7. Calcula `MACD = EMA12 − EMA26`. Su señal es EMA9 del MACD y el histograma
   es `MACD − señal`; ambos se conservan sin dato hasta completar su preparación.
8. Calcula el rango verdadero como el máximo entre `máximo − mínimo`,
   `abs(máximo − cierre anterior)` y `abs(mínimo − cierre anterior)`.
   ATR14 comienza como promedio y continúa con suavizado de Wilder.
9. Compara el volumen actual con el promedio de las 20 velas **anteriores**.
   Primero calcula la referencia y después agrega el volumen actual.
10. Actualiza las sumas móviles para obtener SMA20 y SMA50.
11. Separa subidas y magnitudes de bajadas. Tras 14 variaciones iniciales,
    actualiza sus promedios con Wilder: `(13 × promedio anterior + valor) / 14`.
12. Obtiene `RSI = 100 − 100/(1 + ganancia media/pérdida media)`.
    Sin variaciones usa 50; con ganancia y ninguna pérdida usa 100.
13. Agrega el resultado de la vela a `indicators` y devuelve la serie completa.

| Medición | Primera salida calculable |
| --- | --- |
| EMA12 / EMA26 | 12 / 26 cierres. |
| MACD | 26 cierres. |
| Señal e histograma MACD | 9 valores MACD, es decir, 34 cierres. |
| ATR14 | 14 velas. |
| RSI14 | 14 variaciones, es decir, 15 cierres. |
| SMA20 / SMA50 | 20 / 50 cierres. |
| Volumen relativo | Vela 21, comparada con las 20 anteriores. |

Ejemplo: si las 20 velas anteriores negociaron en promedio 1000 acciones y la
actual negocia 2000, su volumen relativo es `2000 / 1000 = 2`. El pico actual
no se incluye en el denominador que sirve para evaluarlo.

## `market-analysis.ts`: fechas, HV y riesgo histórico

`deriveObservedMarket()` comienza convirtiendo `asOf` al instante de decisión.
Rechaza una fecha inválida, descarta velas incoherentes y exige una vela por
fecha UTC. Para cada vela supone disponibilidad a las 06:00 UTC del día
siguiente; solo admite la que ya podía conocerse en el corte.

Después ordena las velas y construye variables con `value`, `source`,
`observedAt`, `availableAt` y `kind`. `observedAt` describe la observación;
`availableAt` describe cuándo podía utilizarse. Un resultado sin suficiente
historia se publica como `missing`, con `value: null` y una explicación.

Las fórmulas se leen así:

```text
Rendimiento logarítmico diario = ln(cierre actual / cierre anterior)
HV = desviación estándar muestral de hasta 252 rendimientos × √252
Desviación bajista = √(promedio de min(0, rendimiento)²) × √252
Momentum de 20 sesiones = último cierre / cierre de hace 20 sesiones − 1
Volumen monetario aproximado = promedio de volumen × cierre
Drawdown = 1 − cierre / máximo anterior
```

HV, desviación bajista y drawdown requieren al menos 31 velas para publicarse.
El retorno de 60 sesiones requiere 61 cierres. HV mide variación histórica,
sin indicar la dirección futura, y es distinta de la IV de una opción.
La desviación bajista usa umbral cero y divisor `n`; HV utiliza divisor `n−1`.

## `support-resistance.ts`: confirmación sin anticipación

`PriceLevel` guarda el precio, contactos, fecha del primer pivote y fecha de
confirmación. `StructurePoint` guarda el soporte y resistencia conocidos en una
vela. `Candidate` añade internamente el índice del último contacto.

El recorrido usa por defecto dos velas a cada lado del centro. Un mínimo debe
ser estrictamente menor que los otros mínimos para ser pivote de soporte; un
máximo debe ser estrictamente mayor para ser pivote de resistencia. Solo se
reconoce el pivote cuando ya existen las dos velas posteriores.

Un segundo pivote del mismo tipo dentro de 0.75% del precio del candidato
confirma el nivel. El precio sigue anclado al primer pivote. Por ejemplo, dos
mínimos de 100 y 100.50 pueden confirmar un soporte de 100; su fecha visible
es la segunda confirmación, no la fecha antigua del primer mínimo.

Los candidatos caducan si pasan más de 150 velas desde su último contacto.
En cada vela se copia el soporte más cercano por debajo del cierre y la
resistencia más cercana por encima. Al final se seleccionan hasta dos de cada
tipo. Las copias evitan modificar retrospectivamente los puntos anteriores.

## Sintaxis que aparece en las líneas

| Sintaxis | Lectura |
| --- | --- |
| `readonly Candle[]` | Se reciben velas que la función no debe modificar. |
| `number \| null` | Un valor puede existir o estar explícitamente ausente. |
| `??` | Usa la alternativa solo si el valor anterior es `null` o `undefined`. |
| `?.` | Accede a una propiedad solo si existe el objeto. |
| `valor!` | Afirmación de TypeScript de que el valor existe; no es una validación de ejecución. |
| `map`, `filter`, `reduce` | Transformar, seleccionar y acumular elementos. |
| `...objeto` | Copiar propiedades; no modifica el objeto original. |
| `throw` / `continue` | Detener con error / pasar a la siguiente iteración. |

Para mostrar la relación con la aplicación, sigue
`indicators.ts → ../05-indicadores-y-senales/signals.ts → ../evaluacion/scanner.ts`.
El core técnico mide; las reglas interpretan; el escáner pondera los resultados.
