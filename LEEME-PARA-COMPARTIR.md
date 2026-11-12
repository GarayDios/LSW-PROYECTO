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

Abre **`docs/Guia-PMCC-Call-Ratio-Desde-Cero.pdf`**. Incluye fundamentos, cantidades exactas para los formularios, ejemplos PMCC a $145 y $170, caso de pérdida, backspread a $150/$162/$170, guion de exposición y ejercicios resueltos. El HTML editable está en `docs/guia-pmcc-call-ratio-desde-cero.html` y puede imprimirse con un navegador.

En el menú **Ciclos de inversión → Nuevo ciclo**, selecciona estrategia y empresa antes de modificar otros parámetros. Las selecciones cargan valores por defecto. Para replicar la guía usa NVDA, 1 contrato base, tasa 4%, volatilidad 54% y comisiones cero. La guía explica cada campo.

## Comprobación

```sh
npm test
npm run typecheck
npm run build
node scripts/verify-learning-examples.mjs
```

Las pruebas opcionales `npm run test:browser`, `npm run test:browser -- features` y `npm run test:browser -- cycles` requieren servidor levantado y Chrome en Windows; `CHROME_BIN` permite cambiar su ruta y `QA_URL` la URL del servidor. Ejecútalas una por una, ya que usan el mismo puerto de depuración.

## Qué incluye y qué no

- Incluye el código actualizado, dependencias fijadas en `package-lock.json`, pruebas y documentación.
- Incluye PMCC, Call Ratio Backspread 1:2, Wheel y Gamma Scalping de práctica; siete cores, gráfico de velas sintéticas y comparador de empresas.
- No incluye `node_modules`, Git, builds, cachés, credenciales, estados de Wrangler ni perfiles del navegador.
- El ZIP usa una configuración de hosting local genérica; no otorga acceso al proyecto de despliegue del autor.
- **Listas, órdenes y ciclos se guardan en el navegador de cada persona.** No se transfieren con el ZIP ni se sincronizan entre compañeros.
- Datos simulados y precios elegidos manualmente. No envía órdenes reales ni contiene conexión a bróker, backtesting o cálculo de margen real.

`npm run dev` es la vía de ejecución local para esta entrega. El script `npm start` del proyecto está relacionado con despliegue Cloudflare y no es necesario para esta demostración.

**Material educativo, no asesoría financiera. Las opciones pueden causar pérdidas sustanciales.**
