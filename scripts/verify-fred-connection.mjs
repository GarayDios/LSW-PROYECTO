import { existsSync } from 'node:fs';
import { fetchFredMacro } from '../src/api/research/fred.ts';
if(existsSync('.env.local'))process.loadEnvFile('.env.local');
if(!process.env.FRED_API_KEY?.trim()){
  console.error('FRED_API_KEY no configurada. Agrega tu clave en .env.local; no la publiques ni la pegues en el chat.');process.exitCode=1;
}else{
  const result=await fetchFredMacro({apiKey:process.env.FRED_API_KEY.trim()},new Date().toISOString());
  console.log(JSON.stringify({source:result.status.source,status:result.status.status,riskFreeRateAvailable:result.riskFreeRate.value!==null,
    inflationAvailable:result.inflationYearOverYear.value!==null,gdpAvailable:result.realGdpGrowth.value!==null,warnings:result.warnings},null,2));
  if(result.status.status!=='ready')process.exitCode=1;
}
