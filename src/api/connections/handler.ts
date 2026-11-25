import { readSelectedDatabaseConfig, type SelectedDatabaseConfig } from '../../db/config.ts';
import { SupabaseRepository } from '../../db/supabase/client.ts';
import { MongoPrimaryRepository } from '../../db/mongodb/primary.ts';
import { readBrokerConfig } from '../brokers/config.ts';
import { privateJson } from '../http.ts';

export type ConnectionRecord = {
  id: string; title: string; category: 'database' | 'broker' | 'data';
  status: 'configured' | 'missing_config' | 'invalid_config' | 'auth_required' | 'ready' | 'error' | 'manual';
  message: string; capabilities: string[]; setup: string[];
};
type Dependencies = {
  environment(): Record<string, string | undefined>;
  owner(): Promise<{ userId: string; displayName?: string } | null>;
  load?: (config: SelectedDatabaseConfig, ownerId: string) => Promise<unknown>;
};

/** Read-only diagnostics. Configured credentials never imply a live connection. */
export function createConnectionsHandler(deps: Dependencies) {
  return async (request: Request) => {
    const owner = await deps.owner(), env = deps.environment();
    const probe = new URL(request.url).searchParams.get('probe');
    if (probe && probe !== 'supabase' && probe !== 'mongodb') return privateJson({ error: { code: 'invalid_probe', message: 'Selecciona una base de datos válida.' } }, 400);
    if (probe && !owner) return privateJson({ error: { code: 'auth_required', message: 'Inicia sesión para comprobar tu conexión a la base de datos.' } }, 401);
    const records: ConnectionRecord[] = [];
    const aiOwner=env.INTELLIGENCE_OWNER_USER_ID?.trim()||env.BROKER_OWNER_USER_ID?.trim();
    records.push({id:'openrouter',title:'OpenRouter · asistente de análisis',category:'data',
      status:!env.OPENROUTER_API_KEY?.trim()||!aiOwner?'missing_config':owner?.userId===aiOwner?'configured':'auth_required',
      message:'Chat con contexto del terminal y recomendaciones según tu perfil. La disponibilidad del modelo se comprueba al preguntar.',
      capabilities:['Preguntas de seguimiento','Explicación de riesgos','Comparación de estrategias','Recomendaciones con evidencia'],
      setup:['OPENROUTER_API_KEY en .env.local','OPENROUTER_MODEL=openrouter/free','INTELLIGENCE_OWNER_USER_ID o propietario del bróker','Reiniciar el servidor']});
    for (const provider of ['supabase', 'mongodb'] as const) {
      const configured = provider === 'supabase' ? Boolean(env.SUPABASE_URL || env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY) : Boolean(env.MONGO_BRIDGE_URL || env.MONGO_BRIDGE_TOKEN);
      const record: ConnectionRecord = { id: provider, title: provider === 'supabase' ? 'PostgreSQL / Supabase' : 'MongoDB', category: 'database',
        status: 'missing_config', message: 'Pendiente de configuración en el servidor.', capabilities: ['Listas', 'Órdenes simuladas', 'Ciclos', 'Configuración del análisis'],
        setup: provider === 'supabase' ? ['SUPABASE_URL', 'SUPABASE_SECRET_KEY (o SUPABASE_SERVICE_ROLE_KEY)'] : ['MONGO_BRIDGE_URL', 'MONGO_BRIDGE_TOKEN'] };
      if (configured) {
        try {
          const config = readSelectedDatabaseConfig(env, provider)!;
          record.status = owner ? 'configured' : 'auth_required';
          record.message = owner ? 'Configuración válida. Comprueba la lectura antes de seleccionar esta base.' : 'Inicia sesión para verificar la lectura de tus datos.';
          if (probe === provider) {
            try {
              if (deps.load) await deps.load(config, owner!.userId);
              else await ('provider' in config ? new MongoPrimaryRepository(config.connection) : new SupabaseRepository(config)).load(owner!.userId);
              record.status = 'ready'; record.message = 'Lectura de la cuenta verificada. Tus datos existentes se conservan.';
            } catch { record.status = 'error'; record.message = 'No se pudo verificar la lectura. Revisa el servicio y sus permisos.'; }
          }
        } catch { record.status = 'invalid_config'; record.message = 'La configuración está incompleta o no es válida.'; }
      }
      records.push(record);
    }
    let alpacaStatus: ConnectionRecord['status'] = 'missing_config', alpacaMessage = 'Sin credenciales de Alpaca Paper.';
    try {
      const config = readBrokerConfig(env);
      if (config) { alpacaStatus = owner?.userId === config.ownerUserId ? 'configured' : 'auth_required'; alpacaMessage = !owner ? 'Inicia sesión para verificar tu cuenta Paper.' : owner.userId === config.ownerUserId ? 'Configurado. La consulta de cuenta verifica su disponibilidad.' : 'Esta conexión pertenece a otra cuenta del terminal.'; }
    } catch { alpacaStatus = 'invalid_config'; alpacaMessage = 'Revisa la configuración de Alpaca Paper en el servidor.'; }
    records.push({ id: 'alpaca', title: 'Alpaca Paper', category: 'broker', status: alpacaStatus, message: alpacaMessage,
      capabilities: ['Acciones', 'Cadena de opciones', 'Órdenes con confirmación', 'Histórico', 'Noticias'], setup: ['ALPACA_API_KEY', 'ALPACA_SECRET_KEY', 'BROKER_OWNER_USER_ID'] });
    records.push({ id: 'webull', title: 'Webull Sandbox', category: 'broker', status: env.TRADING_RUNNER_URL && env.TRADING_RUNNER_TOKEN ? owner ? 'configured' : 'auth_required' : 'missing_config',
      message: 'El servicio de brókers verifica las credenciales y permisos de Webull.', capabilities: ['Saldos y posiciones','Órdenes pendientes e historial','Acciones y opciones','Revisión, modificación y cancelación','Histórico y cadena de pruebas'], setup: ['Servicio local de brókers', 'Credenciales Webull OpenAPI en el servicio'] });
    records.push({ id: 'sec', title: 'SEC EDGAR', category: 'data', status: env.SEC_USER_AGENT && /\S+@\S+/.test(env.SEC_USER_AGENT) ? 'configured' : 'missing_config',
      message: env.SEC_USER_AGENT ? 'La disponibilidad de estados financieros se verifica por empresa y fecha.' : 'Configura un contacto SEC para habilitar los fundamentales reales.', capabilities: ['Estados financieros', 'Márgenes', 'Solvencia'], setup: ['SEC_USER_AGENT (nombre y correo de contacto)'] });
    records.push({ id: 'fred', title: 'FRED / ALFRED', category: 'data', status: env.FRED_API_KEY ? 'configured' : 'missing_config',
      message: 'Tasa y contexto macroeconómico según fecha de publicación.', capabilities: ['Tasa libre de riesgo', 'Inflación', 'PIB'], setup: ['FRED_API_KEY'] });
    records.push({ id: 'finnhub', title: 'Finnhub · información empresarial automática', category: 'data', status: env.FINNHUB_API_KEY?.trim()&&!/[\r\n]/.test(env.FINNHUB_API_KEY) ? 'configured' : 'missing_config',
      message: 'Consulta automática de Basic Financials, Profile 2 y recomendaciones de analistas. No se confunde con los endpoints premium de propiedad institucional o precios objetivo.',capabilities:['Márgenes y rentabilidad','Múltiplos y crecimiento','Liquidez','Perfil empresarial','Recomendaciones publicadas'],setup:['Crear clave gratuita en finnhub.io/register','FINNHUB_API_KEY en el servidor; reiniciar la aplicación'] });
    records.push({ id: 'finviz', title: 'Finviz · ficha gratuita', category: 'data', status: 'manual',
      message: 'Carga valores o pega una tabla en el panel Finviz. La ficha gratuita no acredita acceso automático a la API o a exportaciones Elite.', capabilities: ['Márgenes', 'ROE y liquidez', 'Múltiplos publicados', 'Inst Own / Inst Trans'], setup: ['Panel Datos Finviz del explorador', 'Copiar métricas de la ficha gratuita o usar un CSV disponible'] });
    records.push({ id: 'institutional', title: 'Institucional · SEC 13F', category: 'data', status: env.SEC_USER_AGENT&&/\S+@\S+/.test(env.SEC_USER_AGENT)&&alpacaStatus==='configured'?'configured':'missing_config',
      message: 'Consulta automática de posiciones trimestrales de Geode y State Street, con ajustes por splits de Alpaca. Muestra parcial; sin feed de flujo intradía.', capabilities: ['Dos trimestres comparables por gestor','Fuente y publicación por reporte','Ajustes por splits','Enmiendas de reemplazo'], setup: ['SEC_USER_AGENT','Alpaca para comprobar splits','Consultar variables actuales'] });
    return privateJson({ identity: owner ? { displayName: owner.displayName ?? 'Mi cuenta', authenticated: true } : null, connections: records });
  };
}
