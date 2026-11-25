# 4. Core de Análisis Financiero (Fundamental)

**Para explicarlo:** «Este core estudia los ingresos, resultados, activos y pasivos
de una empresa. Calcula ratios solo si los hechos son comparables y ya estaban
publicados en la fecha del análisis».

`sec-fundamentals.ts` interpreta Company Facts de SEC EDGAR: ingresos y utilidad
anuales, activos, pasivos, efectivo, acciones, margen neto y pasivos/activos.
Además obtiene partidas para `fundamental-metrics.ts`, que ofrece 25 métricas
ampliadas posibles: flujo operativo/capex/flujo libre, liquidez, márgenes,
crecimiento anual, ROA/ROE con balances medios y múltiplos anuales con precio de
mercado. El panel conserva los faltantes e indica cobertura, fuentes y fechas.
Los múltiplos del ejercicio fiscal se distinguen de los TTM y de previsiones de
analistas. Pasivos/patrimonio no se presenta como deuda financiera/patrimonio.
La fecha de publicación se distingue del período contable. El adaptador
`src/api/research/sec.ts` resuelve ticker/CIK, hace las consultas y limita su ritmo.

`finviz-reference.ts` construye un enlace a la ficha pública de la empresa. Es una
referencia externa: no importa valores de Finviz ni requiere credenciales.
`finviz-data.ts` permite, por separado, importar valores copiados por el usuario
de Finviz gratuito; los identifica como captura manual y no sustituye los hechos SEC.
`company-metrics.ts` describe las métricas adicionales de Finnhub y conserva sus
períodos y unidades de presentación.

Lee la [comparación de las fuentes](../../../docs/integraciones/sec-y-finviz.md)
para conocer las métricas adicionales y las opciones de integración oficial.

## Orden de lectura del código documentado

Los seis archivos TypeScript contienen comentarios en español antes de cada
línea de código. Para entender el recorrido completo, sigue este orden:

| Archivo | Responsabilidad |
| --- | --- |
| `sec-fundamentals.ts` | Seleccionar hechos contables publicados y calcular ratios comparables. |
| `fundamental-metrics.ts` | Definir 25 métricas, contar cobertura y añadir múltiplos con precio. |
| `company-metrics.ts` | Describir categorías, unidades de presentación y períodos de métricas Finnhub. |
| `finviz-data.ts` | Interpretar capturas manuales, validar números y comprobar sus fechas. |
| `finviz-reference.ts` | Construir una URL pública; no importa datos. |
| `index.ts` | Exponer las funciones públicas del core. |

## La estructura de una variable financiera

```ts
{
  value: 0.20,                 // Valor del ratio: 20% en este ejemplo.
  source: 'SEC ...',           // Documento o fórmula que respalda el dato.
  observedAt: '...',          // Fecha del hecho o cierre contable.
  availableAt: '...',         // Instante en que podía conocerse.
  kind: 'estimated'           // Ratio calculado a partir de hechos reportados.
}
```

Un hecho publicado tiene clase `observed`; un ratio derivado puede ser
`estimated`. `missing` expresa falta de evidencia y `assumed` identifica un
supuesto declarado. Un valor cero puede ser real; `null` significa que no hay
valor utilizable. El tipo por sí solo no comprueba fechas: lo hacen los filtros
de selección y `knownBy()`.

## `sec-fundamentals.ts`, paso a paso

`missingFundamentals()` construye todos los campos con faltantes explícitos,
incluidas las métricas ampliadas. Esto permite devolver respuestas parciales
sin inventar ingresos, acciones, dividendos ni otros conceptos.

`conservativeFiledAt()` se usa cuando no hay hora de aceptación: considera
disponible el hecho a las 05:00 UTC del día siguiente a `filed`. Ese retraso
permite esperar el final del día calendario del Este. No es la hora real de
publicación y se identifica como alternativa conservadora.

`deriveSecFundamentals()` realiza el siguiente recorrido:

1. Prepara faltantes y normaliza las respuestas `companyFacts` y `submissions`.
2. Localiza conceptos `us-gaap` y `dei`; esta última taxonomía puede aportar
   acciones reportadas del emisor.
