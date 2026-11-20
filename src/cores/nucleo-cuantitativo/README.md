# Núcleo cuantitativo compartido

**Para explicarlo:** «Esta es la biblioteca matemática del proyecto. Los siete
cores pueden utilizar sus cálculos, pero no es uno de esos siete módulos».

- `bsm.ts`: precio Black–Scholes–Merton con dividendos continuos y casos límite.
- `greeks.ts`: delta, gamma, theta, vega y rho.
- `probability.ts`: equilibrio y probabilidad teórica de beneficio de una pierna.
- `binomial.ts`: valoración binomial y aproximación al ejercicio americano.
- `implied-volatility.ts`: volatilidad implícita a partir de una prima válida.
- `math.ts` y `validation.ts`: funciones matemáticas y validación de entradas.

Las sensibilidades y probabilidades dependen del modelo; no son predicciones
garantizadas. Los puntajes heurísticos del ranking se separaron en
`../evaluacion/quantitative-criteria.ts`, de modo que las fórmulas no se mezclan
con la compatibilidad de una empresa.
