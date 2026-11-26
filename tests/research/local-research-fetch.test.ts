import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer,type IncomingMessage,type ServerResponse} from 'node:http';
import {localResearchFetch} from '../../scripts/vite/local-research-fetch.mjs';
import {fetchFredMacro} from '../../src/api/research/fred.ts';

test('local FRED transport preserves vintage and units, keeps keys server-side and rejects untrusted requests',async()=>{
  const previous=process.env.FRED_API_KEY;
  process.env.FRED_API_KEY='private-local-fred-fixture';
  const upstream:URL[]=[],internal:string[]=[];
  const plugin=localResearchFetch({fetcher:async(input,init)=>{
    const url=new URL(String(input));upstream.push(url);
    assert.equal(url.origin,'https://api.stlouisfed.org');
    assert.equal(url.pathname,'/fred/series/observations');
    assert.equal(url.searchParams.get('api_key'),process.env.FRED_API_KEY);
    assert.equal(init?.redirect,'manual');
    return Response.json({observations:url.searchParams.get('series_id')==='DGS3MO'?[{date:'2026-11-23',value:'4'}]:[]});
  }});
  plugin.configResolved({command:'serve'});
  let middleware:(request:IncomingMessage,response:ServerResponse,next:()=>void)=>void;
  const server=createServer((request,response)=>{
    const chunks:Buffer[]=[];request.on('data',(chunk:Buffer)=>chunks.push(chunk));request.on('end',()=>internal.push(Buffer.concat(chunks).toString()));
    middleware(request,response,()=>{response.writeHead(404);response.end();});
  });
  try{
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
    const port=(server.address() as {port:number}).port;
    plugin.configureServer({config:{server:{port}},middlewares:{use(value:typeof middleware){middleware=value;}}});
    const source=plugin.load.call({environment:{name:'rsc'}},plugin.resolveId('virtual:local-research-fetch'),{ssr:true});
    assert.ok(source&&!source.includes(process.env.FRED_API_KEY));
    const transport=(await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'))).default;
    const result=await fetchFredMacro({apiKey:'worker-key-not-forwarded'},'2026-11-25T19:00:00Z',transport);
    assert.equal(result.riskFreeRate.value,Math.log1p(.04));
    assert.equal(upstream.length,3);
    assert.ok(upstream.every(url=>url.searchParams.get('realtime_start')==='2026-11-24'));
    assert.ok(internal.every(body=>!body.includes('worker-key-not-forwarded')&&!body.includes(process.env.FRED_API_KEY!)));
    const address=`http://127.0.0.1:${port}/__local_research/fred`;
    assert.equal((await fetch(address,{method:'POST',body:'{}'})).status,401);
    const authorization=JSON.parse(source!.match(/Authorization: ("[^"]+")/)![1]);
    assert.equal((await fetch(address,{method:'POST',headers:{Authorization:authorization},body:JSON.stringify({series_id:'DGS3MO',file_type:'json',url:'https://untrusted.invalid'})})).status,400);
    assert.equal(upstream.length,3);
  }finally{
    if(previous===undefined)delete process.env.FRED_API_KEY;else process.env.FRED_API_KEY=previous;
    server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));
  }
});

test('production and managed previews use normal fetch and the bridge cannot enter a client bundle',()=>{
  for(const enabled of [true,false]){
    const plugin=localResearchFetch({enabled});plugin.configResolved({command:enabled?'build':'serve'});
    const id=plugin.resolveId('virtual:local-research-fetch');
    assert.equal(plugin.load.call({environment:{name:'rsc'}},id,{ssr:true}),'export default (input, init) => fetch(input, init);');
    assert.throws(()=>plugin.load.call({environment:{name:'client'}},id,{}),/server-only/);
    let installed=false;plugin.configureServer({middlewares:{use(){installed=true;}}});assert.equal(installed,false);
  }
});
