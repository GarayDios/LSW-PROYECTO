# Verificación de F5 Paper

Verificación local del 14 de noviembre de 2026, Windows y Node 25.8.0.

| Comprobación | Resultado |
| --- | --- |
| `npm test` | 219 casos: 218 aprobados, uno omitido, cero fallos. |
| `npm run typecheck` | Aprobado. |
| `npm run build` | Aprobado, con la ruta `/api/f5`. |
| `npm run test:browser -- f5` | Revisión, invalidación al editar, envío único con doble clic, ejecución parcial/completa, cierre inverso, respuesta incierta, recuperación al recargar y diseño móvil. Cero excepciones de JavaScript. |
| `npm run f5:check` | Cuenta Paper activa con opciones nivel 3; 194 contratos estándar de AAPL con vencimiento 2026-11-20, 188 con cotización y consulta individual correcta. Feed indicative. Mercado cerrado. |
| Posiciones, órdenes abiertas y actividades | Consultas reales de lectura correctas con el nuevo cliente. |
| Proxy autenticado `/api/f5` | Estado y contratos respondieron HTTP 200 a través del servicio temporal de lectura; se comprobó también el rechazo sin sesión. |

Las pruebas de navegador usan una API controlada. Los casos de envío prueban Wheel, PMCC, Backspread y Gamma con un bróker inyectado, incluyendo garantías, permisos, contratos inexistentes o incompatibles, límites, mercado cerrado, cotizaciones antiguas, apertura/cierre, coberturas, ejecución parcial y rechazo.

Las pruebas de persistencia cubren concurrencia, reserva previa al envío, expiración durante consultas, reinicio con un POST incierto, recuperación por identificador, respuesta de piernas incompleta, posiciones alteradas manualmente y acciones reservadas por planes de acciones. El servicio F5 comparte la exclusión mutua con el runner de acciones.

La única prueba omitida sigue siendo la integración con una instancia MongoDB real. La persistencia F5 en SQLite y su recuperación sí se probaron.

**No se enviaron ni cancelaron órdenes en una cuenta externa.** No se activaron planes ni se enviaron alertas externas. El servicio temporal usado para comprobar el proxy tenía desactivados los envíos y el loop de automatización. Las lecturas reales no demuestran una ejecución bursátil futura; la primera operación requiere revisión y confirmación en la interfaz durante una sesión habilitada.

Para repetir la prueba de navegador, inicia `npm run dev` y después `npm run test:browser` (el modo predeterminado ahora es F5). `npm run f5:check` consulta el proveedor sin iniciar planes ni requerir el proceso de ejecución. Los pantallazos se guardan en `outputs/`, excluida de Git.
