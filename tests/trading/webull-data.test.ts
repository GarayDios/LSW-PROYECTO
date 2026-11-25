import test from 'node:test';
import assert from 'node:assert/strict';
import {WebullData,normalizeWebullBalances,normalizeWebullPositions,normalizeWebullOrders,normalizeWebullBars} from '../../src/api/brokers/webull/data.ts';
import {normalizeWebullOptions,fetchWebullOptions} from '../../src/api/brokers/webull/options-data.ts';
import {WebullClient,readWebullConfig} from '../../src/api/brokers/webull/client.ts';
import {webullHistoryQuery,webullOrderPage} from '../../src/cores/compartido/webull-model.ts';
import {createWebullHandlers} from '../../src/api/brokers/webull/handlers.ts';
const config=readWebullConfig({WEBULL_APP_KEY:'fixture',WEBULL_APP_SECRET:'fixture',WEBULL_ACCOUNT_ID:'account',WEBULL_REGION:'us',WEBULL_ENVIRONMENT:'sandbox'})!;
const balances={total_asset_currency:'USD',total_net_liquidation_value:'25000',total_cash_balance:'20000',account_currency_assets:[{currency:'USD',settled_cash:'20000',option_buying_power:'18000',buying_power:'20000'}]};
const asOf='2026-11-24T18:00:00Z';
const metadata={symbol:'NVDA270115P00150000',underlying_symbol:'NVDA',option_type:'PUT',status:'LISTING',tradable_status:'OC',expiration_date:'2027-01-15',style:'AMERICAN',strike_price:'150',multiplier:'100',deliverables:[{asset_type:'EQUITY',symbol:'NVDA',amount:'100'}]};
const snapshot={symbol:metadata.symbol,bid:'2.50',ask:'2.70',imp_vol:'0.55',open_interest:'150',quote_time:Date.parse(asOf)-900000,delay_minutes:15};
const query=webullHistoryQuery.parse({symbol:'NVDA',start:'2026-11-20',end:'2026-11-24',interval:'1d'});
const candle=(day:string)=>({time:day+'T05:00:00.000+0000',open:'100',high:'102',low:'99',close:'101',volume:'500'});
test('Webull USD balances preserve missing values and actual zeros without inventing buying power',()=>{
  const value=normalizeWebullBalances(balances);assert.equal(value.cash,20000);assert.equal(value.equity,25000);assert.equal(value.optionBuyingPower,18000);assert.equal(value.unsettledCash,null);
  assert.equal(normalizeWebullBalances({...balances,total_cash_balance:'0'}).cash,0);
  assert.throws(()=>normalizeWebullBalances({...balances,total_asset_currency:'MXN'}));
  const positions=normalizeWebullPositions([{symbol:'NVDA',instrument_type:'EQUITY',quantity:'100',cost_price:'95',legs:[{symbol:'NVDA',quantity:'80'}]}]);
  assert.equal(positions[0].availableQuantity,80);assert.equal(positions[0].averagePrice,95);
  assert.equal(normalizeWebullPositions([{symbol:'NVDA',quantity:'100'}])[0].availableQuantity,null);
  assert.throws(()=>normalizeWebullPositions({unknown:[]}));assert.throws(()=>normalizeWebullPositions([{symbol:'NVDA'}]));
});
test('Webull v3 grouped order pages flatten children while retaining cursor, quantities, states and UTC dates',()=>{
  const page=normalizeWebullOrders({data:[{combo_type:'NORMAL',client_order_id:'parent',orders:[{client_order_id:'child',symbol:'NVDA',instrument_type:'STOCK',total_quantity:'5',filled_quantity:'2',limit_price:'100',status:'PARTIAL_FILLED',place_time_at:asOf,legs:[]}]}],pagination_key:'cursor=='});
  assert.equal(page.next,'cursor==');assert.equal(page.orders.length,1);assert.equal(page.orders[0].reference,'child');assert.equal(page.orders[0].quantity,5);assert.equal(page.orders[0].state,'PARTIAL_FILLED');assert.equal(page.orders[0].createdAt,new Date(asOf).toISOString());assert.equal(page.orders[0].type,'EQUITY');
  assert.deepEqual(normalizeWebullOrders({data:[]}),{orders:[],next:null});assert.throws(()=>normalizeWebullOrders({data:[{}]}));
});
test('Webull descending OHLC bars sort, deduplicate, respect cutoff and reject contradictory prices',()=>{
  const data=normalizeWebullBars({result:[{symbol:'NVDA',result:[candle('2026-11-24'),candle('2026-11-23'),candle('2026-11-23'),candle('2026-11-25')]}]},query,asOf);
  assert.equal(data.bars.length,2);assert.ok(data.bars[0].time<data.bars[1].time);assert.equal(data.adjustment,'forward');assert.equal(data.feed,'sandbox');assert.ok(data.warnings.some(w=>w.includes('forward-adjusted')));
  assert.throws(()=>normalizeWebullBars({result:[{symbol:'MSFT',result:[]}]},query,asOf));
  for(const bad of [{...candle('2026-11-23'),high:'90'},{...candle('2026-11-23'),volume:'-1'},{...candle('2026-11-23'),time:'bad'}])assert.throws(()=>normalizeWebullBars({result:[{symbol:'NVDA',result:[bad]}]},query,asOf));
  assert.throws(()=>normalizeWebullBars({result:[{symbol:'NVDA',result:[candle('2026-11-23'),{...candle('2026-11-23'),close:'100'}]}]},query,asOf));
});
test('Webull options keep IV in decimals, verify deliverables and never turn old sandbox quotes into current inputs',()=>{
  const current=normalizeWebullOptions('NVDA',[metadata],[snapshot],asOf,false),c=current.contracts[0];
  assert.equal(c.impliedVolatility.value,.55);assert.equal(c.premium.value,2.6);assert.equal(c.premium.kind,'estimated');assert.equal(c.multiplier?.value,100);assert.equal(c.deliverableShares?.value,100);assert.equal(current.complete,false);assert.equal(current.feed,'webull-sandbox');
  for(const quote_time of [Date.parse(asOf)-3600001,Date.parse(asOf)+1]){const contract=normalizeWebullOptions('NVDA',[metadata],[{...snapshot,quote_time}],asOf,false).contracts[0];assert.equal(contract.impliedVolatility.value,null);assert.equal(contract.bid.value,null);if(quote_time<Date.parse(asOf))assert.equal(contract.bid.lastReceived?.value,2.5);}
  const adjusted=normalizeWebullOptions('NVDA',[{...metadata,multiplier:undefined,deliverables:[]}],[snapshot],asOf,false).contracts[0];assert.equal(adjusted.multiplier?.value,null);assert.equal(adjusted.deliverableShares?.value,null);
  assert.equal(normalizeWebullOptions('MSFT',[metadata],[snapshot],asOf,false).contracts.length,0);
});
class DataClient extends WebullClient{
  calls:{path:string;query:Record<string,string>;body:unknown}[]=[];failure='';
  async verifyAccount(){}
  async request(path:string,q:Record<string,string>={},body?:unknown){this.calls.push({path,query:q,body});if(path===this.failure)throw Error('fixture-denied');if(path.includes('/balances/'))return balances;if(path.includes('/positions/'))return [];if(path.includes('/orders/'))return {data:[],pagination_key:'next=='};if(path.includes('/bars/'))return {result:[{symbol:'NVDA',result:[candle('2026-11-23')]}]};if(path.includes('/contracts/'))return {data:[metadata],pagination_key:'partial'};if(path.includes('/options/snapshots/'))return [snapshot];return [{symbol:'NVDA',price:'160'}];}
}
test('Webull account reads coalesce and isolate unavailable sections instead of substituting another broker',async()=>{
  const client=new DataClient(config);client.failure='/trading/assets/positions/list';const data=new WebullData(client);
  const [first,second]=await Promise.all([data.portfolio(),data.portfolio()]);
  assert.equal(client.calls.length,4);assert.equal(first.balances.data?.cash,20000);assert.equal(first.positions.available,false);assert.equal(first.positions.data,null);assert.equal(first.history.next,'next==');assert.equal(first.history.complete,false);
  first.balances.data!.cash=1;assert.equal(second.balances.data?.cash,20000);
  data.invalidateAccount();await data.portfolio();assert.equal(client.calls.length,8);
});
test('Webull market bars use the official batch POST shape, and history pages forward opaque cursors and dates',async()=>{
  const client=new DataClient(config),data=new WebullData(client);await data.history(query);
  const body=client.calls[0].body as Record<string,unknown>;assert.deepEqual(body.symbols,['NVDA']);assert.equal(body.timespan,'D');assert.equal(body.category,'US_STOCK');assert.equal(body.count,1200);
  await data.orders('history','cursor+==','2026-01-01','2026-11-24');const args=client.calls.at(-1)!.query;assert.equal(args.pagination_key,'cursor+==');assert.equal(args.start_time,'2026-01-01T00:00:00.000Z');assert.equal(args.end_time,'2026-11-24T23:59:59.999Z');
  assert.equal(webullOrderPage.safeParse({kind:'history',start:'2026-01-01'}).success,false);assert.equal(webullOrderPage.safeParse({kind:'open',start:'2026-01-01',end:'2026-11-24'}).success,false);
});
test('Webull options retain metadata and partial coverage when the snapshot entitlement is unavailable',async()=>{
  const client=new DataClient(config);client.failure='/market-data/options/snapshots/list';
  const data=await fetchWebullOptions(client,'NVDA',30,160);assert.equal(data.complete,false);assert.equal(data.contracts.length,1);assert.equal(data.contracts[0].bid.value,null);assert.match(data.status.message,/0 snapshots/);
  assert.ok(client.calls.filter(c=>c.path.includes('/snapshots/')).every(c=>c.query.symbols.split(',').length<=20));
});
test('Webull market queries remain authenticated and the public proxy never accepts an arbitrary endpoint',async()=>{
  const env={BROKER_OWNER_USER_ID:'owner',TRADING_RUNNER_URL:'http://127.0.0.1:8790',TRADING_RUNNER_TOKEN:'fixture-private-token-long-enough-for-test'};let calls=0;
  const deps={environment:()=>env,owner:async()=>({userId:'owner'}),fetcher:async(url:URL|RequestInfo,init?:RequestInit)=>{calls++;const target=new URL(String(url));assert.equal(target.pathname,'/webull/market-history');assert.equal(target.searchParams.get('ownerId'),'owner');assert.equal(new Headers(init?.headers).get('Authorization'),'Bearer '+env.TRADING_RUNNER_TOKEN);return Response.json({source:'webull'});}};
  const request=new Request('https://terminal.test/api/webull?action=market-history&symbol=NVDA&start=2026-01-01&end=2026-11-24');
  assert.equal((await createWebullHandlers({...deps,owner:async()=>null}).get(request)).status,401);assert.equal(calls,0);
  const api=createWebullHandlers(deps);assert.equal((await api.get(request)).status,200);assert.equal(calls,1);
  assert.equal((await api.get(new Request('https://terminal.test/api/webull?action=../private'))).status,400);assert.equal(calls,1);
});

