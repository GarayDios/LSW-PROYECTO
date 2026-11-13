# APIs e integraciones

- `auth/chatgpt-auth.ts`: identidad del visitante y rutas de inicio y cierre de sesión con ChatGPT.
- `connectors/client.ts`: punto de entrada para obtener conectores ligados a la petición actual (`connectorsForRequest`).
- `connectors/contract.mts`: contrato de invocación, validación y resultados de los conectores.
- `connectors/context.ts`: contexto aislado por petición; `worker/index.ts` lo establece al recibir cada solicitud.
- `connectors/errors.mts` y `connectors/connector-error.tsx`: errores y su presentación en la interfaz.
- `connectors/preview.d.ts`: tipos del entorno de vista previa.
- `persistence/handler.ts`: lectura y guardado autenticados del estado, validación, control de revisión y entrega de archivos históricos. La ruta pública está en `app/api/persistence/route.ts` (`GET` y `PUT`).
- `brokers/alpaca/client.ts`: cuenta, activos, calendario, cotización y órdenes de acciones con host Alpaca Paper fijo.
- `market/alpaca-history.ts`: paginación, ajustes por splits, fechas de Nueva York, sesiones y normalización OHLCV.
- `trading/handlers.ts`: permisos del propietario para el histórico real y la cuenta; proxy autenticado del servicio de automatización.

`/api/persistence` conserva las listas, órdenes simuladas, ciclos y tasa por usuario cuando Supabase está configurado. El propietario procede de la identidad autenticada del servidor; el cuerpo de la solicitud no puede seleccionarlo. Sin configuración, la consulta devuelve modo local. Los detalles de datos, permisos y concurrencia están en `docs/arquitectura/base-de-datos.md`.

La integración con Alpaca Paper requiere sus claves exclusivas del servidor y `BROKER_OWNER_USER_ID`. Los visitantes restantes no pueden usar esa cuenta compartida. `GET /api/broker/status` indica configuración y el ID de la identidad actual; no devuelve claves. Las rutas de mercado son `/api/market/history` y `/api/market/company`; `/api/broker/account` consulta la cuenta Paper y `/api/automation` controla planes a través del servicio independiente.

Las simulaciones de opciones siguen separadas. Los datos de muestra están en `src/features/market/data.ts`; los cálculos locales están en `src/cores/`. Las rutas HTTP siguen las convenciones de `app/`.

Los archivos `.mts` se importan con extensión `.mjs`, como espera la resolución de módulos ESM de TypeScript.
