// Only these locally authored review messages may cross the private broker proxy.
export const webullReviewMessages:ReadonlySet<string>=new Set([
  "Esta mesa de opciones requiere el sandbox US. Conserva tu región; no se cambia automáticamente.",
  "Webull no confirmó un contrato único para cada pata. Actualiza la cadena.",
  "Solo se admiten contratos americanos estándar vigentes con multiplicador y entrega de 100 acciones confirmados por Webull.",
  "La dirección de la orden debe coincidir con la pata.",
  "La combinación de contratos no corresponde a la estrategia seleccionada.",
  "La mesa admite straddles y strangles comprados; no vende volatilidad descubierta.",
  "Para calendario o PMCC compra la pata larga posterior y vende la corta anterior con strikes compatibles y débito neto.",
  "No se confirmó una posición disponible con la dirección y cantidad necesarias para cerrar.",
  "Covered Call necesita 100 acciones disponibles del subyacente por contrato.",
  "El efectivo liquidado confirmado no alcanza para el débito o la reserva de esta estrategia.",
  "Webull no confirmó la revisión de opciones.",
  "La referencia no corresponde a una única orden de esta cuenta.",
  "El detalle de la orden está incompleto; consúltalo en Webull.",
  "La respuesta no permite conciliar las patas y el importe de la estrategia. Conserva la referencia.",
  "Solo se gestionan órdenes límite simples pendientes; esta orden cambió o no cumple el formato admitido.",
  "La cantidad total debe superar lo ejecutado y no puede aumentar. Prepara otra orden para aumentar exposición.",
  "No se pudieron confirmar identificadores y cantidades de las patas.",
  "Faltan las patas de la orden de opciones.",
  "La orden cambió desde la revisión. Actualiza y prepara una revisión nueva."
]);
