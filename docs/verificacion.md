# Evidencia de verificación

Fecha: 9 de noviembre de 2026. Entorno Windows, Node 25.8.0, Chrome headless.

- `node --test tests/quant.test.ts`: 11 pruebas aprobadas, 0 fallos.
- `node node_modules/typescript/bin/tsc --noEmit`: salida 0, sin errores.
- `node <plugin-sites>/scripts/build-site.mjs`: compilación completa de Vinext/Vite; Worker y recursos cliente generados.
- Recorrido automatizado contra el Worker de producción en localhost: creación de listas de 14 empresas, ranking descendente, consulta de motivos/tasa original, cambio de estrategia, búsqueda, estado vacío, compra de call, venta de put, revisión/confirmación, filtro de ventas y persistencia tras recarga.
- Validaciones verificadas: fin operativo anterior al inicio y ausencia de núcleos impiden generar una lista.
- Vista móvil de 390 × 844: sin desbordamiento horizontal de la página. Escritorio revisado a 1440 × 1000.
- PWA de producción: manifest sin errores, página controlada por el service worker y fallback explícito de desconexión verificado con la red desactivada tanto en la página como en el worker.
- Excepciones de JavaScript en el recorrido final: 0.

El recorrido reproducible está en `scripts/verify-browser.mjs`. Requiere una instancia local sirviendo el proyecto y Chrome instalado; se puede indicar otro ejecutable mediante `CHROME_BIN`. La URL por defecto es http://127.0.0.1:5173. Para revisar producción con PowerShell:

```powershell
# Después de compilar, en una terminal:
npm start -- --port 3001

# En otra terminal:
$env:QA_URL='http://127.0.0.1:3001'
$env:QA_PWA='1'
npm run test:browser
```

Las capturas se guardan en `outputs/` (ignorado por Git). La verificación utiliza un perfil temporal aislado y no interactúa con la cuenta de bróker del usuario.

No se verificó conexión a mercados, API de órdenes, rentabilidad, estrategia multipierna ni cuenta real; esas capacidades no están implementadas en esta versión.
