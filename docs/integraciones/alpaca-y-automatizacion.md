# Histórico real, Alpaca Paper y automatización

La aplicación separa el análisis histórico del envío de órdenes. Puedes explorar gráficos y señales en modo demostración sin cuenta externa. El histórico real y las órdenes paper requieren claves de Alpaca en el servidor. La automatización utiliza un servicio Node independiente, con planes explícitos y un registro persistente de evaluaciones.

La ampliación actual incluye seguimiento de fills y posiciones propias, salidas optativas por reglas o bracket GTC, pausa de entradas y límites agregados. La especificación vigente está en [riesgo y ejecución](riesgo-y-ejecucion.md) y [servicio continuo](servicio-continuo.md).

Los retornos del análisis corresponden al precio ajustado por splits, con comisiones y deslizamiento configurados; no incluyen dividendos, impuestos ni financiación. La caída máxima se calcula sobre la curva de patrimonio al cierre de cada vela. Las reglas se mantienen fijas: el contexto inicial no representa un modelo de aprendizaje entrenado.

## 1. Crear la cuenta de práctica

1. Abre el [panel de Alpaca](https://app.alpaca.markets/) y crea una cuenta Paper Only si todavía no tienes una. La [documentación oficial](https://docs.alpaca.markets/us/docs/paper-trading) permite crear esta cuenta con correo desde distintos países.
2. Comprueba que estás en el entorno **Paper** y genera sus claves de API. Las claves de práctica y las de una cuenta real son diferentes.
3. Conserva los valores en tu gestor de secretos o en los archivos de entorno locales ignorados por Git. No los escribas en el código, capturas de la exposición ni variables con prefijo `NEXT_PUBLIC_` o `VITE_`.

El cliente utiliza dos hosts fijos: `https://data.alpaca.markets` para los datos y `https://paper-api.alpaca.markets` para la cuenta y las órdenes de práctica. No hay un selector de operaciones con dinero real ni una URL de bróker elegida por el navegador.

## 2. Configurar el terminal

Usa Node.js 22.18 o posterior y ejecuta `npm ci` desde la raíz. Si todavía no existe `.env.local`, copia [`.env.example`](../../.env.example) y completa los valores de Alpaca:

```dotenv
ALPACA_API_KEY=TU_CLAVE_DE_PRACTICA
ALPACA_SECRET_KEY=TU_SECRETO_DE_PRACTICA
BROKER_OWNER_USER_ID=ID_DEL_USUARIO_AUTENTICADO_AUTORIZADO
ALPACA_DATA_FEED=iex

# Mantener desactivado hasta revisar y configurar el servicio independiente.
ALPACA_AUTOMATION_ENABLED=false
TRADING_RUNNER_URL=
TRADING_RUNNER_TOKEN=
```

`BROKER_OWNER_USER_ID` identifica a la persona autorizada por la autenticación del servidor. No es el correo, el número de cuenta de Alpaca ni un ID proporcionado por el cuerpo de una solicitud. La cuenta de práctica configurada en el servidor no queda disponible para operar desde cualquier visitante del sitio.

Para una prueba local, el servidor de desarrollo ya utiliza la identidad simulada `local_seedy`; puedes usar ese valor en tu configuración de desarrollo. En producción se necesita el ID auténtico del usuario del sitio. La identidad simulada es solo para desarrollo: mantén ese servidor accesible desde tu equipo.

Reinicia el terminal después de cambiar las variables:

```sh
npm run dev
```

Las variables de Supabase y MongoDB son independientes y siguen la [guía de persistencia](../base-de-datos/configuracion.md). Una integración de base de datos configurada no aporta por sí sola claves ni permisos del bróker.

Para comprobar las claves guardadas en `.env.local` sin mostrarlas, ejecuta `npm run broker:check`. El comando consulta el estado de la cuenta Paper y un rango de tres años de velas diarias de AAPL. Informa la cobertura recibida sin imprimir claves ni saldos y no envía órdenes.

## 3. Consultar tres años de velas reales

Selecciona Alpaca como fuente y elige un símbolo, rango y temporalidad. Usa velas diarias con los botones `3A` o `5A` para revisar varios años. El panel muestra la cobertura efectiva recibida. Nombre, bolsa, clase y negociabilidad proceden del activo; los campos de demostración del ranking no se presentan como fundamentales de una empresa.

Alpaca publica histórico desde 2016 en su [plan Basic](https://docs.alpaca.markets/us/v1.1/docs/about-market-data-api). El feed `iex` cubre una bolsa y su volumen no representa todo el mercado. El acceso `sip` depende de los permisos de la cuenta; cambiar el texto de la variable no concede una suscripción. Para una empresa que comenzó a cotizar hace menos tiempo, el rango solicitado puede superar los datos disponibles.

El [adaptador](../../src/api/market/alpaca-history.ts) consulta todas las páginas del proveedor, ordena las barras, elimina duplicados y aplica `adjustment=split`. Mantiene las fechas de Nueva York y consulta el calendario real en los intervalos intradía, incluidos festivos y cierres anticipados. Las velas de una hora se construyen a partir de barras de treinta minutos de sesión regular. No se rellenan huecos con cotizaciones inventadas.

| Temporalidad | Rango máximo de una consulta |
|---|---|
| 5 minutos | 31 días |
| 15 minutos | 93 días |
| 1 hora | 366 días |
| 1 día | 3,660 días |

Se excluyen los últimos 16 minutos y la vela diaria del día en curso. Las señales diarias se calculan sobre cierres ya observados; la fecha futura de un plan no solicita velas del futuro. Los errores de permisos, límites o conexión se muestran explícitamente y no se sustituyen por una serie de demostración. Los [parámetros y la paginación oficiales](https://docs.alpaca.markets/us/reference/stockbarsingle-1) explican `start`, `end`, `timeframe`, `feed`, `adjustment` y `next_page_token`.

## 4. Interpretar las señales y el resultado histórico

La [regla implementada](../../src/features/analysis/signals.ts) usa SMA20/SMA50 y RSI14:

- Entrada: la media de veinte cierres cruza por encima de la de cincuenta y RSI14 no supera 70.
- Salida histórica: la media de veinte cruza por debajo de la de cincuenta.
- Espera: no aparece un cruce nuevo válido o falta información suficiente.

El cálculo de una señal usa solo las velas conocidas hasta su cierre. La prueba reserva el tramo final del rango —aproximadamente el 30%— para medir su comportamiento temporal, mientras las reglas permanecen fijas. El 70% inicial aporta contexto; no se presenta como entrenamiento de un modelo de inteligencia artificial.

Una señal calculada al cierre se prueba en la **apertura de la siguiente vela**, con comisión y deslizamiento configurados. El panel muestra retorno, caída máxima, operaciones cerradas y comparación con comprar y mantener. Si no hay compras y ventas cerradas, esa ausencia también forma parte del resultado.

Las marcas explican qué habrían hecho las reglas con esos datos. No identifican de antemano el mejor precio futuro ni garantizan que invertir en la siguiente señal produzca ganancias. La automatización descrita abajo solo utiliza la señal de compra; las salidas del backtest no son cierres automáticos de tu cuenta.

## 5. Preparar el servicio independiente

Crea `.env.trading.local` en la raíz; este archivo queda fuera de Git:

```dotenv
ALPACA_API_KEY=LA_MISMA_CLAVE_DE_PRACTICA
ALPACA_SECRET_KEY=EL_MISMO_SECRETO_DE_PRACTICA
BROKER_OWNER_USER_ID=EL_MISMO_PROPIETARIO_AUTORIZADO
ALPACA_DATA_FEED=iex
ALPACA_AUTOMATION_ENABLED=false
TRADING_RUNNER_TOKEN=UN_SECRETO_ALEATORIO_COMPARTIDO
TRADING_RUNNER_DB=.sites-runtime/trading-runner.sqlite
TRADING_RUNNER_HOST=127.0.0.1
TRADING_RUNNER_PORT=8790
```

Genera el token localmente, por ejemplo:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

El token autoriza únicamente la comunicación entre el servidor del terminal y el servicio; no es una clave que se entrega al navegador. Usa el mismo token en ambos archivos. En `.env.local`, completa:

```dotenv
TRADING_RUNNER_URL=http://127.0.0.1:8790
TRADING_RUNNER_TOKEN=EL_MISMO_TOKEN_DEL_SERVICIO
```

Inicia el proceso en otra terminal:

```sh
npm run trading:serve
```

El servicio conserva planes, eventos y reservas de ejecución en SQLite. Ese archivo pertenece al proceso de ejecución, separado del estado general del terminal en Supabase y de las instantáneas de MongoDB. No almacena las claves del bróker dentro de la base.

## 6. Revisar y activar un plan

1. Conecta el terminal y comprueba el estado de la cuenta Paper y del servicio. Mantén desactivadas ambas variables `ALPACA_AUTOMATION_ENABLED` durante la revisión inicial.
2. Crea un plan para el símbolo elegido, con tres o cinco años de contexto, fecha inicial/final, máximo por orden y máximo por posición. Un plan nuevo se crea **desactivado**.
3. Revisa las fechas y el presupuesto. El servicio aplica también su límite global; la cantidad final usa el menor límite y acciones completas.
4. Cuando quieras habilitar esta prueba, cambia `ALPACA_AUTOMATION_ENABLED=true` en el servidor del terminal **y** en el servicio, reinicia ambos y activa explícitamente el plan desde la interfaz.
5. Consulta el registro de eventos y el panel Paper de Alpaca. Una orden `submitted` significa enviada, no una ejecución confirmada al precio deseado.
6. Para detener nuevas entradas, desactiva el plan. También puedes detener el proceso o cambiar `ALPACA_AUTOMATION_ENABLED=false` **en el servicio de ejecución y reiniciarlo**. La variable del servidor del terminal bloquea nuevas activaciones desde la interfaz; no sustituye al interruptor del proceso independiente. Una evaluación en curso puede estar reservada o enviada: revisa su registro. Las órdenes enviadas y las posiciones existentes se gestionan por separado; desactivar no equivale a cancelarlas o venderlas.

El servicio vuelve a evaluar mientras esté encendido. Puede esperar por fechas futuras, mercado cerrado o ausencia de señal. Bloquea cotizaciones de más de sesenta segundos, diferenciales demasiado amplios, falta de efectivo y símbolos con una posición u orden abierta. Una posición manual no se amplía ni se liquida automáticamente.

La ejecución actual compra acciones completas mediante órdenes límite `day` en Alpaca Paper. No envía opciones Wheel/PMCC/Backspread/Gamma, no vende en corto ni implementa cierres automáticos. Los [tipos de orden y contratos de Alpaca](https://docs.alpaca.markets/us/reference/postorder) son diferentes para acciones y opciones; la simulación educativa F5 no sustituye esos contratos ni sus permisos.

Cada señal utiliza un `client_order_id` estable y una reserva duradera. Si una respuesta es ambigua, el servicio consulta ese identificador antes de cualquier reintento y conserva el evento para revisión. No envía de nuevo una orden simplemente porque no obtuvo su respuesta. [Consulta por identificador de cliente](https://docs.alpaca.markets/us/reference/getorderbyclientorderid).

## 7. Operación fuera del equipo local

El proceso Node debe alojarse por separado de Sites, detrás de HTTPS y con un volumen duradero para `TRADING_RUNNER_DB`. Configura las variables de cada servidor en su alojamiento; no las publiques en `.openai/hosting.json`. Utiliza una sola instancia responsable del archivo o una solución de almacenamiento compartido adecuada antes de escalarlo.

Cerrar el navegador no apaga un servicio remoto; apagar el equipo sí detiene un servicio que solo se ejecuta allí. Esta versión no crea automáticamente un servidor remoto ni una tarea de nube. Tampoco convierte una señal del backtest en una compra retroactiva.

Los eventos y las reservas permiten evitar duplicados después de un reinicio, siempre que se conserve el archivo SQLite. Respáldalo y no lo sustituyas por una base vacía para forzar una nueva entrada.

## 8. Verificar sin afirmar una conexión inexistente

```sh
npm test
npm run typecheck
npm run build
```

Las pruebas locales comprueban formatos, reglas, permisos, límites, errores de red, conciliación de órdenes y persistencia con respuestas de prueba. Para verificar la conexión real, configura tu cuenta Paper y comprueba la consulta de cuenta, la cobertura histórica recibida y, solo tras activar un plan de práctica, el registro correspondiente del bróker. Sin esas credenciales no se afirma que una consulta o una orden haya llegado a Alpaca.

## Webull

Webull dispone de [OpenAPI oficial en México](https://developer.webull.com.mx/apis/docs/) y documenta entornos de prueba en sus recursos oficiales. La disponibilidad de acciones, opciones, datos y autenticación depende de región y cuenta. Esta versión integra Alpaca Paper como cliente ejecutable y deja [documentados los requisitos de Webull](../../src/api/brokers/webull/README.md); no anuncia una conexión Webull activa ni utiliza endpoints internos de la aplicación móvil.
