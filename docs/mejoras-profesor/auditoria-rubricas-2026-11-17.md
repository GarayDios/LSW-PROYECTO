# Auditoría de requisitos y plan de cierre — 17 de noviembre de 2026

## Fuentes y alcance

- `C:/Users/maria/Downloads/Projects 2026-AGO-DIC.pdf`, seis páginas. Págs. 1–4: F0 común; pág. 3: equipos 2 y 3, Balines/Codexs, F5; págs. 5–6: componentes F5 y metodología.
- Captura del mensaje del profesor facilitada el 17 de noviembre: checklist/bitácora de cores, rango operativo, rango histórico, estrategias, generación de lista ordenada y señales calculadas en las velas.
- Mensajes del equipo: sustituir muestras por datos API, adaptar cores, estrategias y persistencia. Requisito adicional comunicado por María: selector Supabase/MongoDB.
- Rúbricas locales en `C:/Users/maria/Downloads/Rubricas Generales-20261002/`: Desarrollo Programa, Sistema o Aplicación; Instalación y Configuración; Presentación y Formato.
- Código de ProyectoFinal y pruebas manuales de esta conversación. Última suite completa: 174 aprobadas, 1 omitida (integración Mongo), 0 fallidas; revisión TypeScript y compilación aprobadas el 17 de noviembre. No implica cumplimiento completo de la rúbrica.

No se ha accedido a una colección denominada Sources dentro de otra aplicación; se localizaron estas copias locales. Las rúbricas son generales: confirmar si el profesor aplica alguna excepción específica. Los documentos son evidencia de requisitos, no autorización para desplegar ni operar cuentas.

## Conclusión de alcance

No basta con Wheel y PMCC. F0 y F5 incluyen más componentes. Tampoco corresponde implementar todas las estrategias F1–F4 asignadas a otros equipos. El PDF combina un núcleo común por equipo con una propuesta de integración colectiva: registrar qué entregará este equipo y qué contrato compartido consumirá, sin declarar cumplida una infraestructura ausente.

## Matriz de cumplimiento

