# Cierre verificable de los pendientes

Este documento corresponde a la implementación local. Las pruebas de interfaz
usan perfiles aislados y proveedores identificados como fixtures; no acreditan
operaciones reales en la cuenta Paper ni rentabilidad futura.

| Pendiente de la captura | Implementación / comprobación | Límite que permanece |
|---|---|---|
| 1. Confirmar y guardar Órdenes | `verify-browser.mjs delivery`: revisar, confirmar, abrir Órdenes, recargar y recuperar el registro. Guarda fuentes, entradas BSM, unidades del contrato y modo observado/estimado/manual/demo. | La confirmación registra una simulación. La sincronización remota conserva su estado y errores en el indicador de almacenamiento. |
| 2. Completar ranking de opciones | Modo estimado explícito con tasa y dividendos supuestos, HV como volatilidad y bid/ask teóricos en contratos existentes. Las fuentes originales permanecen intactas. | Si no hay contrato o supuesto necesario, sigue incompleto. PMCC/Gamma y dividendos discretos no reciben una probabilidad inventada; se puede desactivar ese core. |
| 3. Fuentes reales y simuladas | Cada índice de muestra lleva DEMO. El ticket conserva fuentes por variable y separa prima manual de cotización. La cabecera identifica las velas, no todas las tarjetas. Los ciclos usan muestras editables identificadas. | Datos IEX/indicative tienen cobertura y calidad distintas de SIP/OPRA. |
| 4. Dividendos | La tarjeta separa dividendo externo, dividendo usado por el modelo y supuesto educativo. Consulta pagos futuros recibidos; permite valorar solo esos pagos con ajuste de valor presente. | Un calendario vacío/parcial no demuestra ausencia de dividendos. No se convierte la historia de pagos en rendimiento futuro confirmado. |
| 5. Alpaca Paper | `delivery` comprueba cuenta, orden enviada, ejecución y posición con fixtures. `broker:check` y `research:check` son comprobaciones reales de solo lectura. | La prueba de una operación controlada en la cuenta real Paper no se sustituye por un mock. Los switches de ejecución no se activan como parte de estas pruebas. |
| 6. Otros escenarios | Tests de los cuatro ciclos: pérdidas, capital insuficiente, comisiones, proporción 1:2, asignación de PMCC y coberturas Gamma. Replay nuevo con spreads, comisiones, préstamo y límites. | Los escenarios no son un backtest de ejecuciones reales. |
| 7. Errores y presentación | `delivery`: fechas inválidas, denegación de histórico, recuperación, fuente que permanece Alpaca y ancho móvil. Suite de persistencia: conflictos, desconexión y reintentos. | Las limitaciones del proveedor se muestran en vez de sustituirse por muestras. |
| 8. Instalación | `npm run verify:clean` copia código a una carpeta temporal, excluye secretos y node_modules, instala desde lockfile, revisa tipos, ejecuta pruebas y compila. Produce `outputs/clean-install-report.json`. | Es una instalación aislada en esta máquina. Un compañero todavía debe confirmar su propio sistema, credenciales y conectividad. |
| 9. Documentación / profesor | `docs/entrega/guia-defensa.md`, esta matriz y la auditoría de rúbricas existente trazan arquitectura, datos, fórmulas, estrategias y pruebas. | No se acreditan margen oficial, múltiples brokers, motor Wasm/gRPC ni una rúbrica no revisada directamente. La auditoría original se conserva como evidencia histórica. |

## Mejoras financieras y modo estimado

El generador conserva un diagnóstico por empresa cuando no hay puntuación:
contratos recibidos, contratos que superan filtros individuales y descartes por
IV, bid/ask, antigüedad, sincronización, spread, vencimiento o metadatos. Los
conteos se pueden solapar. Selección y diagnóstico comparten los mismos filtros.
Se distinguen cadena ausente, calidad insuficiente, estructura, spread y capital.
Si el capital impide seleccionar, se muestra el coste de una combinación sin
ese límite; es un ejemplo compatible, no el capital mínimo de toda la cadena.

El panel permite escribir un dividendo anual y aplicar explícitamente el modo
estimado. No tiene un dividendo preseleccionado. Conserva tasa, capital y supuestos
individuales, y pide recalcular con Generar oportunidades. Otra acción selecciona
los cores históricos de acciones. Si cambia la configuración, marca el diagnóstico
anterior como pendiente de recalcular. Una consulta sin puntuaciones no crea una
lista vacía ni se presenta como un fallo de conexión.

- **FRED:** agregar una clave personal en `FRED_API_KEY` de `.env.local`, reiniciar
  el proceso y ejecutar `npm run fred:check`. Solo el servidor recibe la clave.
  Se conserva ALFRED por vintage para no usar revisiones posteriores en el pasado.
  La tasa manual es una alternativa de escenario, nunca una observación FRED.
- **Validación histórica de opciones:** importador JSON, entrenamiento creciente,
  bloques cronológicos de prueba, purga de etiquetas cuyo resultado aún no se
  conocía, comparación contra pesos iguales e intervalo descriptivo Wilson.
  Requiere cotizaciones OPRA históricas y salidas de las piernas seleccionadas.
  Datos sintéticos, indicative y supuestos actuales no se promueven a evidencia.
