# Flujo institucional: lectura guiada del código

Este apartado interpreta cambios entre posiciones trimestrales SEC 13F de
una muestra concreta de gestores. `sec-13f.ts` tiene comentarios en español
antes de cada línea de código, incluyendo tipos, controles y fórmulas.

## Qué recibe y qué entrega

El núcleo recibe XML de posiciones e informes ya seleccionados. Devuelve
acciones por título y una comparación ajustada entre trimestres consecutivos.
La consulta HTTP, selección de documentos y cálculo agregado están en
[`../../api/research/institutional.ts`](../../api/research/institutional.ts).

```text
Símbolo → CUSIP → documentos públicos de cada gestor
        → tabla de acciones actual y anterior
        → ajuste por splits → cambio y dirección → escáner
```

## Constantes y tipos, en orden

`INSTITUTIONAL_SECURITIES` relaciona los 14 símbolos admitidos con su CUSIP.
Un CUSIP identifica un título concreto: dos clases de acciones de una empresa
no deben mezclarse por compartir emisor. La correspondencia original del código
toma como referencia la tabla oficial de Geode del tercer trimestre de 2026.
Un símbolo desconocido no se resuelve buscando nombres parecidos.

`TRACKED_MANAGERS` identifica a Geode Capital Management y State Street por su
CIK. CIK identifica al declarante en SEC; CUSIP identifica el título que posee.
El sistema no presupone que esos dos gestores representen todo el mercado.

| Tipo | Campos que conviene explicar |
| --- | --- |
| `InstitutionalReport` | `period`: cierre trimestral; `availableAt`: publicación; `accession`: presentación; `url`: evidencia; `shares`: acciones; `amended`: documento enmendado. |
| `InstitutionalManager` | Identidad, explicación y dos informes opcionales; añade factor de split, cambio porcentual y dirección. |
| `InstitutionalResearch` | Estado, CUSIP, gestores configurados y comparables, dirección agregada con procedencia y advertencias. |
| `HoldingsTable` | Diccionario `CUSIP → acciones` y cantidad de entradas XML examinadas. |

Una propiedad con `?` puede no existir. `Pick<T, ...>` devuelve solo las
propiedades indicadas del tipo; `Record<string, number>` describe un diccionario.
`as const` conserva valores literales en el sistema de tipos.

## `xmlValue()` y `validDate()`

`prefix` admite un espacio de nombres XML opcional, como `ns:cusip`.
`xmlValue()` busca apertura y cierre de una etiqueta, extrae su texto simple,
retira espacios y devuelve `null` cuando no encuentra contenido. Las barras
invertidas duplicadas construyen la expresión regular a partir de una cadena.
Este ayudante está limitado al XML esperado, no es un intérprete XML general.

`validDate()` verifica que la entrada sea texto `YYYY-MM-DD`, que pueda
interpretarse y que al convertirla de nuevo produzca la misma fecha. El último
control evita aceptar un día imposible que JavaScript normalizaría al mes siguiente.

## `previousQuarter()`

La función usa UTC para evitar cambios por la zona horaria local:

1. Construye una fecha al comienzo del período recibido.
2. Fija el día en 1 para que cambiar de mes no arrastre días 29, 30 o 31.
3. Retrocede dos meses.
4. Fija el día en 0, que significa el último día del mes anterior.
5. Devuelve únicamente la fecha.

Para `2026-09-30`, devuelve `2026-06-30`. El llamador le proporciona fechas de
cierre trimestral; esta función no selecciona informes ni consulta SEC.

## `parseHoldingsTable()`, línea por línea en el archivo

1. Rechaza XML con `DOCTYPE` o `ENTITY` y exige un contenedor
   `informationTable` completo. No resuelve entidades externas.
2. Extrae todos los bloques `infoTable` completos.
3. Cuenta por separado sus etiquetas de apertura. Una diferencia entre aperturas
   y bloques completos indica truncamiento; también limita a 100000 entradas.
4. Crea el diccionario de posiciones.
5. Por cada bloque lee CUSIP, tipo de cantidad, posible put/call y cantidad.
6. Omite opciones y cantidades cuya unidad no sea `SH`, acciones. Un importe
   de principal no se interpreta como número de acciones.
7. Exige un CUSIP de formato admitido y cantidad entera no negativa.
8. Suma las filas que comparten el mismo CUSIP.
9. Comprueba que la suma siga siendo un entero seguro de JavaScript.
10. Devuelve posiciones y cantidad de bloques examinados.

Si dos filas válidas del mismo CUSIP reportan 100 y 50 acciones, el resultado
es 150. `entries` sigue contando todos los bloques originales, incluso los
que fueron descartados por ser opciones u otra unidad.

## `compareInstitutionalReports()` y sus fórmulas

Primero verifica trimestres consecutivos, factor de split finito y positivo,
cantidades no negativas y al menos una posición no vacía. Después calcula:

```text
anterior ajustado = acciones anteriores × factor de split
cambio relativo = (actual − anterior ajustado) / anterior ajustado
dirección = (actual − anterior ajustado) / (actual + anterior ajustado)
```

Ejemplo: un gestor tenía 100 acciones. Ocurre un split 2:1 y ahora reporta 200.
El anterior ajustado es `100 × 2 = 200`; tanto cambio como dirección son cero.
El aumento mecánico de acciones no se presenta como una compra.

Si después del mismo split reporta 220 acciones, el cambio es
`(220 − 200) / 200 = 0.10`, es decir, 10%. La dirección es
`20 / 420 ≈ 0.047619`. Esta normalización es distinta del porcentaje de cambio.

Si la posición anterior explícita es cero, no existe base para calcular cambio
porcentual y `change` queda `undefined`. Con acciones actuales positivas la
dirección puede ser 1. Una ausencia del título en una tabla no equivale a un
cero explícito: el adaptador exige presencia verificable en ambas tablas.

## Publicación, cobertura y límites del adaptador

El adaptador usa documentos disponibles al corte, trata las enmiendas y exige
dos trimestres consecutivos. También verifica ajustes por splits. Solo mezcla
gestores comparables del trimestre más reciente de la muestra y promedia sus
direcciones; no suma posiciones como si representaran propiedad total del mercado.

Su implementación actual rechaza cortes históricos cuando los ajustes
corporativos consultados ahora no pueden acreditarse para ese pasado. El núcleo
matemático puede comparar informes, pero eso no convierte al adaptador completo
en un backtest histórico institucional validado.

En `../evaluacion/scanner.ts`, una dirección admisible se transforma en
`50 + 50 × dirección`. Se muestran cobertura y fuente. Más acciones reportadas
pueden reflejar operaciones, transferencias de mandatos u otros eventos;
esta evidencia no identifica cada operación ni mide dinero comprado intradía.

Para explicarlo en la presentación: «Comparamos acciones declaradas entre
trimestres, corregimos splits y usamos únicamente la muestra verificable.
Mostramos el retraso y la cobertura de la evidencia institucional».
