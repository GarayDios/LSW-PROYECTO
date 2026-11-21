# 3. Core de Noticias Financieras

**Para explicarlo:** «Este core conserva titulares, fuentes y fechas, y excluye
noticias publicadas o modificadas después del corte del análisis».

`normalize-news.ts` transforma respuestas del proveedor en noticias con un formato
común. Conserva únicamente enlaces HTTPS y limita la longitud del titular.
El adaptador `src/api/research/alpaca.ts` consulta y pagina las noticias, y elimina
duplicados entre páginas.

La capa «Noticias» de la gráfica dibuja una línea temporal entre las velas y el
volumen. Las marcas N representan una noticia y los números agrupan titulares
cercanos. El tooltip resume titulares; clic, Enter o espacio abren el detalle con
fuente, fecha de publicación, versión disponible y enlace HTTPS. Las publicaciones
en días sin sesión se sitúan entre sesiones, conservando su fecha real. La capa
no modifica precios, señales ni puntuaciones. En demostración no se mezclan
noticias reales con velas sintéticas.

`GET /api/research/news` consulta exclusivamente las noticias de la empresa para
las fechas seleccionadas, con autorización del propietario y credenciales solo
en el servidor. Los límites del día corresponden a America/New_York e incluyen
los cambios de horario. Se consultan hasta dos páginas de 50 artículos por lote;
«Cargar noticias anteriores» continúa usando la fecha de corte inicial. La
cobertura parcial, los errores y los periodos sin titulares se distinguen. La
consulta general de datos de empresa conserva su ventana de siete días; esta
línea temporal utiliza una consulta independiente para cubrir rangos largos.

`use-chart-news.ts` cancela consultas anteriores y descarta respuestas de otra
empresa o rango. `chart-news.ts` alinea los titulares con las sesiones originales
y la agrupación de velas; los filtros de vista de tres y seis meses conservan los
titulares cargados y muestran únicamente los que corresponden a la vista.

Pruebas: `tests/market/chart-news.test.ts`, `tests/research/news-timeline.test.ts`
y `node scripts/verify-browser.mjs news`. La prueba visual usa titulares QA e
incluye paginación, teclado, errores, cambio rápido de empresa y presentación móvil.
El protocolo del proveedor está documentado en [Alpaca News](https://docs.alpaca.markets/us/reference/news-3).

El resultado aporta contexto verificable. Aún no existe un clasificador de
sentimiento ni una regla validada que convierta titulares en retornos previstos.