| ID | Requisito / origen | Estado | Evidencia y brecha | Criterio de cierre |
|---|---|---|---|---|
| P01 | Checklist y bitácora de cores, mensaje | Parcial | `src/cores/catalog.ts`, selección en terminal; listas generadas guardan config. No se identificó una bitácora completa de cada evaluación, incluidos intentos sin resultados. | Registrar fecha, fuente, parámetros, cores, resultado por empresa y motivos; recuperar desde la BD. |
| P02 | Rango de operación call/put, mensaje | Parcial | Fechas y horario en formulario y registro; las órdenes individuales registran intención, no ejecutan opciones dentro de la ventana. | Distinguir ventana configurada de ejecución; validar límites y documentar el comportamiento real. |
| P03 | Rango histórico de velas, mensaje | Implementado y probado parcialmente | Alpaca paginado, gráfico y CSV; pruebas del adaptador. Se probaron cambios de períodos durante el trabajo. | Evidencia de fechas extremas, temporalidad y cobertura de tres años por símbolo; límites explícitos. |
| P04 | Elegir estrategias, mensaje/F5 | Implementado | Wheel, PMCC, Backspread y Gamma en catálogo y ciclos. | Evidencia de configuración y restricciones de cada una. |
| P05 | Generar y ordenar empresas con cores elegidos, mensaje | Parcial | `observed-ranking.ts`; se generó lista histórica de 14 empresas. BSM/griegas/probabilidad pueden impedir el ranking completo. | Mostrar criterios, entradas y razones; soportar las selecciones requeridas sin inventar datos ni descartar cores silenciosamente. |
| P06 | Guardar nueva lista en Mis empresas, mensaje | Comprobado en recorrido | Lista Wheel guardada y visible tras recarga; separación Supabase/Mongo comprobada. | Añadir evidencia y probar edición/eliminación con listas de prueba. |
| P07 | Señales calculadas de compra/venta en velas, mensaje | Parcial | `analysis/signals.ts` calcula SMA20/SMA50 y RSI14; `market-chart.tsx` recibe señales. Es una regla fija, no combinación configurable de siete cores/F5. | Mostrar regla, valores, hora de conocimiento y motivo en cada señal; definir relación con cores y estrategia. No forzar señales cuando corresponde esperar. |
| D01 | Usar APIs y sustituir datos de muestra, equipo | Parcial | Alpaca, SEC y FRED consultados. Operar, ciclos y ticker de índices aún usan parámetros/muestras. | Fuente visible junto a cada dato y puente explícito de un contrato observado al formulario, con fecha y calidad; simulación como elección identificada. |
| D02 | Elegir Supabase/MongoDB, usuario | Comprobado en recorridos | Selector, repositorios y guardado; al cambiar se recuperan conjuntos independientes. | Pruebas CRUD, desconexión y conflictos; documentar identidad local compartida. |
| F01 | Black–Scholes y griegas, PDF F0 | Implementado con límites | BSM europeo; delta/gamma/theta/vega/rho calculados en código. UI explica cuatro y el laboratorio adicional expone rho por punto porcentual. | Pruebas de unidades, explicación de supuestos y opción americana; fórmulas con entradas reproducibles. |
| F02 | Árbol binomial para americanas, PDF F0 | Implementado como laboratorio adicional | `src/cores/binomial.ts`, CRR europeo/americano; comparación visible, pruebas de convergencia y casos límite. No sustituye la valoración de ciclos. | Comprobar recorrido visual y acordar si se exige integración adicional en ejecución. |
| F03 | IV por Newton–Raphson, PDF F0 | Implementado como laboratorio adicional | `src/cores/implied-volatility.ts`: Newton protegido y bisección, límites y recuperación call/put probados; prima manual visible. | Comprobar recorrido visual; no presentar la prima manual ni la prueba de recuperación como IV observada. |
| F04 | Cadena multifuente / brokers, PDF F0 | Parcial | Adaptador Alpaca; Webull documentado sin ejecución e IBKR sin adaptador identificado. | Confirmar integración compartida; adaptadores y normalización o alcance autorizado explícitamente. |
| F05 | Margen/tiers, Reg T/SPAN, PDF F0 | No acreditado | Reserva de efectivo y validaciones educativas no equivalen a motor formal de margen. | Política documentada, cálculo probado y límites por tipo de cuenta/posición; definir alcance común con equipo. |
| F06 | Matriz P&L y Monte Carlo, PDF F0 | Parcial | Trayectorias/ciclos y valoración BSM; no se identificó motor Monte Carlo ni matriz completa equivalente a la solicitada. | Tabla/gráfico de escenarios con hipótesis y pruebas; Monte Carlo si permanece exigido. |
| F07 | Wheel automatizado, PDF F5 | Parcial | Recorrido local CSP→acciones→call→salida probado (+4145). Trayectoria de muestra no equivale a automatización del bróker. | Separar simulación, señales, coordinación del ciclo y ejecución; demostrar lo exigido sin afirmar envío de opciones. |
| F08 | PMCC/LEAPS, delta larga >0.80, PDF F5 | Parcial | Vencimiento corto, renovación, asignación y cierre probados (+3571.46). Objetivo de delta en ranking no constituye validación obligatoria de delta larga >0.80. | Comprobar delta de la pierna larga, plazos, strikes, coste y cobertura; advertir o impedir configuración incompatible según especificación. |
| F09 | Ratio/Backspreads, PDF F5 | Implementación local pendiente de prueba guiada | Ciclos y tests disponibles; no se ha probado con María todo el recorrido. | Beneficio/pérdida, cantidades, asignación, cierre y persistencia. |
| F10 | Gamma Scalping dinámico en tiempo real, PDF F5 | Parcial | Ajuste delta con acciones enteras al avanzar puntos del simulador. No es rebalanceo continuo de opciones observadas. | Mostrar objetivo/tolerancia, hedge, costes y eventos; integrar reloj/datos si se exige tiempo real. |
| A01 | PWA, PDF arquitectura | Parcial | Manifest y registro de service worker presentes. | Instalación, actualización y comportamiento sin conexión probados en producción; no almacenar secretos/respuestas privadas en caché. |
| A02 | React+Express, Turborepo, OpenSpec, contratos OpenAPI/gRPC, PDF | Divergencia | React con Vinext/Vite, rutas API y servicios Node; Zod presente. No estructura OpenSpec/Turborepo ni Express identificada. | Documentar contrato real y resolver integración con equipo/profesor; no cambiar todo el stack sin plan de compatibilidad. |
| A03 | Motor Wasm/Python y cadenas WebSocket/gRPC, PDF | No acreditado | Matemáticas TypeScript y consultas HTTP. | Aclarar qué corresponde al motor compartido e integrar si obligatorio. |
| E01 | Órdenes individuales y exportación | Comprobado en recorrido local | AAPL CALL355 prima11.14 total1114, filtros, recarga y exportación confirmados por María. | No afirmar ejecución en mercado; se corrigió el mensaje a Simulación de opciones y se aclara el almacenamiento seleccionado. |
| E02 | Alpaca Paper acciones | Conexión comprobada, ejecución integral pendiente | Cliente y runner existentes, distinto de ciclos F5. | Prueba controlada autorizada de orden/estado/posición/conciliación y límites. No operar como parte de esta auditoría. |

