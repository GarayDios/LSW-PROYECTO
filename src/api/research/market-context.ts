import { missingVariable, type ResearchVariable, type CompanyResearch } from '../../features/research/model.ts';
import { numeric,record,researchJson,timestamp,providerFailure,type ResearchFetch } from './http.ts';
import type { AlpacaResearchConfig } from './alpaca.ts';

export async function fetchMarketContext(config:AlpacaResearchConfig|undefined,symbol:string,asOf:string,fetcher:ResearchFetch=fetch,now=new Date()):Promise<{spot:ResearchVariable;dividends:NonNullable<CompanyResearch['cashDividends']>;annualDividend:ResearchVariable}> {
  const absent=missingVariable('Alpaca cotización del subyacente','Sin cotización actual verificable.');
  const empty:NonNullable<CompanyResearch['cashDividends']>={events:[],complete:false,status:{source:'Alpaca dividendos declarados',status:'unavailable',message:'No se reconstruyen declaraciones históricas con la consulta actual.'},warnings:[]};
  let annualDividend=missingVariable('Alpaca dividendos de doce meses','Sin historial completo recibido para estimar dividendos.');
  if(!config || Date.parse(asOf)<now.getTime())return {spot:absent,dividends:empty,annualDividend};
  const headers={'APCA-API-KEY-ID':config.apiKey,'APCA-API-SECRET-KEY':config.secretKey};
  const quoteUrl=new URL(`https://data.alpaca.markets/v2/stocks/${encodeURIComponent(symbol)}/quotes/latest`);
  quoteUrl.searchParams.set('feed',config.stockFeed??'iex');
  const dividendUrl=new URL('https://data.alpaca.markets/v1/corporate-actions');
  Object.entries({symbols:symbol,types:'cash_dividend,forward_split,reverse_split',start:new Date(now.getTime()-366*86400000).toISOString().slice(0,10),end:new Date(now.getTime()+365*86400000).toISOString().slice(0,10),data_quality:'all',limit:'1000'}).forEach(([k,v])=>dividendUrl.searchParams.set(k,v));
  const results=await Promise.allSettled([researchJson(quoteUrl,headers,fetcher),researchJson(dividendUrl,headers,fetcher)]);
  let spot=absent;
  if(results[0].status==='fulfilled'){
    const quote=record(record(results[0].value).quote),bid=numeric(quote.bp),ask=numeric(quote.ap),at=timestamp(quote.t);
    if(bid!==null&&ask!==null&&bid>0&&ask>=bid&&at&&Date.parse(at)<=Date.parse(asOf)&&now.getTime()-Date.parse(at)<=3600000)
      spot={value:(bid+ask)/2,kind:'estimated',source:`Alpaca ${config.stockFeed??'iex'} · punto medio de cotización de la acción`,observedAt:at,availableAt:now.toISOString(),reason:'Punto medio bid/ask; no es precio de ejecución.'};
  }
  let dividends=empty;
  if(results[1].status==='fulfilled'){
    const body=record(results[1].value),actions=record(body.corporate_actions),raw=actions.cash_dividends??(body.corporate_actions&&typeof body.corporate_actions==='object'&&!Array.isArray(body.corporate_actions)?[]:null);
    if(Array.isArray(raw)){
      const today=now.toISOString().slice(0,10),start=new Date(now.getTime()-365*86400000).toISOString().slice(0,10);
      const history=raw.map(record).filter(row=>row.symbol===symbol&&typeof row.ex_date==='string'&&row.ex_date>=start&&row.ex_date<=today);
      const splits=[...(Array.isArray(actions.forward_splits)?actions.forward_splits:[]),...(Array.isArray(actions.reverse_splits)?actions.reverse_splits:[])];
      const valid=history.every(row=>typeof row.id==='string'&&numeric(row.rate)!==null&&numeric(row.rate)!>=0&&row.foreign===false&&row.special===false&&/^\d{4}-\d{2}-\d{2}$/.test(String(row.ex_date))&&Number.isFinite(Date.parse(String(row.ex_date)))&&new Date(String(row.ex_date)).toISOString().slice(0,10)===row.ex_date&&(row.currency===undefined||row.currency==='USD'));
      const unidentified=raw.some(item=>{const row=record(item);return row.symbol!==symbol||typeof row.ex_date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(row.ex_date)||!Number.isFinite(Date.parse(row.ex_date))||new Date(row.ex_date).toISOString().slice(0,10)!==row.ex_date;});
      const uniqueHistory=new Map(history.map(row=>[String(row.id),row]));
      const conflicting=history.some(row=>numeric(row.rate)!==numeric(uniqueHistory.get(String(row.id))?.rate)||row.ex_date!==uniqueHistory.get(String(row.id))?.ex_date);
      // With no historical payments, a split cannot change the received sum of zero.
      if(!body.next_page_token&&(!splits.length||!history.length)&&valid&&!unidentified&&!conflicting){
        const unique=new Map(history.map(row=>[String(row.id),row]));
        annualDividend={value:[...unique.values()].reduce((sum,row)=>sum+numeric(row.rate)!,0),kind:'estimated',source:'Alpaca corporate actions: suma de dividendos ordinarios por acción de los últimos 365 días',observedAt:asOf,availableAt:asOf,reason:`${unique.size} pagos recibidos. Base histórica para estimar q; no confirma pagos futuros. Una suma cero significa que no se recibieron pagos ordinarios en el período.`};
      }
      const seen=new Set<string>();
      const events=raw.map(record).flatMap(row=>{
        const amount=numeric(row.rate),ex=typeof row.ex_date==='string'?row.ex_date:'',id=typeof row.id==='string'?row.id:'';
        if(row.symbol!==symbol||!id||seen.has(id)||amount===null||amount<=0||!/^\d{4}-\d{2}-\d{2}$/.test(ex)||!Number.isFinite(Date.parse(ex))||new Date(ex).toISOString().slice(0,10)!==ex||ex<now.toISOString().slice(0,10)
          ||row.currency!=='USD'&&!(row.currency===undefined&&row.foreign===false)||row.foreign===true||row.special!==false)return [];
        seen.add(id);
        return [{id,exDate:ex,payableDate:typeof row.payable_date==='string'?row.payable_date:null,amount,currency:'USD' as const,availableAt:now.toISOString(),source:'Alpaca corporate actions · recibido en esta consulta; no fecha histórica de anuncio'}];
      }).sort((a,b)=>a.exDate.localeCompare(b.exDate));
      dividends={events,complete:false,status:{source:'Alpaca dividendos declarados',status:'partial',message:`${events.length} pagos futuros recibidos. No acredita todos los dividendos futuros ni fecha histórica de anuncio.`},warnings:['La API puede incorporar anuncios con retraso; una lista vacía no demuestra ausencia de dividendos. La estimación anual basada en pagos pasados no garantiza dividendos futuros.']};
      if(raw.some(item=>record(item).special!==false))dividends.warnings.push('Se excluyeron eventos especiales o sin clasificación verificada: pueden requerir ajustes del contrato que este modelo no aplica.');
      if(body.next_page_token)dividends.warnings.push('Eventos parciales: se alcanzó una página de 1,000 eventos; no se usan como calendario completo.');
    }
  }else dividends={...empty,status:providerFailure('Alpaca dividendos declarados',results[1].reason)};
  return {spot,dividends,annualDividend};
}
