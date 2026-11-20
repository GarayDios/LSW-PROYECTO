# Evaluación y ranking de estrategias

Esta carpeta reúne la coordinación del ranking y las estructuras de opciones.
No añade un octavo core funcional.

`ranking.ts` y `quantitative-criteria.ts` conservan la evaluación de demostración.
`observed-ranking.ts` utiliza evidencia observada. `strategy-analysis.ts` y
`strategy-eligibility.ts` seleccionan y evalúan piernas; `estimated-snapshot.ts`
identifica reconstrucciones bajo supuestos. `option-validation.ts` valida cadenas
históricas importadas y `gamma-path.ts` simula una trayectoria de coberturas.

`catalog.ts` describe los criterios antiguos del ranking y `evaluation-policy.ts`
sus parámetros. La lista de los siete cores funcionales está en `../catalog.ts`.
