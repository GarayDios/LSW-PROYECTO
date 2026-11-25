import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHoldingsTable,compareInstitutionalReports,previousQuarter,TRACKED_MANAGERS,type InstitutionalReport } from '../../src/cores/02-flujo-institucional/sec-13f.ts';
import { fetchInstitutionalResearch,institutionalSplitFactor,knownInstitutionalFilings } from '../../src/api/research/institutional.ts';
import { evaluateScanner } from '../../src/cores/evaluacion/scanner.ts';
import { defaultScannerSettings } from '../../src/cores/evaluacion/scanner-settings.ts';
import { researchFixture,fixtureTime } from './research-fixture.ts';
import type { ResearchFetch } from '../../src/api/research/http.ts';

const now=new Date(fixtureTime),sec={userAgent:'Terminal test contact@example.test'},alpaca={apiKey:'fixture-private-key',secretKey:'fixture-private-secret'},cusip='67066G104';
const position=(shares:number,type='SH',put='')=>`<n:infoTable><n:cusip>${cusip}</n:cusip><n:shrsOrPrnAmt><n:sshPrnamt>${shares}</n:sshPrnamt><n:sshPrnamtType>${type}</n:sshPrnamtType></n:shrsOrPrnAmt>${put?`<n:putCall>${put}</n:putCall>`:''}</n:infoTable>`;
const table=(shares:number)=>`<n:informationTable xmlns:n="urn:test">${position(shares)}${position(1000,'SH','Put')}${position(1000,'PRN')}</n:informationTable>`;
const accession=(cik:string,index:number)=>`${cik}-26-${String(index).padStart(6,'0')}`;
function filingRows(cik:string){return {filings:{recent:{form:['13F-HR','13F-HR/A','13F-HR'],accessionNumber:[accession(cik,3),accession(cik,2),accession(cik,1)],reportDate:['2026-09-30','2026-06-30','2026-06-30'],filingDate:['2026-11-06','2026-09-10','2026-08-10'],acceptanceDateTime:['2026-11-06T15:00:00Z','2026-09-10T15:00:00Z','2026-08-10T15:00:00Z'],primaryDocument:Array(3).fill('xslForm13F_X02/primary_doc.xml')}}};}
function fixtureFetcher({additive=false,denied=false,split=false,incomplete=false,absent=false}={}):{fetcher:ResearchFetch;calls:string[]}{
  const calls:string[]=[];
  return {calls,fetcher:async(input,init)=>{
    const url=new URL(String(input));calls.push(url.href);
    assert.equal(init?.redirect,'manual');
    assert.ok(['data.sec.gov','www.sec.gov','data.alpaca.markets'].includes(url.hostname));
    assert.ok(!url.href.includes(alpaca.apiKey));
    if(url.hostname==='data.alpaca.markets'){
      assert.equal(new Headers(init?.headers).get('APCA-API-KEY-ID'),alpaca.apiKey);
      return Response.json({corporate_actions:split?{forward_splits:[{id:'one',symbol:'NVDA',cusip,ex_date:'2026-07-01',old_rate:1,new_rate:10}]}:{},next_page_token:incomplete?'more':null});
    }
    assert.equal(new Headers(init?.headers).get('User-Agent'),sec.userAgent);
    if(denied)return new Response(alpaca.secretKey,{status:403});
    if(url.hostname==='data.sec.gov')return Response.json(filingRows(url.pathname.match(/CIK(\d+)/)![1]));
    const cik=String(Number(url.pathname.split('/')[4])).padStart(10,'0');
    const current=url.pathname.includes('26000003');
    if(url.pathname.endsWith('primary_doc.xml'))return new Response(`<edgarSubmission><submissionType>${current?'13F-HR':'13F-HR/A'}</submissionType><cik>${cik}</cik><reportCalendarOrQuarter>${current?'09-30-2026':'06-30-2026'}</reportCalendarOrQuarter>${current?'':`<amendmentType>${additive?'NEW HOLDINGS':'RESTATEMENT'}</amendmentType>`}<isConfidentialOmitted>false</isConfidentialOmitted><tableEntryTotal>3</tableEntryTotal></edgarSubmission>`);
    if(url.pathname.endsWith('index.json'))return Response.json({directory:{item:[{name:'primary_doc.xml',size:1000},{name:'positions.xml',size:2000}]}});
    if(url.pathname.endsWith('positions.xml'))return new Response(absent?table(100).replaceAll(cusip,'037833100'):table(current?(split?1000:110):100));
    throw Error('Unexpected request');
  }};
}

test('13F parsing sums stock rows, excludes options and principal and rejects truncated or unsafe XML',()=>{
  const parsed=parseHoldingsTable(table(100));assert.deepEqual(parsed,{entries:3,positions:{[cusip]:100}});
  assert.equal(parseHoldingsTable(`<informationTable>${position(10)}${position(20)}</informationTable>`).positions[cusip],30);
  assert.throws(()=>parseHoldingsTable('<informationTable><infoTable></informationTable>'),/truncada/);
  assert.throws(()=>parseHoldingsTable('<!DOCTYPE x><informationTable></informationTable>'),/no válida/);
  assert.throws(()=>parseHoldingsTable(table(100).replace('<n:sshPrnamt>100<','<n:sshPrnamt>-5<')),/inválida/);
});

test('quarter comparisons adjust splits and do not mistake prices or nonconsecutive periods for position changes',()=>{
  const current:InstitutionalReport={period:'2026-09-30',shares:1000,availableAt:fixtureTime,accession:'fixture',url:'https://www.sec.gov',amended:false};
  const previous={...current,period:'2026-06-30',shares:100};
  assert.equal(previousQuarter('2026-03-31'),'2025-12-31');
  assert.deepEqual(compareInstitutionalReports(current,previous,10),{splitFactor:10,change:0,direction:0});
  assert.throws(()=>compareInstitutionalReports(current,{...previous,period:'2026-03-31'},1),/comparables/);
  assert.throws(()=>compareInstitutionalReports(current,previous,0),/comparables/);
});

