# Participación institucional desde SEC 13F

Implementado el 24 de noviembre de 2026. Se consulta automáticamente una muestra
de **Geode Capital Management (CIK 0001214717)** y **State Street
(CIK 0000093751)**. No equivale a todo el mercado, toda la propiedad institucional
o flujo de órdenes intradía. No requiere otra clave: utiliza `SEC_USER_AGENT` y
la conexión Alpaca existente para comprobar splits.

## Fuentes y alcance

El historial público proviene de `data.sec.gov/submissions/CIK##########.json`.
Las tablas XML se localizan en el índice oficial de cada filing en
`www.sec.gov/Archives/edgar/data/{cik}/{accession}/`. Solo se consultan esos hosts,
sin seguir redirecciones ni aceptar URLs del cliente. Comparte la cola SEC de
210 ms entre inicios con los fundamentales, caché de índices de 30 minutos y
tablas parseadas de 24 horas por gestor y accession. Los archivos se comparten
entre símbolos y solicitudes concurrentes. El límite es por proceso; múltiples
réplicas necesitarían coordinación adicional para compartir la cuota.

Los 14 CUSIP del catálogo se corresponden explícitamente con valores y clases,
incluida la clase A de Alphabet. No se asigna una posición por coincidencia
aproximada del nombre. Se contrastaron con la tabla oficial de Geode Q3 2026:
[tabla XML](https://www.sec.gov/Archives/edgar/data/1214717/000121471726000012/GCMQ3202613F.xml).
Los símbolos fuera del catálogo requieren verificar su identificador.

Solo se suman filas de acciones (`SH`), excluyendo put/call y cantidades de
principal (`PRN`). Se valida la cantidad de filas contra `tableEntryTotal`, CIK,
período y formulario de la portada. Se rechazan entidades externas/DOCTYPE,
archivos truncados y omisiones confidenciales.

## Comparación y causalidad

Por gestor se toma el trimestre más reciente publicado antes del corte y el
trimestre inmediatamente anterior. La publicación usa `acceptanceDateTime`;
cuando falta la hora, se aplica un cierre conservador del día de presentación.
La fecha del trimestre nunca sustituye la publicación. Un gestor sin trimestre
comparable, con reportes de más de 200 días o con otro trimestre que la muestra
más reciente queda excluido. El historial reciente SEC puede no cubrir todos los
años y no se simula una cobertura histórica completa.

La última enmienda conocida de reemplazo (`RESTATEMENT`) sustituye a su reporte.
Una enmienda aditiva (`NEW HOLDINGS`) deja al gestor sin evaluar hasta implementar
una consolidación verificable. No se ignora la enmienda para recuperar una cifra.
Si el valor no aparece en alguna tabla, no se presume una venta total ni una
posición cero: pueden existir límites de declaración u otras omisiones.

Alpaca devuelve los splits con fechas entre ambos cierres trimestrales. Se exige
una respuesta completa, sin paginación pendiente, con símbolo, identificador y
razón verificables. La posición anterior se multiplica por `new_rate/old_rate`.
Los cambios de CUSIP o símbolo requieren una correspondencia adicional y quedan
excluidos. No se considera un split como acumulación. La ausencia de ajustes
solo se acepta si la consulta tuvo éxito; una denegación no significa factor 1.

La comprobación de acciones corporativas usa una consulta actual; se excluye de
cortes históricos anteriores a la consulta. Esto limita el backtest, pero evita
atribuir datos consultados hoy a decisiones antiguas sin su historial disponible.

## Puntuación y dibujo

La dirección por gestor es `(acciones actuales − anteriores ajustadas) /
(acciones actuales + anteriores ajustadas)`, entre −1 y 1. Se promedian las
direcciones de gestores comparables del mismo trimestre; **no se suman sus
posiciones para afirmar propiedad total**. La puntuación es `50 + 50 × dirección`
y participa con el peso elegido por el usuario, igual que los demás cores. La
dirección también modifica el escenario de sensibilidad de la gráfica, sin
alterar velas ni atribuir rentabilidad a las variaciones publicadas.

Se muestran posiciones, trimestres, variación porcentual, factor de split y
enlaces a cada filing. Incluso con 2/2 gestores, el estado es `partial` por ser
una muestra. Cambios de mandatos, transferencias y reorganizaciones pueden
explicar variaciones de acciones; no se etiquetan como compras o ventas ciertas.

## Comprobación

`npm run research:check` consulta fuentes reales en modo lectura y muestra cobertura
institucional, métricas Finnhub y faltantes de Monte Carlo para Wheel/PMCC en
modos observado/estimado, sin mostrar claves. Las pruebas automatizadas y de
navegador utilizan datos sintéticos identificados y no envían órdenes.

En la comprobación real, NVDA y AAPL tuvieron dos gestores comparables entre
2026-06-30 y 2026-09-30; State Street utilizó la enmienda de reemplazo del
2026-09-22 para junio. La disponibilidad depende de las consultas futuras y no
se rellena con esa instantánea.

Referencias: [API SEC](https://www.sec.gov/search-filings/edgar-application-programming-interfaces),
[FAQ 13F y plazo de publicación](https://www.sec.gov/rules-regulations/staff-guidance/frequently-asked-questions-about-form-13f),
[acciones corporativas Alpaca](https://docs.alpaca.markets/us/reference/corporateactions-1).
