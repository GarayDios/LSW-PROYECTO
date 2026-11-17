# Revisión de entrega — 16 de noviembre de 2026

Carpeta de trabajo: C:\Users\maria\OneDrive\Documentos\LSW\ProyectoFinal

## Lista derivada de los mensajes del equipo

| Tarea | Estado comprobado | Pendiente |
|---|---|---|
| Conectar Alpaca | Existe cliente Paper y verificación de solo lectura; broker:check informa configuración ausente | Configurar claves y propietario en servidor y verificar cuenta e histórico |
| Usar datos observados en los cores | Existe observed-ranking, contratos, procedencia y exclusiones por datos ausentes | Comprobar cobertura con la cuenta del equipo; tasa y dividendos necesitan fuentes verificables adicionales |
| Mostrar fuentes claramente | Se inicia con Alpaca y se distingue consulta, error, sin resultados y demostración | Revisión visual y conexión real |
| Adaptar estrategias | Los ciclos Wheel, PMCC, Backspread y Gamma siguen siendo simulaciones; ranking observado no equivale a ejecutar una estrategia completa | Integrar contratos y ejecución Paper de opciones con conciliación, permisos y pruebas específicas |
| Operaciones Paper | Existe servicio separado para acciones | Configuración y prueba integral; no se enviaron órdenes en esta revisión |
| Adaptar base de datos | Hay migración PostgreSQL, repositorio Supabase, sincronización y archivo Mongo | Configurar servicios, aplicar migración y verificar guardado y recuperación entre sesiones |
| Pruebas | 166 pasan, 0 fallan, 1 omitida | Mongo real omitido; conexiones externas no verificadas |

## Cambios realizados

- El explorador solicita Alpaca al iniciar; demostración sigue siendo una selección explícita.
- Barra superior: estado de fuente de velas y aviso separado de opciones en simulación local. El estado de datos no afirma que se puedan enviar órdenes.
- db:check ahora termina con fallo si falta Supabase o Mongo; ya no se interpreta una configuración ausente como validación aprobada.

## Bloqueos comprobados

broker:check: faltan claves y propietario de Alpaca en esta copia.
db:check: supabase=missing_config, mongoBridge=missing_config.
No hay archivo .env.local en la raíz de esta copia. No se copiaron ni solicitaron secretos por chat.
La configuración que el compañero afirma haber realizado puede estar en otra computadora o copia; pendiente identificarla.

## Criterios de cierre

1. Consultar cuenta Paper e histórico y registrar fecha/fuente sin revelar secretos.
2. Verificar entradas de cada core; marcar no disponible cuando falten datos.
3. Separar claramente análisis, simulación local y ejecución Paper.
4. Probar contratos, posiciones, asignaciones y cierres antes de afirmar ejecución de Wheel/PMCC en Paper.
5. Guardar y recuperar datos con Supabase y verificar archivo Mongo real.
6. Revisar interfaz y conservar evidencia de pruebas de extremo a extremo.

Esta revisión no acredita que toda la entrega esté terminada.
