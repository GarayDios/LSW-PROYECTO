import { mkdtempSync,copyFileSync,mkdirSync,writeFileSync,rmSync,existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url)),temporary=mkdtempSync(path.join(tmpdir(),'tepic-clean-install-'));
const target=path.resolve(temporary),parent=path.resolve(tmpdir());
if(path.dirname(target)!==parent||!path.basename(target).startsWith('tepic-clean-install-'))throw Error('Unsafe temporary workspace.');
const cli=process.env.npm_execpath;
if(!cli||!existsSync(cli))throw Error('Ejecuta con npm run verify:clean.');
const files=spawnSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{cwd:root,encoding:'utf8'});
if(files.status!==0)throw Error('No se pudo enumerar el código del proyecto.');
const environment={...process.env,SHARP_IGNORE_GLOBAL_LIBVIPS:'1'};
for(const key of Object.keys(environment))if(/(?:TOKEN|SECRET|API_KEY|SERVICE_ROLE_KEY)$/.test(key)||/^(?:ALPACA|FRED|SEC|SUPABASE|MONGO|BROKER|TRADING)_/.test(key))delete environment[key];
const report={node:process.version,platform:process.platform,sourceFiles:0,checks:[],status:'running',note:'Instalación aislada en esta máquina; no acredita una segunda computadora ni credenciales externas.'};
const output=path.join(root,'outputs');mkdirSync(output,{recursive:true});
try{
  for(const name of new Set(files.stdout.split('\0').filter(Boolean))){
    if(name.startsWith('.env')&&name!=='.env.example'||name.startsWith('outputs/')||name.startsWith('.git/')||name.startsWith('node_modules/')||name.startsWith('.sites-runtime/'))continue;
    const from=path.resolve(root,name),to=path.resolve(target,name);
    if(!from.startsWith(path.resolve(root)+path.sep)||!to.startsWith(target+path.sep))throw Error('Source escaped workspace.');
    mkdirSync(path.dirname(to),{recursive:true});copyFileSync(from,to);report.sourceFiles++;
  }
  for(const [label,args] of [['install',['ci','--include=dev','--include=optional','--prefer-offline','--no-audit','--no-fund']],['typecheck',['run','typecheck']],['test',['test']],['build',['run','build']]]){
    console.log(`Instalación aislada: ${label}…`);
    const result=spawnSync(process.execPath,[cli,...args],{cwd:target,env:environment,encoding:'utf8',maxBuffer:32*1024*1024,timeout:15*60*1000,windowsHide:true});
    writeFileSync(path.join(output,`clean-install-${label}.log`),(result.stdout??'')+(result.stderr??''));
    report.checks.push({label,exitCode:result.status});
    if(result.status!==0)throw Error(`Falló ${label}; revisa outputs/clean-install-${label}.log.`);
  }
  report.status='passed';console.log('Instalación aislada, TypeScript, pruebas y compilación aprobados sin .env.local.');
}catch(error){report.status='failed';console.error(error.message);process.exitCode=1;}
finally{
  writeFileSync(path.join(output,'clean-install-report.json'),JSON.stringify(report,null,2));
  // Validate the resolved deletion target again immediately before recursive cleanup.
  if(path.dirname(path.resolve(target))===parent&&path.basename(target).startsWith('tepic-clean-install-'))rmSync(target,{recursive:true,force:true});
}
