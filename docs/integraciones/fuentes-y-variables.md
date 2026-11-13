# Fuentes y variables de investigación

El modo observado usa datos consultados al proveedor y cálculos derivados de ellos. La demostración conserva su universo estático por separado. Una puntuación de selección de 0–100 es una heurística; no significa «probabilidad de que la inversión tenga éxito».

## Organización

- `src/api/research/`: consultas del servidor a Alpaca, SEC y FRED, con `fetch` inyectable.
- `src/features/research/model.ts`: contrato compartido `CompanyResearch` / `ResearchSnapshot`.
- `src/features/research/derive.ts`: métricas puras a partir de velas diarias cerradas.
- `src/cores/observed-ranking.ts`: selección de contratos existentes y núcleos con evidencia verificable.
- `tests/research/`: corte temporal, entradas incompletas, permisos, paginación y fórmulas.

`fetchCompanyResearch({symbol,bars,asOf,historySource,alpaca,sec,fred}, fetcher, now)` devuelve únicamente datos y estados; no devuelve configuración ni claves. El histórico lo proporciona la capa de mercado existente. Para una consulta actual, el servidor captura un único `now`, usa su ISO como `asOf` y pasa ese mismo objeto a la función. Un corte anterior representa un análisis histórico.

## Procedencia de cada número

```ts
type ResearchVariable = {
  value: number | null;
  source: string;
  observedAt: string | null;
  availableAt: string | null;
  kind: 'observed' | 'estimated' | 'missing' | 'assumed';
  reason?: string;
};
```

`observedAt` es el instante o período que mide el dato. `availableAt` es cuándo se podía conocer para decidir. Un balance del 30 de septiembre presentado el 1 de noviembre no se conoce en septiembre. `knownBy` exige ambas fechas anteriores al corte. Los valores ausentes permanecen en `null`; no se sustituyen por valores de demostración ni por cero.

Las secciones del resultado son `market`, `options`, `fundamentals`, `macro`, `news`, `quality` y `warnings`. Cada proveedor tiene un estado visible: disponible, parcial, sin configuración, no disponible o error. Las respuestas de error no copian cuerpos, claves ni URLs con parámetros sensibles. Se rechazan redirecciones con `redirect: 'manual'`, compatible con Workers, y se limita el tiempo de consulta.

## Mercado y opciones: Alpaca