3. Relaciona cada `accessionNumber` con `acceptanceDateTime`. El número de
   presentación vincula una cifra con la disponibilidad de su documento.
4. Define `choose()`, que busca una lista de etiquetas alternativas en una
   unidad concreta. Las empresas no siempre reportan la misma etiqueta XBRL.
5. Por cada observación lee valor, inicio, final, fecha de presentación y
   número del documento. Prefiere aceptación exacta a la fecha conservadora.
6. Descarta hechos futuros, sin valor o sin disponibilidad; limita los
   formularios aceptados y, si corresponde, el final del período.
7. Para hechos anuales exige un inicio y una duración de 300 a 400 días.
8. Ordena candidatos por final más reciente, prioridad de etiqueta y fecha de
   presentación. Devuelve el primero o `null`.
9. Selecciona ingresos, utilidad, activos, pasivos, efectivo y acciones.
10. Define `combine()`: solo divide hechos con iguales fechas de inicio y fin
    y denominador positivo. Si no coinciden, conserva un faltante explicado.
11. Publica hechos base e incorpora patrimonio, corrientes, inventarios,
    resultados, flujo operativo, capex y EPS al análisis ampliado.
12. Calcula ratios, crecimiento y retornos sobre balances medios.
13. Cuenta cobertura de las métricas y añade advertencias de disponibilidad.

Ejemplo de fechas: un informe corresponde al 31 de diciembre, pero SEC lo
acepta el 15 de febrero. La cifra conserva diciembre como observación, aunque
no puede usarse para una decisión de enero. Una enmienda posterior al corte
tampoco se utiliza retroactivamente.

## Cómo leer las fórmulas contables

| Métrica | Fórmula y controles del código |
| --- | --- |
| Margen neto | Utilidad neta / ingresos del mismo ejercicio. |
| Pasivos / activos | Ambos saldos de una misma fecha; activos positivos. |
| Flujo libre anual | Flujo operativo − capex; mismo ejercicio y capex no negativo. |
| Margen bruto | Utilidad bruta / ingresos comparables. |
| Margen operativo | Resultado operativo / ingresos comparables. |
| Conversión a efectivo | Flujo operativo / utilidad neta positiva del mismo ejercicio. |
| Razón corriente | Activos corrientes / pasivos corrientes positivos de la misma fecha. |
| Prueba ácida | (Activos corrientes − inventarios) / pasivos corrientes; mismas fechas y activos suficientes para los inventarios. |
| Pasivos / patrimonio | Pasivos totales / patrimonio positivo; no se etiqueta como deuda financiera / patrimonio. |
| Crecimiento anual | Actual / anterior − 1; ejercicio anterior con base positiva y separación de 300 a 400 días. |
| ROA | Utilidad anual / promedio de activos iniciales y finales positivos. |
| ROE | Utilidad anual / promedio del patrimonio inicial y final positivo. |

Ejemplo: ingresos de 1000 y utilidad de 200 del mismo ejercicio producen un
margen de `200 / 1000 = 0.20`, presentado como 20%. Si corresponden a ejercicios
distintos, `combine()` devuelve un faltante. El código no busca automáticamente
otra pareja de hechos si los que ya seleccionó no resultan compatibles.

`growth()` delimita el ejercicio previo al día anterior al inicio del actual.
`returnOnAverageBalance()` exige saldos exactamente al inicio y final del
ejercicio de utilidad. Para utilidad de 100 y activos de 800 al inicio y 1200
al final, ROA es `100 / ((800 + 1200) / 2) = 0.10`, es decir, 10%.

## `fundamental-metrics.ts`: cobertura y precio

`FUNDAMENTAL_METRICS` define 25 entradas y cómo formatearlas. El catálogo
incluye partidas originales, ratios y múltiplos; no garantiza que todas estén
disponibles. `emptyFundamentalAnalysis()` las inicializa y
`fundamentalCoverage()` cuenta valores distintos de `null`.

`enrichFundamentalValuation()` copia las métricas y agrega:

