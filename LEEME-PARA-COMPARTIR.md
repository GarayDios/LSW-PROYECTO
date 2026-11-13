# TEPIC · Proyecto para compañeros

## Abrirlo desde cero

1. Extrae todo el ZIP; no ejecutes archivos dentro del archivo comprimido.
2. Instala **Node.js 24 LTS** desde https://nodejs.org/ (incluye npm).
3. Abre una terminal en la carpeta `tepic-terminal`, donde se encuentra `package.json`.
4. Ejecuta:

```sh
npm ci
npm run dev
```

5. Abre la dirección impresa en la terminal, normalmente http://localhost:5173.
6. Deja la terminal abierta mientras usas la aplicación. Detén el servidor con Ctrl+C.

La primera instalación requiere internet. Si PowerShell bloquea `npm.ps1`, usa `npm.cmd ci` y `npm.cmd run dev`, o ejecuta los comandos en Símbolo del sistema (CMD). Si el puerto está ocupado, usa `npm run dev -- --port 5174` y abre la URL que se imprima.

## Guía para aprender y demostrar

Abre **`docs/guias/Guia-PMCC-Call-Ratio-Desde-Cero.pdf`**. Incluye fundamentos, cantidades exactas para los formularios, ejemplos PMCC a $145 y $170, caso de pérdida, backspread a $150/$162/$170, guion de exposición y ejercicios resueltos. El HTML editable está en `docs/guias/guia-pmcc-call-ratio-desde-cero.html` y puede imprimirse con un navegador.

En el menú **Ciclos de inversión → Nuevo ciclo**, selecciona estrategia y empresa antes de modificar otros parámetros. Las selecciones cargan valores por defecto. Para replicar la guía usa NVDA, 1 contrato base, tasa 4%, volatilidad 54% y comisiones cero. La guía explica cada campo.

Para modificar el proyecto, consulta [el mapa de carpetas](docs/arquitectura/estructura-del-proyecto.md). Los cores están en `src/cores/`, las APIs y conectores en `src/api/` y cada función del terminal en `src/features/`.

## Comprobación

```sh
npm test
npm run typecheck
npm run build
node scripts/verify-learning-examples.mjs
```

Las pruebas opcionales `npm run test:browser`, `npm run test:browser -- features`, `npm run test:browser -- cycles`, `npm run test:browser -- history` y `npm run test:browser -- persistence` requieren servidor levantado y Chrome en Windows; `CHROME_BIN` permite cambiar su ruta y `QA_URL` la URL del servidor. Ejecútalas una por una, ya que usan el mismo puerto de depuración. `history` y `persistence` usan respuestas simuladas para revisar la interfaz sin claves ni proyectos remotos.

## Qué incluye y qué no

- Incluye el código actualizado, dependencias fijadas en `package-lock.json`, pruebas y documentación.
- Incluye PMCC, Call Ratio Backspread 1:2, Wheel y Gamma Scalping de práctica; siete cores, gráfico de velas sintéticas y comparador de empresas.
- No incluye `node_modules`, Git, builds, cachés, credenciales, estados de Wrangler ni perfiles del navegador.
- El ZIP usa una configuración de hosting local genérica; no otorga acceso al proyecto de despliegue del autor.
- Sin configuración remota, listas, órdenes y ciclos se guardan en el navegador de cada persona y no se transfieren con el ZIP. La integración opcional de Supabase y MongoDB se configura siguiendo [esta guía](docs/base-de-datos/configuracion.md); las credenciales y los datos de una cuenta no se incluyen en el ZIP.
- Los ciclos F5 siguen siendo simulaciones. El modo Alpaca usa velas y contratos reales para el análisis y el ranking, con procedencia y exclusiones si faltan datos. Hay comparación temporal de reglas accionarias, seguimiento Paper, salidas por reglas o bracket GTC, pausa de entradas y riesgo de cuenta. No se ejecutan opciones ni dinero real. Consulta [el estado y los pendientes](docs/cambios/ciclo-operativo-y-datos.md) y [riesgo y ejecución](docs/integraciones/riesgo-y-ejecucion.md).

`npm run dev` es la vía de ejecución local para esta entrega. El script `npm start` del proyecto está relacionado con despliegue Cloudflare y no es necesario para esta demostración.

**Material educativo, no asesoría financiera. Las opciones pueden causar pérdidas sustanciales.**
