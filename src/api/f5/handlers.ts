import { z } from 'zod';
import { readBrokerConfig, BrokerConfigError } from '../brokers/config.ts';
import { ApiError, privateJson, sameOrigin, smallJson } from '../http.ts';

type Environment = Record<string, string | undefined>;
type Dependencies = { environment(): Environment; owner(): Promise<{ userId: string } | null>; fetcher?: typeof fetch; provider?:'alpaca'|'webull' };
const mutation = z.discriminatedUnion('action', [
  z.object({ action: z.literal('preview'), request: z.record(z.unknown()) }).strict(),
  z.object({ action: z.literal('submit'), previewId: z.string().uuid() }).strict(),
  z.object({ action: z.literal('cancel'), operationId: z.string().uuid() }).strict(),
  z.object({ action: z.literal('control'), request: z.record(z.unknown()) }).strict(),
]);

function runnerConfig(environment: Environment) {
  const rawUrl = environment.TRADING_RUNNER_URL?.trim(), token = environment.TRADING_RUNNER_TOKEN?.trim();
  if (!rawUrl || !token) throw new ApiError('f5_runner_missing', 'Configura TRADING_RUNNER_URL y TRADING_RUNNER_TOKEN e inicia npm run trading:serve para conectar F5 con Alpaca Paper.', 503);
  let url: URL;
  try { url = new URL(rawUrl); } catch { throw new ApiError('f5_runner_invalid', 'La dirección del servicio F5 no es válida.', 503); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash ||
    url.protocol !== 'https:' && !(local && url.protocol === 'http:') || token.length < 32 || token.length > 512 || /[\r\n]/.test(token)) {
    throw new ApiError('f5_runner_invalid', 'El servicio F5 requiere HTTPS o una dirección local y un token privado válido.', 503);
  }
  return { url: url.origin, token };
}

function failure(error: unknown): Response {
  if (error instanceof ApiError || error instanceof BrokerConfigError) return privateJson({ error: { code: error.code, message: error.message } }, error.status);
  return privateJson({ error: { code: 'f5_unavailable', message: 'No se pudo confirmar la respuesta de F5. Actualiza el estado antes de preparar otra orden.' } }, 503);
}