```text
Capitalización estimada = precio × acciones reportadas
P/E anual = precio / EPS del ejercicio
Precio/ventas anual = capitalización / ingresos anuales
Precio/valor contable = capitalización / patrimonio
Rendimiento de flujo libre = flujo libre anual / capitalización
```

Su ayudante `calculate()` exige entradas conocidas al corte, denominadores
positivos y resultados finitos. Para multiplicar exige factores positivos.
P/E queda sin calcular con EPS cero o negativo; flujo libre negativo puede
producir un rendimiento negativo cuando la capitalización es positiva.
El resultado conserva las fuentes de ambas entradas y su disponibilidad más
tardía. Las acciones reportadas pueden ser antiguas: capitalización es una
estimación, y el múltiplo anual no se presenta como TTM ni como precio objetivo.

## `company-metrics.ts`: datos adicionales del proveedor

Este archivo describe claves de Finnhub, no ejecuta sus consultas. Agrupa
valoración, rentabilidad, crecimiento, solvencia y contexto bursátil. Cada
entrada declara una clave exacta, etiqueta, categoría, período y si debe
mostrarse como porcentaje.

TTM significa últimos doce meses; anual refiere al ejercicio indicado;
trimestral corresponde al período publicado por el proveedor. Los períodos
se mantienen separados aunque compartan etiqueta, por ejemplo P/E o margen.
Las métricas de deuda/patrimonio y capitalización que indican «unidad del
proveedor» no reciben una conversión supuesta en este catálogo.

`companyMetricDefinition()` devuelve la definición conocida o conserva una
clave no catalogada en Otras métricas publicadas. `CompanyDetails` guarda las
variables, perfil, recuentos de recomendaciones de analistas y advertencias.
Esas recomendaciones no son órdenes generadas por el terminal.

## `finviz-data.ts`: captura manual sin retroceder su fecha

1. `FINVIZ_FIELDS` define campos y alias reconocidos; los esquemas Zod
   rechazan campos desconocidos, símbolos inválidos o más de 14 empresas.
2. `finvizNumber()` valida el número completo, normaliza signo menos,
   interpreta comas como separadores de miles y convierte porcentajes.
3. `table()` recorre caracteres para admitir CSV/TSV, comillas escapadas y
   saltos de línea dentro de campos citados. Rechaza comillas sin cerrar.
4. `parseFinvizData()` reconoce una tabla con columna Ticker/Symbol o pares
   nombre/valor para una empresa. Rechaza símbolos duplicados y capturas sin
   métricas reconocidas. El límite de texto es de 1000000 unidades de cadena.
5. `withFinviz()` conserva la instantánea de demostración intacta y añade
   capturas del símbolo solo a los análisis aplicables, como supuestos manuales.
6. La captura debe existir en el corte y tener como máximo siete días.
   Opcionalmente puede adelantar un corte actual hasta diez minutos, sin
   adelantar cortes históricos ni inventar una publicación anterior.
7. `finvizInstitutional()` devuelve Inst Trans solo cuando `knownBy()` permite
   usarlo. Inst Own describe participación, no su variación.

En campos porcentuales, `2.5%` y `2.5` se convierten en `0.025`. Si ya se
entrega `0.025` como texto de un campo porcentual, vuelve a dividirse entre 100;
el importador espera el porcentaje que se ve en la página. Un guion de dato
ausente no se transforma en cero. Las capturas añaden información a SEC,
manteniendo ambas procedencias.

## Uso y relación con los demás cores

El orquestador `../../api/research/company.ts` reúne datos y llama a estos
cálculos. `../evaluacion/scanner.ts` transforma las métricas disponibles en
compatibilidad heurística. Los datos ausentes quedan identificados y las
fuentes conservan sus períodos. Este core calcula contexto financiero;
la selección y el envío de órdenes viven en otros módulos.

Para presentar el código, muestra primero cómo se decide **cuándo podía
conocerse una cifra**, después cómo se comprueba que sus períodos coinciden
y finalmente cómo se calcula el ratio. Esa secuencia explica tanto el
resultado como los casos en que el sistema lo deja sin calcular.
