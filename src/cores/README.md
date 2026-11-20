# Los siete cores y el núcleo cuantitativo

Empieza aquí para la revisión. Cada carpeta numerada corresponde a un core
funcional. Dentro encontrarás su implementación, un `index.ts` con sus funciones
públicas y un README con una explicación breve.

```text
src/cores/
├── 01-analisis-tecnico/
├── 02-inteligencia-artificial/
├── 03-noticias-financieras/
├── 04-analisis-fundamental/
├── 05-indicadores-y-senales/
├── 06-gestion-de-riesgos/
├── 07-gestion-de-portafolio/
├── nucleo-cuantitativo/       BSM, griegas, equilibrio y probabilidad
├── evaluacion/               Ranking y evaluación de estrategias
├── compartido/               Tipos y procedencia de las variables
├── catalog.ts                Nombres y responsabilidades de los siete cores
└── index.ts                  Entrada histórica compatible del terminal
```

| Core | Frase para explicarlo | Archivo para mostrar |
|---|---|---|
| [1. Técnico](01-analisis-tecnico/README.md) | Calcula cómo se está comportando el mercado. | `indicators.ts`, `market-analysis.ts` |
| [2. IA](02-inteligencia-artificial/README.md) | Estima movimientos y busca el mejor ajuste a las preferencias. | `forecast.ts`, `recommendations.ts` |
| [3. Noticias](03-noticias-financieras/README.md) | Organiza noticias que ya eran conocidas en la fecha del análisis. | `normalize-news.ts` |
| [4. Fundamental](04-analisis-fundamental/README.md) | Describe la situación financiera de la empresa con hechos y ratios. | `sec-fundamentals.ts` |
| [5. Señales](05-indicadores-y-senales/README.md) | Aplica reglas a los indicadores para comprar, vender o esperar. | `signals.ts`, `validation.ts` |
| [6. Riesgos](06-gestion-de-riesgos/README.md) | Comprueba si una operación respeta los límites de exposición y pérdida. | `f5-risk.ts` |
| [7. Portafolio](07-gestion-de-portafolio/README.md) | Lleva las posiciones, el capital y los resultados de los ciclos. | `cycle-simulator.ts` |

El [núcleo cuantitativo](nucleo-cuantitativo/README.md) es una biblioteca matemática
compartida, no uno de los siete cores. El core técnico calcula SMA/RSI y el de
señales interpreta esos valores: una medición y una decisión tienen funciones
distintas.

Las consultas HTTP, claves, paginación y permisos permanecen en `src/api/` y
`services/`. Las pantallas React permanecen en `src/features/`. Se trasladó la
lógica real a estas carpetas; no son carpetas vacías que apuntan a toda la
implementación anterior.

En `compartido/types.ts`, `CoreId` y `CORE_IDS` son nombres históricos de los
criterios del ranking que siguen guardados en listas y solicitudes. La lista de
los siete cores funcionales es `FUNCTIONAL_CORES` en `catalog.ts`.

El core de IA es experimental; noticias todavía no estima sentimiento, y el core
de portafolio todavía no optimiza una cartera conjunta ni ejecuta rebalanceos.
La organización no presenta esas funciones como implementadas.

La [comparación SEC–Finviz](../../docs/integraciones/sec-y-finviz.md) explica las
fuentes del core fundamental y el alcance de Finviz gratuito.

La [matriz de funcionamiento y pendientes](../../docs/verificacion/estado-de-los-siete-cores.md)
incluye el gráfico solicitado por el profesor, sus responsables y los criterios
para revisar cada core.
