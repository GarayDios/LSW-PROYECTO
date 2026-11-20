# 2. Core de Inteligencia Artificial

**Para explicarlo:** «El modelo estima movimientos a partir de situaciones
históricas comparables; después comparamos alternativas con las preferencias del
usuario. Si los datos o los límites no permiten recomendar, propone esperar».

- `preferences.ts`: objetivo, capital, riesgo, horizonte, experiencia y estrategias.
- `forecast.ts`: regresión kNN y validación cronológica frente a referencias simples.
- `recommendations.ts`: filtros obligatorios y puntuación explicable de ajuste.

Las preferencias cambian la selección de alternativas, no los resultados del
mercado usados para entrenar. El modelo es experimental; no acredita rentabilidad
futura. Las pantallas y estilos están en `src/features/intelligence/`.