- **PMCC:** delta mínima configurable (perfil de interfaz 0.81, superior a 0.80), reserva conservadora de nominal corto,
  financiación simple del débito y matriz de precio × cambio relativo de IV de la
  call larga. La reserva no es una implementación Reg T/SPAN ni margen confirmado.
- **Gamma:** replay de acciones enteras con tolerancia, intervalo de ajuste,
  cotizaciones bid/ask, comisiones, préstamo y permiso explícito de acciones cortas
  dentro de la simulación. Compara contra mantener el straddle sin cobertura.
  Las opciones se marcan con BSM; no se venden realmente ni se presenta esto como
  frecuencia histórica de éxito de scalping.
- **Sincronización:** consulta cotización de la acción y limita su desfase frente
  a las piernas en minutos; si solo hay cierre diario lo identifica como tal.
  Los dividendos discretos recibidos tienen disponibilidad en la consulta actual;
  no se les inventa una fecha histórica de anuncio.

BSM utiliza una puntuación neutral de 50 cuando la prima fue reconstruida con
el mismo modelo: una coincidencia algebraica no se interpreta como oportunidad
de mercado. Los pesos siguen siendo decisiones revisables hasta contar con
evidencia suficiente fuera de muestra.
Con cores exclusivamente históricos puede generarse una lista de acciones aunque
la estrategia de opciones siga incompleta. Se identifica como perfil histórico y
no participa como estrategia apta en la recomendación del comparador.
La reconstrucción estimada tiene un límite configurable de candidatos (128 por
defecto), repartido entre plazo solicitado y plazo largo. La selección geométrica
es parcial y se identifica; no se afirma que explore toda la cadena ni el óptimo.

## Formato de datos para validación

El botón «Descargar ejemplo sintético» entrega el formato completo, con `kind:
"fixture"`. Para datos reales, el archivo debe declarar `kind: "observed"`, una
fuente y `samples` de instantáneas con corte propio y `exits`:

```json
{
  "version": 1,
  "source": "Proveedor y procedimiento de extracción",
  "kind": "observed",
  "samples": [
    {
      "snapshot": "Objeto de investigación con variables, contratos y fechas, como en el ejemplo descargable",
      "exits": [
        {"symbol":"CONTRATO", "at":"2025-02-01T16:00:00Z", "availableAt":"2025-02-01T16:00:01Z", "bid":1.2, "ask":1.3}
      ]
    }
  ]
}
```

El texto de `snapshot` de este esquema explicativo se reemplaza por el objeto
completo del ejemplo descargable. No basta un CSV de cierres de acciones. Las
salidas de las piernas deben ser únicas, estar sincronizadas y ser posteriores
al corte y anteriores o iguales al primer vencimiento. Una etiqueta de entrenamiento
solo puede usarse cuando su `availableAt` ya pasó antes de decidir en prueba.

El importador verifica las fechas declaradas, no la autenticidad del proveedor.
La selección del universo también debe controlar supervivencia, ajustes corporativos
y disponibilidad histórica. Para habilitar la promoción manual de pesos se requieren
al menos 30 períodos de prueba, tres bloques, tres empresas y datos observados.
Cumplir ese mínimo no garantiza capacidad predictiva.

## Reproducción de evidencia

### Comprobación de la integración macroeconómica

`npm run research:check` consulta AAPL en modo de solo lectura y verifica que la
tasa efectiva coincide con la evidencia de entrada del modelo. El bloque
`macroIntegration` informa tasa continua, origen, fechas, sustitución manual y
faltantes de valoración y estrategia. Una respuesta FRED disponible no equivale
a una cadena de opciones completa: se mantienen explícitos los bloqueos por IV,
bid/ask o dividendos. El script usa el feed de acciones configurado.

La interfaz distingue tasa externa y tasa aplicada, señala una sustitución manual
y muestra el origen en el comparador. Inflación y PIB siguen siendo contexto;
no existe una regla validada que los transforme automáticamente en pesos.
La tasa DGS3MO es una aproximación común: permanece pendiente una curva por
vencimiento. Las pruebas `macro-integration.test.ts` cubren FRED → entradas →
valoración/ranking, sensibilidad a la tasa manual, regreso a la automática y
rechazo de una tasa cuya disponibilidad sea posterior al corte.

```powershell
npm test
npm run typecheck
npm run build
npm run dev
# En otra terminal, mientras la app esté en http://127.0.0.1:5173:
node scripts/verify-browser.mjs delivery
node scripts/verify-browser.mjs cycles
node scripts/verify-browser.mjs persistence
# Después, para una instalación aislada sin credenciales:
npm run verify:clean
```

La prueba `delivery` intercepta acciones externas y usa almacenamiento local del
perfil de prueba. Los logs y capturas se guardan en `outputs/`, que no se publica
en Git. No se copian `.env.local` ni bases de datos a la instalación temporal.

Referencias: [FRED y claves personales](https://fred.stlouisfed.org/docs/api/api_key.html),
[cotizaciones de acciones Alpaca](https://docs.alpaca.markets/us/reference/stocklatestquotesingle-1),
[eventos corporativos y sus retrasos](https://docs.alpaca.markets/us/reference/corporateactions-1).