## Rúbricas generales: qué entregar además de la aplicación

### Desarrollo
- Análisis y diseño: diagramas de flujo, componentes, modelos de ambas bases, validaciones y restricciones.
- Resolución y funcionamiento: trazabilidad requisito→algoritmo→pantalla→prueba, incluidos errores y pérdidas.
- Nombres consistentes de componentes, variables y archivos; diseño gráfico claro.
- Código estructurado y comentado por bloques significativos. `terminal.tsx` contiene JSX extenso en líneas muy largas: dividir responsabilidades mejoraría su explicación.
- Video: explicar partes, código importante y una prueba de escritorio hasta el resultado, no solo navegar pantallas.

### Instalación
- Bosquejo, objetivos y componentes alineados; cliente, servidores y conexiones.
- Tutorial paso a paso con capturas reales anotadas.
- Prueba desde una instalación limpia de un compañero. La guía de GitHub es un inicio, no evidencia de que otra computadora funcione.

### Formato
- Introducción con propósito, tema, objetivos y organización; contenido completo; conclusión que responda al problema.
- Objetivos de unidad resaltados naranja, actividad verde, subtemas amarillo.
- Encabezado por página con tema/fecha/página y total; pie con datos de asignatura/docente/instituto.
- Párrafo inglés de 3–5 líneas por página, resaltado azul (o primeras/últimas palabras).
- Diagramas/ilustraciones con conexiones y etiquetas; glosario alfabético de 7–10 términos; ortografía.
- Fecha, equipo e integrantes deben confirmarse al preparar la entrega. No inventar ponderaciones: las rúbricas no aportan pesos en los textos revisados.

## Plan priorizado

1. Núcleo del pedido reciente: bitácora por evaluación, señales explicables y relación entre cores/estrategias; ranking completo con política de datos observados/estimados explícita.
2. Coherencia de fuentes: separar indicadores simulados, cotizaciones anteriores, dividendos supuestos y datos actuales; conectar formularios con contratos reales disponibles sin afirmar ejecución.
3. Completar F0 verificable: rho visible, binomial e IV; definir módulos compartidos de margen, Monte Carlo y múltiples brokers.
4. Completar F5: validación PMCC delta>0.80, prueba de Backspread y Gamma, límites de automatización frente a demostración.
5. Integración: bases CRUD/errores, instalación limpia, PWA/build y contrato colectivo de arquitectura.
6. Evidencias finales: documento, diagramas, prueba de escritorio, video y demostración reproducible; entonces preparar la nota definitiva de Evernote.

## Qué no declarar todavía

- No llamar a los siete checkboxes una implementación completa de F0.
- No llamar a una trayectoria de muestra automatización real de opciones.
- No afirmar que la probabilidad de una sola pierna mide el éxito de Wheel/PMCC.
- No considerar que 171 pruebas aprueban requisitos que no están implementados.
- No considerar el documento de revisión del 16 de noviembre estado actual: sus bloqueos de credenciales y bases ya fueron superados. Se conserva como registro histórico.

Esta auditoría identifica brechas; no cambia fórmulas ni ejecuta órdenes ni modifica los datos guardados. La aceptación final requiere resolver el alcance colectivo del PDF y mostrar evidencia por requisito.

## Mejoras adicionales del 17 de noviembre

Se añadieron modelos F0 independientes y un panel explicativo plegable. Se aclaró la distinción entre dividendo de fuente y supuesto educativo, y entre guardar una orden y enviarla al bróker. No se migraron bases ni se recalcularon los ciclos existentes. Guion: `docs/usuario/guion-presentacion-2026-11-18.md`.

Referencia técnica CRR: https://www.mathworks.com/help/finance/binprice.html . Modelos e IV: https://www.mathworks.com/help/finance/pricing-and-analyzing-equity-derivatives.html .

Validación visual adicional: panel F0 probado en navegador Edge aislado con datos de demostración; CRR e IV visibles, prima imposible rechazada, ancho móvil sin desbordamiento y cero excepciones de ejecución. Capturas locales: `outputs/quant-desktop.png` y `outputs/quant-mobile.png`. No se enviaron órdenes ni se modificaron las bases del usuario.