test('Webull history walks backwards beyond 1200 bars without losing the range or trusting repeated pages',async()=>{
  const start='2023-01-01',end='2026-11-24',rows=Array.from({length:Math.floor((Date.parse(end)-Date.parse(start))/86400000)+1},(_,i)=>candle(new Date(Date.parse(start)+i*86400000).toISOString().slice(0,10)));
  class PagedHistory extends WebullClient{
    ends:number[]=[];repeat=false;
    async request(_path:string,_query:Record<string,string>={},payload?:unknown){const p=payload as {end_time:number};this.ends.push(p.end_time);return {result:[{symbol:'NVDA',result:rows.filter(row=>this.repeat||Date.parse(row.time)<=p.end_time).slice(-1200).reverse()}]};}
  }
  const client=new PagedHistory(config),result=await new WebullData(client).history({symbol:'NVDA',start,end,interval:'1d'});assert.equal(result.bars.length,rows.length);assert.equal(client.ends.length,2);assert.ok(client.ends[1]<client.ends[0]);assert.equal(result.coverage.firstBar,rows[0].time.replace('+0000','Z'));
  const stuck=new PagedHistory(config);stuck.repeat=true;await assert.rejects(()=>new WebullData(stuck).history({symbol:'NVDA',start,end,interval:'1d'}),/avanzó/);
});
test('Webull closed-session analytics retain actual quote time and refuse it during a later open session',()=>{
  const quote={...snapshot,quote_time:Date.parse('2026-11-24T20:59:00Z')};
  const closed=normalizeWebullOptions('NVDA',[metadata],[quote],'2026-11-25T05:00:00Z',false).contracts[0];assert.equal(closed.impliedVolatility.value,.55);assert.equal(closed.bid.observedAt,'2026-11-24T20:59:00.000Z');assert.match(closed.bid.reason!,/sesión cerrada/);
  const open=normalizeWebullOptions('NVDA',[metadata],[quote],'2026-11-25T16:00:00Z',false).contracts[0];assert.equal(open.bid.value,null);assert.equal(open.bid.lastReceived?.value,2.5);
});