test('only public filings are considered and the latest known amendment replaces its quarter, never a future one',()=>{
  const rows=knownInstitutionalFilings(filingRows(TRACKED_MANAGERS[0].cik),'2026-09-15T16:00:00Z');
  assert.equal(rows.length,2);assert.equal(rows[0].form,'13F-HR/A');
  assert.equal(rows[0].availableAt,'2026-09-10T15:00:00.000Z');
  assert.deepEqual(knownInstitutionalFilings(filingRows(TRACKED_MANAGERS[0].cik),'2026-01-01T00:00:00Z'),[]);
});

test('split coverage must be complete, identified, consistent and comparable across the same security',()=>{
  const event={id:'one',symbol:'NVDA',cusip,ex_date:'2026-07-01',old_rate:1,new_rate:10};
  const body={corporate_actions:{forward_splits:[event,event]}};
  assert.equal(institutionalSplitFactor(body,'NVDA',cusip,'2026-07-01','2026-09-30'),10);
  assert.throws(()=>institutionalSplitFactor({...body,next_page_token:'more'},'NVDA',cusip,'2026-07-01','2026-09-30'),/completa/);
  assert.throws(()=>institutionalSplitFactor({corporate_actions:{forward_splits:[event,{...event,new_rate:2}]}},'NVDA',cusip,'2026-07-01','2026-09-30'),/contradictorios/);
  assert.throws(()=>institutionalSplitFactor({corporate_actions:{forward_splits:[{...event,cusip:'other'}]}},'NVDA',cusip,'2026-07-01','2026-09-30'),/identificador/);
  assert.throws(()=>institutionalSplitFactor({},'NVDA',cusip,'2026-07-01','2026-09-30'),/completa/);
});

test('automatic SEC sample reaches the weighted core, handles restatements and shares cached reports across companies',async()=>{
  const {fetcher,calls}=fixtureFetcher();
  const data=await fetchInstitutionalResearch(sec,alpaca,'NVDA',fixtureTime,fetcher,now);
  assert.equal(data.comparable,2);assert.equal(data.status.status,'partial');
  assert.equal(data.managers[0].previous!.amended,true);
  assert.equal(data.managers[0].previous!.accession,accession(TRACKED_MANAGERS[0].cik,2));
  assert.ok(data.direction.value!>0);assert.equal(data.direction.kind,'estimated');
  const s=researchFixture();s.symbol='NVDA';s.institutional=data;
  const settings=structuredClone(defaultScannerSettings);for(const [core,value] of Object.entries(settings.cores))value.enabled=core==='institutional';
  settings.cores.institutional.weight=4;
  const score=evaluateScanner(s,'wheel',30,settings);assert.ok(score.score!>50);assert.equal(score.availableWeight,4);assert.match(score.results[0].reason,/SEC 13F/);
  settings.cores.institutional.weight=0;assert.equal(evaluateScanner(s,'wheel',30,settings).score,null);
  const count=calls.filter(u=>u.includes('sec.gov')).length;
  await fetchInstitutionalResearch(sec,alpaca,'AAPL',fixtureTime,fetcher,now);
  assert.equal(calls.filter(u=>u.includes('sec.gov')).length,count,'parsed filings are shared across symbols');
  const late=structuredClone(data);late.direction.availableAt='2026-11-18T16:00:00Z';s.institutional=late;settings.cores.institutional.weight=4;
  assert.equal(evaluateScanner(s,'wheel',30,settings).score,null);
  assert.ok(!JSON.stringify(data).includes(alpaca.secretKey));
});

test('split-adjusted unchanged holdings are neutral; additive amendments and absent positions stay unavailable',async()=>{
  const split=await fetchInstitutionalResearch(sec,alpaca,'NVDA',fixtureTime,fixtureFetcher({split:true}).fetcher,now);
  assert.equal(split.direction.value,0);assert.equal(split.managers[0].change,0);
  const additive=await fetchInstitutionalResearch(sec,alpaca,'NVDA',fixtureTime,fixtureFetcher({additive:true}).fetcher,now);
  assert.equal(additive.comparable,0);assert.match(additive.managers[0].message,/Enmienda aditiva/);
  const absent=await fetchInstitutionalResearch(sec,alpaca,'NVDA',fixtureTime,fixtureFetcher({absent:true}).fetcher,now);
  assert.equal(absent.direction.value,null);assert.match(absent.managers[0].message,/ausencia/);
});

test('missing credentials, historical queries and unknown CUSIPs cannot make network requests; provider errors hide bodies',async()=>{
  const {fetcher,calls}=fixtureFetcher();
  assert.equal((await fetchInstitutionalResearch(undefined,alpaca,'NVDA',fixtureTime,fetcher,now)).status.status,'missing_config');
  assert.equal((await fetchInstitutionalResearch(sec,alpaca,'UNKNOWN',fixtureTime,fetcher,now)).status.status,'unavailable');
  assert.equal((await fetchInstitutionalResearch(sec,alpaca,'NVDA','2026-11-16T16:00:00Z',fetcher,now)).direction.value,null);
  assert.equal(calls.length,0);
  const denied=await fetchInstitutionalResearch(sec,alpaca,'NVDA',fixtureTime,fixtureFetcher({denied:true}).fetcher,now);
  assert.equal(denied.comparable,0);assert.ok(!JSON.stringify(denied).includes(alpaca.secretKey));
});
