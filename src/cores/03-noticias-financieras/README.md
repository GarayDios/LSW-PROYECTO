# 3. Core de Noticias Financieras

**Para explicarlo:** «Este core conserva titulares, fuentes y fechas, y excluye
noticias publicadas o modificadas después del corte del análisis».

`normalize-news.ts` transforma respuestas del proveedor en noticias con un formato
común. Conserva únicamente enlaces HTTPS y limita la longitud del titular.
El adaptador `src/api/research/alpaca.ts` consulta y pagina las noticias, y elimina
duplicados entre páginas.

El resultado aporta contexto verificable. Aún no existe un clasificador de
sentimiento ni una regla validada que convierta titulares en retornos previstos.
