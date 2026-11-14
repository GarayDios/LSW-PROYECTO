# Opciones F5 en Alpaca Paper

Para operar la versión actual consulta [la guía de F5 Paper](../integraciones/f5-alpaca-paper.md): contratos existentes, revisión, confirmación, órdenes y posiciones del bróker. Los pasos de simulación descritos en este manual corresponden al laboratorio anterior, conservado como archivo de solo lectura. El saldo de Alpaca Paper sigue siendo virtual.

# Guía de usuario · TEPIC Options Lab

Versión 1.0 · 9 de noviembre de 2026

Abre el terminal: [TEPIC Options Lab](https://tepic-options-lab.dewy-jam-1238.chatgpt.site).

Esta versión es un laboratorio de práctica: los precios y las velas son de muestra y las órdenes son simuladas. No necesitas claves de Alpaca y ninguna operación se envía a un bróker.

## 1. Ubícate en la pantalla

| Zona | Para qué sirve |
|---|---|
| Menú izquierdo | Abrir Explorador, Mis empresas, Órdenes y Portafolio. |
| Mis listas | Consultar Mi seguimiento, Tecnología y las listas que crees. |
| Gráfico central | Seleccionar una empresa, cambiar la vista y consultar sus métricas. |
| Construye tu oportunidad | Elegir fechas, horario, histórico, núcleos y estrategia. |
| Tabla bajo el gráfico | Buscar empresas, comparar datos y abrir una simulación. |
| Menú superior Estrategias | Leer la descripción de cada estrategia y seleccionarla para analizar empresas. |

En el celular, abre el menú izquierdo con el botón de tres líneas. Desplázate hacia abajo para llegar a Generar oportunidades y a la tabla.

## 2. Define el rango de operación

En Explorador, busca el bloque 01 · Rango de operación.

1. En Desde, elige el inicio del escenario.
2. En Hasta, elige su fecha final. No puede ser anterior al inicio.
3. Ajusta la apertura y el cierre. Ambos deben quedar entre 09:30 y 16:00, con apertura anterior a cierre.

El horario es de Nueva York (ET), no la hora local de Tepic. El navegador puede mostrarlo como 09:30 y 16:00 o como 9:30 a. m. y 4:00 p. m.

Este rango delimita el escenario y las fechas de vencimiento permitidas al simular. No programa compras ni ventas automáticas.

## 3. Configura el histórico de velas

En el bloque 02 · Histórico de velas, indica Desde y Hasta. El inicio debe ser anterior al final, y el final no puede superar la fecha de inicio de operación.

| Temporalidad | Qué representa el control |
|---|---|
| 5m | Intervalo de cinco minutos. |
| 15m | Intervalo de quince minutos. |
| 1h | Intervalo de una hora. |
| 1d | Intervalo de un día. |

Los botones 1D, 1S, 1M, 3M y 1A del gráfico son atajos para ajustar el rango visual. Los iconos de velas y línea cambian la presentación. Pasa el cursor por el gráfico para consultar apertura, máximo, mínimo y cierre; con el gráfico enfocado también puedes usar las flechas del teclado.

Las velas son sintéticas. Cambiar este histórico modifica el gráfico; no descarga datos reales, no ejecuta un backtest y no recalcula el ranking a partir de esas velas.

## 4. Selecciona los núcleos F0

En el bloque 03 · Núcleos cuantitativos, marca uno o varios:

| Núcleo | Información que aporta |
|---|---|
| Black–Scholes–Merton | Precio teórico de una opción bajo los supuestos del modelo. |
| Griegas | Sensibilidades del precio de la opción: Delta, Gamma, Theta y Vega. |
| Equilibrio y probabilidad | Umbral de equilibrio y probabilidad teórica del contrato analizado. |

Para conocer el recorrido completo, puedes dejar los tres activados. Debe quedar al menos uno seleccionado. En el ranking, los núcleos activos tienen el mismo peso; los desactivados no aportan a la puntuación.

La franja de griegas situada debajo del gráfico corresponde a una call estimada con strike cercano al precio del activo. No es el riesgo combinado de toda la estrategia seleccionada.

## 5. Elige una estrategia F5

En el bloque 04 · Elige tu estrategia, selecciona una sola opción:

- The Wheel.
- Poor Man’s Covered Call (PMCC).
- Call Ratio Backspread (1:2).
- Gamma Scalping.

La tarjeta elegida queda resaltada en naranja. Para leer su descripción, abre Estrategias en el menú superior; Analizar empresas selecciona esa estrategia y te devuelve al explorador.

La selección cambia el perfil utilizado para clasificar empresas. Esta versión no construye automáticamente todas las piernas de una estrategia ni rebalancea Gamma Scalping.

## 6. Genera y revisa tu lista de empresas

1. Revisa los cuatro bloques del configurador.
2. Pulsa Generar oportunidades, al final del panel.
3. Aparecerá una lista nueva dentro de Mis listas, con el nombre de la estrategia y una fecha.
4. La tabla mostrará las 14 empresas de muestra ordenadas por Compatibilidad, de mayor a menor.
5. Pulsa la puntuación de una empresa para ver los motivos y los parámetros originales del análisis.

Una puntuación de 80/100 significa ajuste a los criterios de esta clasificación. No significa un 80% de probabilidad de ganar ni una rentabilidad esperada del 80%.

Cada vez que pulses Generar oportunidades se crea otra lista; no se sustituye la anterior. Para comparar escenarios, cambia la estrategia, los núcleos o el plazo y genera una lista nueva.

Al abrir una lista generada desde el menú izquierdo, se recuperan sus filtros de fechas, horario, núcleos, estrategia e histórico. Su puntuación conserva los parámetros originales, incluida la tasa utilizada al generarla; abrir la lista no cambia la tasa global de Configuración. Después de recargar, vuelve a seleccionar tu lista desde el menú, porque la pantalla comienza en Mi seguimiento.

El generador analiza las 14 empresas del universo de muestra, aunque tengas abierta una lista manual con menos empresas.

En la tabla puedes:

- Buscar por símbolo, nombre o sector dentro de la lista abierta.
- Pulsar el encabezado de Empresa, Precio, Cambio o Compatibilidad para cambiar la ordenación.
- Pulsar el nombre o símbolo de una empresa para verla en el gráfico.
- Usar la flecha de descarga para exportar a CSV las empresas que ves, respetando la búsqueda y el orden actuales.
- Eliminar una lista creada con el icono de papelera. Las dos listas iniciales no se eliminan desde este control.

En computadora, la tecla / lleva el foco al buscador cuando no estás escribiendo en otro campo ni tienes un diálogo abierto.

## 7. Simula una compra o venta de call o put

1. Selecciona una empresa y pulsa Operar encima del gráfico. También puedes usar la flecha de la última columna de su fila.
2. Elige Comprar o Vender.
3. Elige CALL o PUT.
4. Completa Strike, Vencimiento, Contratos y Prima límite.
5. Revisa las métricas y el importe nominal.
6. Pulsa Revisar operación.
7. Comprueba el resumen. Usa Editar si necesitas corregirlo.
8. Pulsa Confirmar simulación para guardarla.

| Campo | Cómo llenarlo |
|---|---|
| Strike · USD | Precio de ejercicio, mayor que cero y con un máximo de dos decimales. |
| Vencimiento | Fecha dentro del rango de operación configurado. |
| Contratos | Número entero entre 1 y 100. Cada contrato usa un multiplicador de 100 acciones. |
| Prima límite · USD | Prima por acción, mayor que cero y con un máximo de dos decimales. |

El botón Usar precio copia el precio teórico BSM a la prima límite. Si cambias el tipo de opción, el strike o el vencimiento, vuelve a pulsarlo si quieres usar el nuevo valor teórico.

Ejemplo de importe: 1 contrato × 100 acciones × USD 2.50 de prima = USD 250.00 de prima nominal. En compra se muestra como débito y en venta como crédito. No es un cálculo de ganancia neta, margen o capital requerido.

Equilibrio y Prob. de beneficio son estimaciones del contrato bajo el modelo. La probabilidad no es histórica ni corresponde a toda una estrategia multipierna. Las griegas mostradas son del contrato modelado, no del riesgo agregado de un portafolio.

La versión de práctica permite elegir fechas dentro del rango, pero no verifica que exista un contrato negociable con ese vencimiento. Guardar una simulación no abre una posición ni ejecuta una orden, aunque la fecha o la hora configuradas ya hayan llegado.

## 8. Consulta tus órdenes y el portafolio

En Órdenes encontrarás Registro de simulaciones. Usa Todas, Compras o Ventas para filtrar, y Exportar para descargar el registro completo a CSV. La papelera elimina una simulación del registro local; no es una cancelación enviada a un mercado.

Portafolio muestra un capital de práctica de referencia de USD 100,000, el nominal acumulado de primas de compra simuladas y el número de órdenes. No representa el saldo de una cuenta de bróker ni una evaluación de ganancias y pérdidas.

## 9. Crea listas manuales y conserva tus datos

Para agrupar empresas por tu cuenta:

1. Pulsa Crear una lista o el signo + junto a Mis listas.
2. Escribe un nombre.
3. Marca al menos una empresa del universo de muestra.
4. Pulsa Crear lista con… empresas.

Las listas manuales sirven para seguimiento y no tienen puntuaciones automáticas de compatibilidad.

Sin configuración remota, las listas, órdenes, ciclos y tasa del modelo se guardan en el mismo navegador y dispositivo. Recargar conserva esos datos si el navegador permite el almacenamiento; cambiar de equipo no los sincroniza y borrar los datos del sitio puede eliminarlos. Con [Supabase y MongoDB configurados](../base-de-datos/configuracion.md), el terminal carga el estado de tu cuenta, guarda los cambios en la nube y conserva borradores por usuario. La pantalla indica el estado de guardado y solicita permiso explícito antes de importar los datos antiguos del navegador a una cuenta nueva.

Exporta los CSV que quieras conservar para consulta. La aplicación no incluye una función para restaurar datos importando esos CSV.

En Configuración puedes modificar la Tasa anual libre de riesgo del modelo. Cambiarla actualiza los cálculos actuales; para obtener otro ranking con ella, genera una lista nueva. Las listas anteriores mantienen sus puntuaciones originales.

## 10. Recorrido de práctica de principio a fin

Este ejemplo sirve para aprender los controles, sin recomendar una inversión:

1. Abre Explorador.
2. Configura operación desde el 9 de noviembre de 2026 hasta el 11 de diciembre de 2026, de 09:30 a 16:00 ET.
3. Configura histórico desde el 9 de octubre de 2026 hasta el 9 de noviembre de 2026, con temporalidad 1h.
4. Activa los tres núcleos F0 y selecciona The Wheel.
5. Pulsa Generar oportunidades y consulta los motivos de la primera empresa.
6. Selecciona una empresa de la lista, pulsa Operar y elige Comprar y CALL.
7. Conserva un vencimiento dentro del rango, indica un contrato y pulsa Usar precio.
8. Revisa y confirma la simulación; después abre Órdenes para comprobar que aparece.
9. Regresa al explorador, cambia a Gamma Scalping y genera otra lista para comparar el orden de las empresas.

Las fechas se escriben aquí con el mes en texto para evitar confusiones. En los campos, el orden día/mes/año depende del navegador.

## 11. Si algo no funciona

| Situación | Qué revisar |
|---|---|
| No se genera una lista | Deja al menos un núcleo activo y comprueba las fechas y horas. El mensaje aparece junto al botón de generación. |
| Operar no abre el formulario | También requiere que el configurador tenga núcleos, histórico y rango operativo válidos. |
| El histórico se rechaza | Desde debe ser anterior a Hasta, y Hasta no debe superar el inicio operativo. |
| La tabla no encuentra una empresa | Busca dentro de la lista abierta. Solo está disponible el universo de muestra; no existe búsqueda de todo el mercado. |
| Las puntuaciones no cambian al mover el histórico | Es esperado: el histórico visual no alimenta el ranking en esta versión. |
| Dos listas tienen el mismo orden | Configuraciones equivalentes dan resultados deterministas; un cambio pequeño puede conservar las mismas puntuaciones redondeadas. |
| No aparecen mis listas en otro equipo | Comprueba si el estado indica guardado local. Para recuperar datos de una cuenta en otros dispositivos, configura la persistencia remota y usa la misma identidad. |
| Aparece una página sin conexión | Restablece internet y pulsa Volver a intentar. La instalación como PWA no habilita el terminal completo offline. |

Si el navegador ofrece Instalar aplicación o Agregar a pantalla de inicio, puedes usar esa opción para abrir TEPIC en una ventana propia. La disponibilidad depende del navegador y del dispositivo.

Para consultar la ayuda breve dentro del terminal, pulsa Guía del explorador o Centro de ayuda.
