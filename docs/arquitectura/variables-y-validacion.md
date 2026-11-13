# Variables, modelos y validación

El flujo real es `proveedor → normalización y fechas de disponibilidad → variables con procedencia → cores → evidencia en la interfaz`. Los datos de demostración siguen en un modo explícito y no completan huecos de las fuentes reales.

| Entrada o resultado | Cómo se obtiene | Uso y límite |
|---|---|---|
| Cierre y volumen | Velas diarias Alpaca, con fuente IEX/SIP visible | Tendencia, liquidez accionaria y riesgo retrospectivo. IEX representa una bolsa, no todo el volumen estadounidense. |
| HV | Desviación muestral de retornos log diarios, anualizada con √252 | Volatilidad histórica estimada; no sustituye la IV de opciones. |
| IV, strike, vencimiento, bid/ask y griegas publicadas | Snapshots y metadatos de contratos Alpaca | Se seleccionan contratos existentes. Indicative es un feed derivado, no precios OPRA ejecutables; se identifica como estimación. |
| Ingresos, utilidad, activos, pasivos, caja y acciones | SEC EDGAR Company Facts y presentaciones | Se usan hechos publicados antes del corte. Los ratios solo combinan períodos comparables. Requiere un contacto real en `SEC_USER_AGENT`. |
| Tasa de referencia, inflación y PIB | FRED/ALFRED con vintage anterior al corte | Contexto macro y aproximación explícita de tasa continua para BSM. Requiere `FRED_API_KEY`. |
| Noticias | Titulares Alpaca con publicación y actualización anteriores al corte | Contexto para lectura; no se inventa un score de sentimiento ni una relación causal con ganancias. |
| Dividendo continuo futuro q | Fuente prospectiva o supuesto explícito | No se deduce automáticamente de dividendos pasados ni se rellena con cero. Si falta, BSM y sus probabilidades quedan pendientes. |
| Puntuación 0–100 | Media de los cores seleccionados disponibles | Compatibilidad heurística; si falta un core seleccionado no se cambia silenciosamente el denominador. |
| Probabilidad neutral al riesgo | Modelo de una pierna con contrato, prima, IV, tasa y q completos | Probabilidad terminal bajo los supuestos del modelo; no equivale a éxito futuro ni al payoff completo de Wheel/PMCC/Backspread/Gamma. |
| Frecuencia de aciertos histórica | Operaciones cerradas en ventanas temporales consecutivas | Estadística descriptiva con intervalo Wilson del 95%; no es una predicción calibrada. |

Cada variable lleva `value`, `source`, `observedAt`, `availableAt`, `kind` y, cuando corresponde, `reason`. `kind` distingue observado, estimado, supuesto y ausente. La fecha contable no reemplaza la fecha en que una presentación se hizo pública. Las cadenas de opciones actuales no se usan como si hubieran estado disponibles en una decisión histórica. Las series macro se consultan por vintage para evitar incorporar revisiones futuras.

No se añaden ingresos, inflación o titulares directamente a la fórmula BSM: sus entradas tienen un significado matemático específico. Los fundamentales y las noticias aportan contexto separado; convertirlos en una probabilidad predictiva exige definir una etiqueta, reunir observaciones disponibles en cada fecha, entrenar y calibrar un modelo y evaluarlo fuera de muestra. Esa calibración no se considera realizada por añadir las APIs.

## Validación de acciones

El comparador permite hasta seis empresas, periodos de uno/tres/cinco años y dos reglas fijas: SMA20/50 con y sin RSI14. Descarga una sola serie por empresa para el periodo máximo, deriva los subperiodos y aplica los mismos costes y divisiones temporales. Conserva pérdidas y exclusiones; el CSV incluye la fuente y el corte. Los periodos se solapan y no constituyen experimentos independientes. No se optimizan parámetros ni se elige automáticamente un ganador.

La regla fija SMA20/50 con filtro RSI14 se evalúa con datos conocidos al cierre y se ejecuta en la apertura siguiente. El panel conserva la separación inicial 70/30 y añade ventanas con contexto creciente, un primer contexto del 50% y bloques posteriores de hasta 63 sesiones. Se incluyen comisiones y deslizamiento, y se compara con comprar y mantener.

Cada bloque empieza sin posición y una posición abierta al terminar se valora al cierre. Por ello los bloques describen estabilidad por períodos y no una cartera continua. Un mínimo descriptivo de 30 operaciones cerradas señala muestra insuficiente; alcanzarlo tampoco certifica una estrategia. El intervalo Wilson supone independencia, que puede incumplirse en datos financieros. No se optimizan parámetros mirando las ventanas de prueba.

## Carpetas

- `src/api/research/`: adaptadores Alpaca, SEC y FRED y agregación del proveedor.
- `src/api/analysis/`: autorización, fechas, caché y límites de consultas HTTP.
- `app/api/research/`: rutas mínimas del framework.
- `src/features/research/`: tipos, métricas observadas, hook e interfaz de procedencia.
- `src/cores/observed-ranking.ts`: cálculo puro del ranking real y validación de entradas de opciones.
- `src/features/analysis/`: señales, prueba temporal y presentación.
- `services/trading-runner/`: órdenes Paper, conciliación y ledger persistente.
- `tests/research/` y `tests/trading/`: cobertura de datos ausentes, fechas, modelos y ejecución.

Las instantáneas compactas guardadas en listas conservan fuente, fecha de corte, métricas disponibles, motivos de ausencia y exclusiones. Se preservan en el JSON de metadatos de Supabase y en el archivo MongoDB sin mezclar el estado de demostración con un análisis real.

Documentación primaria: [opciones y sus feeds Alpaca](https://docs.alpaca.markets/us/docs/historical-option-data), [datos SEC EDGAR](https://www.sec.gov/search-filings/edgar-application-programming-interfaces), [acceso justo SEC](https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data), [observaciones y vintages FRED](https://fred.stlouisfed.org/docs/api/fred/series_observations.html).
