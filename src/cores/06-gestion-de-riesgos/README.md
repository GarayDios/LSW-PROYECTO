# 6. Core de Gestión de Riesgos

**Para explicarlo:** «Este core mide la exposición y bloquea nuevas operaciones
cuando se incumplen los límites o faltan datos fiables para medir el riesgo».

`f5-risk.ts` agrega exposición bruta, primas y delta, mide pérdida diaria y aplica
límites por cuenta y por ciclo. `operation-state.ts` identifica órdenes pendientes
y la fecha de Nueva York. El servicio de bróker llama a estas funciones antes de
permitir una operación. `scoring.ts` conserva el criterio ilustrativo de riesgo
del ranking de demostración.

Las griegas se calculan en el núcleo cuantitativo; este core utiliza sus
mediciones para controlar el riesgo. Los límites del servicio de acciones que
ya existían siguen en `services/trading-runner/runner.ts`.