/** The request identity, never browser input, chooses the account and ledger owner. */
export function createF5Handlers(dependencies: Dependencies) {
  const fetcher = dependencies.fetcher ?? fetch;
  const webull=dependencies.provider==='webull',label=webull?'Webull Sandbox':'Alpaca Paper',enableKey=webull?'WEBULL_MANUAL_ENABLED':'ALPACA_F5_ENABLED';
  async function authorize() {
    const owner = await dependencies.owner();
    if (!owner) throw new ApiError('auth_required', `Inicia sesión para consultar y operar opciones en ${label}.`, 401);
    const environment = dependencies.environment(), config = webull?{ownerUserId:environment.BROKER_OWNER_USER_ID}:readBrokerConfig(environment);
    if (!config) throw new ApiError('f5_broker_missing', `Configura las claves de ${label} y BROKER_OWNER_USER_ID en el servidor.`, 503);
    if (owner.userId !== config.ownerUserId) throw new ApiError('broker_owner_required', 'Esta cuenta Paper pertenece a otro usuario del terminal.', 403);
    return { owner, environment, runner: runnerConfig(environment) };
  }
  async function forward(context: Awaited<ReturnType<typeof authorize>>, path: string, body?: Record<string, unknown>) {
    const url = new URL((webull?'/webull/f5/':'/f5/') + path, context.runner.url);
    if (!body) url.searchParams.set('ownerId', context.owner.userId);
    let response: Response;
    try {
      response = await fetcher(url.href, {
        method: body ? 'POST' : 'GET',
        headers: { Authorization: `Bearer ${context.runner.token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify({ ...body, ownerId: context.owner.userId }) } : {}),
        signal: AbortSignal.timeout(90000), redirect: 'manual', cache: 'no-store',
      });
    } catch {
      throw new ApiError('f5_response_uncertain', 'El servicio F5 no confirmó la respuesta. Actualiza el estado; no vuelvas a enviar la misma operación a ciegas.', 503);
    }
    const value: unknown = await response.json().catch(() => null);
    if (response.status >= 300 && response.status < 400 || !value || typeof value !== 'object') throw new ApiError('f5_invalid_response', 'El servicio F5 devolvió una respuesta inválida. Actualiza el estado para conciliar las órdenes.', 503);
    if (!response.ok) {
      const status = [400, 401, 403, 404, 409, 410, 413, 415, 422, 429].includes(response.status) ? response.status : 503;
      // Only known public codes cross this boundary; upstream diagnostics stay private.
      const raw = (value as { error?: { code?: unknown } }).error;
      const code = typeof raw?.code === 'string' ? raw.code : '';
      const messages: Record<string, string> = {
        f5_disabled: 'Activa ALPACA_F5_ENABLED=true en el terminal y en el servicio para permitir el envío a Alpaca Paper.',
        f5_preview_expired: 'La revisión venció. Vuelve a revisar los contratos y el precio antes de confirmar.',
        f5_market_closed: 'El mercado está cerrado. Puedes consultar posiciones y preparar la próxima revisión.',
        f5_insufficient_funds: 'El efectivo o poder de compra disponible no cubre esta operación.',
        f5_insufficient_position: 'La cuenta no tiene suficientes contratos o acciones disponibles para esta operación.',
        f5_options_level: 'La cuenta no tiene el nivel de permisos de opciones que exige la estrategia.',
        f5_conflicting_orders: 'Hay órdenes pendientes que afectan esta operación. Actualiza y concílialas antes de continuar.',
        f5_quote_stale: 'La cotización falta o está desactualizada. Actualiza los contratos antes de revisar.',
        broker_order_ambiguous: 'Alpaca no confirmó la orden. Actualiza su estado para conciliarla; evita enviarla de nuevo.',
        broker_credentials_invalid: 'Alpaca rechazó las credenciales configuradas en el servidor.',
        broker_access_denied: 'Alpaca rechazó el acceso. Revisa los permisos de opciones y datos de la cuenta Paper.',
        broker_order_rejected: 'Alpaca rechazó la orden. Revisa los contratos, el precio, los permisos y las garantías.',
        broker_contract_invalid: 'El contrato no es una opción americana estándar vigente y negociable.',
        broker_asset_not_tradable: 'La empresa o el contrato no están habilitados para negociar en esta cuenta Paper.',
        broker_rate_limited: 'Alpaca limitó las consultas. Espera antes de actualizar de nuevo.',
        broker_response_invalid: 'Alpaca no devolvió todos los datos necesarios para verificar la operación.',
        broker_order_conflict: 'La referencia corresponde a una orden diferente. Concíliala antes de continuar.',
        f5_not_configured: 'Configura las claves de Alpaca Paper en el servicio F5.',
        f5_account_blocked: 'La cuenta Paper no está activa o está bloqueada para operar.',
        f5_account_uncertain: 'No se pudo verificar el capital de la cuenta Paper.',
        f5_options_permission: 'La cuenta necesita nivel 1 para Wheel o nivel 3 para las combinaciones multipierna.',
        f5_quote_unavailable: 'Falta una cotización válida y reciente. Actualiza los contratos durante la sesión.',
        f5_pending_broker_orders: 'Hay órdenes pendientes en la cuenta Paper. Concílialas o cancélalas antes de preparar otra operación F5.',
        f5_pending_operations: 'Hay operaciones F5 pendientes o sin confirmar. Actualiza el estado antes de preparar otra.',
        f5_invalid_limit: 'Usa un límite positivo para Wheel, PMCC y Gamma. Backspread admite débito positivo o crédito negativo.',
        f5_uncovered_call: 'La call Wheel requiere 100 acciones disponibles por contrato, sin comprometer acciones de otras calls ni planes.',
        f5_existing_underlying_cycle: 'Ya hay una apertura F5 o posiciones de opciones para esta empresa. Revisa su cierre, vencimiento o asignación.',
        f5_open_not_filled: 'Alpaca debe confirmar la ejecución completa de la apertura antes del cierre o la cobertura.',
        f5_child_operation_exists: 'El ciclo ya tiene un cierre o una cobertura pendiente, parcial o ejecutada. Revisa el historial.',
        f5_hedge_not_flat: 'Cierra las acciones de cobertura atribuidas a Gamma antes de cerrar sus opciones.',
        f5_contract_unavailable: 'El contrato ya no está disponible para este cierre. Revisa su estado en Alpaca.',
        f5_position_missing: 'Las posiciones cambiaron, vencieron o fueron asignadas. El cierre no coincide con posiciones disponibles.',
        f5_hedge_strategy: 'La cobertura en acciones requiere una apertura Gamma completamente ejecutada.',
        f5_short_hedge_disabled: 'La cobertura solo permite comprar acciones o vender acciones compradas por este ciclo, sin ventas en corto.',
        f5_hedge_position_missing: 'No hay suficientes acciones de cobertura confirmadas y disponibles en Alpaca.',
        f5_hedge_uncertain: 'No se pudo verificar la cobertura en acciones del ciclo. Actualiza su estado.',
        f5_delta_unavailable: 'No hay una delta observada vigente para revisar la cobertura Gamma.',
        f5_hedge_increases_delta: 'La cantidad y dirección elegidas aumentan la delta neta. Revisa las griegas actuales.',
        f5_budget_exceeded: 'La garantía o reserva necesaria supera tu capital máximo. Revisa el strike, las unidades y el presupuesto.',
        f5_request_busy: 'La cuenta está procesando otra solicitud. Actualiza su estado antes de continuar.',
        f5_operation_not_found: 'La operación no existe en esta cuenta.',
        f5_review_changed: 'Las condiciones cambiaron. Prepara otra revisión antes de confirmar.',
        f5_preview_consumed: 'Esta revisión ya tuvo un intento de envío. Actualiza y concilia su referencia.',
        f5_cannot_cancel: 'No hay una orden pendiente confirmada para cancelar. Actualiza su estado.',
        f5_request_invalid: 'Los contratos o parámetros no forman la estrategia seleccionada. Revisa tipo, vencimiento, strike, unidades y presupuesto.',
        f5_existing_option_position: 'Ya existen opciones para esta empresa en la cuenta. Revisa esas posiciones antes de iniciar otra estrategia F5.',
        f5_share_reservation_uncertain: 'No se pudo verificar qué acciones están reservadas por otros planes. Actualiza la cuenta.',
        f5_order_fill_uncertain: 'La cantidad ejecutada que devolvió Alpaca no se pudo verificar. Concilia la orden antes de continuar.',
        f5_order_identity_uncertain: 'La orden recibida no coincide con la referencia y los parámetros revisados. Verifica Alpaca.',
        f5_order_legs_uncertain: 'Alpaca no confirmó todas las piernas de la orden combinada. Actualiza el estado para conciliarla.',
        webull_atomic_roll_unavailable:'Webull no confirmó un roll atómico con intenciones de apertura y cierre. Gestiona la call corta desde la mesa de órdenes y revisa la nueva apertura por separado.',
        broker_endpoint_unavailable:'Este endpoint no está disponible en el sandbox configurado. La sección mantiene sus datos pendientes.',
      };
      const message=messages[code]??'F5 rechazó la solicitud. Revisa los contratos, las cantidades, el límite de capital y el estado de las órdenes.';
      throw new ApiError(code in messages ? code : 'f5_request_rejected',webull?message.replaceAll('Alpaca Paper',label).replaceAll('Alpaca','Webull').replaceAll('ALPACA_F5_ENABLED',enableKey):message,status);
    }
    if (path === 'status') return privateJson({ ...value, enabled: (value as { enabled?: boolean }).enabled === true && context.environment[enableKey] === 'true' }, response.status);
    return privateJson(value, response.status);
  }
  return {
    async get(request: Request) {
      try {
        const context = await authorize(), query = new URL(request.url).searchParams;
        const resource = query.get('resource') ?? 'status';
        if (!['status', 'contracts', 'control', 'report'].includes(resource)) throw new ApiError('f5_invalid_resource', 'La consulta F5 no es válida.');
        if (resource !== 'contracts') return await forward(context, resource);
        const underlying = query.get('underlying') ?? '', expiry = query.get('expiry');
        if (!/^[A-Z][A-Z0-9.-]{0,14}$/.test(underlying) || expiry !== null && !/^\d{4}-\d{2}-\d{2}$/.test(expiry)) throw new ApiError('f5_invalid_contract_query', 'Selecciona una empresa y un vencimiento válidos.');
        const path = 'contracts?' + new URLSearchParams({ underlying, ...(expiry ? { expiry } : {}) });
        return await forward(context, path);
      } catch (error) { return failure(error); }
    },
    async post(request: Request) {
      try {
        sameOrigin(request);
        const context = await authorize(), parsed = mutation.safeParse(await smallJson(request));
        if (!parsed.success) throw new ApiError('f5_invalid_action', 'Revisa los datos de la operación F5.');
        const action = parsed.data;
        if ((action.action==='submit'||webull&&action.action==='cancel') && context.environment[enableKey] !== 'true') throw new ApiError('f5_disabled', `Activa ${enableKey}=true en el terminal y el servicio para enviar a ${label}.`, 409);
        if (action.action === 'control') {
          if(['enable-plan','tick'].includes(String(action.request.action)))throw new ApiError('manual_orders_only','El terminal usa órdenes manuales. Prepara y confirma cada operación por separado.',409);
          if (['enable-plan', 'tick'].includes(String(action.request.action)) &&
            (context.environment.ALPACA_F5_ENABLED !== 'true' || context.environment.ALPACA_F5_AUTOMATION_ENABLED !== 'true')) {
            throw new ApiError('f5_automation_disabled', 'Habilita ALPACA_F5_ENABLED y ALPACA_F5_AUTOMATION_ENABLED en el terminal y el servicio antes de activar un plan F5.', 409);
          }
          return await forward(context, 'control', action.request);
        }
        if (action.action === 'preview') return await forward(context, 'preview', action.request);
        if (action.action === 'submit') return await forward(context, 'submit', { previewId: action.previewId });
        return await forward(context, 'cancel', { operationId: action.operationId });
      } catch (error) { return failure(error); }
    },
  };
}