El histórico diario permite calcular HV, retornos, volumen y drawdown. La procedencia debe indicar el feed de acciones (`iex` o `sip`) y el ajuste; el volumen IEX no representa todo el mercado. La disponibilidad de cada vela diaria se retrasa conservadoramente hasta las 06:00 UTC del día siguiente, después de terminar el día completo de Nueva York incluso en invierno. Se exige una vela por día. Alpaca documenta el agrupamiento por [día de Nueva York](https://docs.alpaca.markets/us/docs/market-data-faq); las velas históricas pueden incorporar correcciones y ajustes posteriores del proveedor y no equivalen a una base de precios archivada punto a punto en el tiempo.

La [cadena de opciones](https://docs.alpaca.markets/us/reference/optionchain) (`/v1beta1/options/snapshots/{symbol}`) se une a los [contratos Paper](https://docs.alpaca.markets/us/reference/get-options-contracts) (`/v2/options/contracts`). Se consultan vencimientos explícitos hasta dos años, con paginación limitada y estado parcial si queda información. No se inventa un contrato desde el precio de la acción.

`indicative` utiliza cotizaciones modificadas y operaciones retrasadas; sus variables se marcan estimadas. `opra` requiere los permisos correspondientes. Un rechazo de permisos no cambia silenciosamente de feed. IV y griegas proceden del snapshot del contrato. El punto medio bid/ask es una prima estimada por acción, no una promesa de ejecución. Un spread inválido o una cotización de más de una hora deja esas entradas ausentes.

La cadena consultada es actual. No se usa para decisiones anteriores al momento de consulta ni se promete reconstruir tres años de opciones. El [histórico de opciones de Alpaca](https://docs.alpaca.markets/us/docs/historical-option-data) comienza en febrero de 2024 y tiene sus propias condiciones de acceso; tres años de acciones no equivalen a tres años de cadenas archivadas.

Las [noticias de Alpaca](https://docs.alpaca.markets/us/reference/news-3) aportan titulares y enlaces de los siete días anteriores al corte. Se excluyen artículos cuya revisión sea posterior. No se inventa sentimiento ni impacto numérico a partir de un titular; un proveedor puede limitar el acceso. Los titulares no aseguran cobertura exhaustiva de riesgos externos.

## Variables internas: SEC EDGAR

Las [APIs oficiales SEC](https://www.sec.gov/search-filings/edgar-application-programming-interfaces) no exigen una clave. Se configura `SEC_USER_AGENT` con nombre de aplicación y contacto real, conforme a la [política de acceso SEC](https://www.sec.gov/about/developer-resources). Se resuelve ticker → CIK con el directorio oficial; `submissions` aporta las fechas de aceptación y `companyfacts` los hechos XBRL.

El directorio de tickers se cachea una hora y las consultas simultáneas comparten su promesa. Una cola común al proceso separa los inicios SEC por 210 ms (menos de cinco consultas por segundo); una espera superior a cinco segundos devuelve estado de error. Una instalación distribuida necesita coordinar adicionalmente este límite entre instancias que compartan IP.

Se extraen ingresos y resultado neto de períodos anuales completos, activos, pasivos, efectivo y acciones. Margen neto y pasivos/activos solo se calculan si coinciden los períodos. Las empresas pueden declarar conceptos personalizados no cubiertos: se deja el dato ausente. No se convierten períodos trimestrales en años sin aviso.

Se elige la versión publicada antes del corte; las modificaciones futuras se excluyen. Si no hay hora de aceptación, se espera conservadoramente hasta las 05:00 UTC del día siguiente a la presentación. Nombre y correspondencia actual ticker/CIK son contexto, no una reconstrucción del universo histórico; no corrigen sesgo de supervivencia.

Los dividendos históricos **no** determinan el rendimiento continuo futuro `q` requerido por BSM. `dividendYield` permanece ausente hasta contar con fuente prospectiva o un supuesto manual explícito con `kind: 'assumed'`, incluida la decisión explícita de usar cero.

## Variables externas: FRED / ALFRED

Con `FRED_API_KEY` se usa [series/observations](https://fred.stlouisfed.org/docs/api/fred/series_observations.html). Sin la clave se informa `missing_config`. Los [períodos en tiempo real de ALFRED](https://fred.stlouisfed.org/docs/api/fred/realtime_period.html) permiten consultar la información que se conocía entonces, evitando incorporar revisiones posteriores en GDP o inflación. Se selecciona una vintage anterior al corte y se añade un margen conservador por falta de hora de publicación.

| Serie | Uso | Unidad en el modelo |
| --- | --- | --- |
| [DGS3MO](https://fred.stlouisfed.org/series/DGS3MO) | Rendimiento Treasury 3 meses | Porcentaje anual observado; tasa continua estimada `log(1 + porcentaje/100)` |
| [CPIAUCSL](https://fred.stlouisfed.org/series/CPIAUCSL) | Inflación interanual | Índice último mes / índice mismo mes año anterior − 1 |
| [A191RL1Q225SBEA](https://fred.stlouisfed.org/series/A191RL1Q225SBEA) | Crecimiento real GDP trimestral anualizado | Porcentaje / 100 |

DGS3MO es un rendimiento de mercado con convención propia, no una curva cero-cupón calibrada al plazo exacto de cada opción. Su conversión es una aproximación de modelado etiquetada. Si tiene más de diez días no se utiliza para valorar opciones. Inflación y GDP son contexto macro, no señales causales calibradas ni una probabilidad de inversión.

## Cálculos y límites

- **HV**: desviación estándar muestral de hasta 252 retornos logarítmicos diarios × √252; mínimo 31 velas. Es volatilidad histórica realizada, distinta de la **IV** de opciones.
- **Tendencia**: retornos de 20 y 60 sesiones. **Liquidez**: promedio de 20 sesiones de volumen × cierre. **Riesgo**: drawdown máximo de hasta 252 sesiones y desviación bajista respecto a retorno diario cero.
- Cada núcleo incluye la fórmula de su heurística, las variables usadas y sus fechas. Se acota a 0–100 y se aplica igual peso a los seleccionados. Si falta uno, la puntuación conjunta es `null`; no se oculta el faltante redistribuyendo pesos.
- BSM, griegas y probabilidad necesitan spot reciente, contrato real, strike, vencimiento, IV, prima bid/ask, tasa y `q` explícitos. La fecha de vencimiento se aproxima a las 21:00 UTC; no cubre todos los calendarios especiales. El cierre diario de la acción y el punto medio no sustituyen cotizaciones ejecutables sincronizadas.
- BSM europeo aproxima opciones estadounidenses que pueden ejercerse antes. La probabilidad separada es terminal, neutral al riesgo, de **una pierna**; excluye comisiones, ejercicio anticipado y desempeño de toda la estrategia. No es una probabilidad calibrada de ganar en el mundo real.

Una predicción calibrada requeriría objetivos, horizontes, costos, separación temporal de entrenamiento/validación/prueba, datos disponibles en cada fecha, evaluación fuera de muestra y seguimiento de calibración. Los proveedores y metadatos de este módulo preparan esas entradas; no afirman que ese modelo ya exista.
