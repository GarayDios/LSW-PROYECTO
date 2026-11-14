# F5 conectado a Alpaca Paper

El flujo principal de opciones deja de crear posiciones calculadas en el navegador y pasa a consultar contratos existentes y enviar órdenes confirmadas a Alpaca Paper. El saldo es virtual. El botón Operar, Opciones F5, Órdenes Paper y Portafolio utilizan el nuevo módulo. Los registros antiguos del laboratorio se conservan en un archivo de solo lectura.

- Wheel: puts garantizadas por efectivo y calls cubiertas por acciones disponibles, descontando las reservadas por planes de acciones.
- PMCC: calls de vencimiento distinto, enviadas juntas; reserva conservadora de asignación y cierre completo revisado.
- Backspread: orden combinada con proporción 1:2 y precio neto firmado.
- Gamma: straddle largo con coberturas revisadas en acciones completas; cada envío requiere confirmación y no abre ventas cortas.
- Revisión de 60 segundos, controles repetidos antes del envío y persistencia SQLite previa al POST.
- Órdenes y ejecuciones del bróker, posiciones y actividades de asignación, ejercicio y vencimiento; sin reloj ni asignaciones inventadas.
- Recuperación de respuestas inciertas sin repetir órdenes, cancelación conciliada y aislamiento por propietario.

La habilitación `ALPACA_F5_ENABLED` es independiente de la automatización de acciones. No se implementan ciclos autónomos F5, rolls individuales, bracket de opciones ni conexión con dinero real.

Consulta [configuración y alcance](../integraciones/f5-alpaca-paper.md) y [evidencia de verificación](../verificacion/f5-alpaca-paper.md).
