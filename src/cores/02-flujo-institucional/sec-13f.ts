// Lectura y comparación de tenencias trimestrales SEC 13F. Mide cambios de acciones de una muestra de
// gestores, ajustados por splits; no representa flujo de dinero intradía. El adaptador HTTP selecciona los
// documentos públicos y sus enmiendas.

// Importa únicamente tipos para comprobar estructuras en TypeScript; esta declaración no ejecuta lógica en
// tiempo de ejecución.
import type { ProviderStatus, ResearchVariable } from '../compartido/research-model.ts';

// Relaciona los 14 símbolos admitidos con su CUSIP de nueve caracteres; identifica el título concreto, no
// solo el nombre del emisor.
export const INSTITUTIONAL_SECURITIES:Record<string,string>={AAPL:'037833100',NVDA:'67066G104',MSFT:'594918104',TSLA:'88160R101',AMZN:'023135106',META:'30303M102',GOOGL:'02079K305',AMD:'007903107',JPM:'46625H100',KO:'191216100',DIS:'254687106',PLTR:'69608A108',AVGO:'11135F101',NFLX:'64110L106'};
// Define la muestra de gestores Geode y State Street mediante sus CIK de SEC; as const conserva sus valores
// literales como solo lectura.
export const TRACKED_MANAGERS=[{cik:'0001214717',name:'Geode Capital Management'},{cik:'0000093751',name:'State Street'}] as const;
// Describe un informe: trimestre, fecha de disponibilidad, número de presentación, enlace, acciones y marca
// de enmienda.
export type InstitutionalReport={period:string;availableAt:string;accession:string;url:string;shares:number;amended:boolean};
// Describe un gestor y sus informes opcionales; splitFactor ajusta acciones, change mide cambio relativo y
// direction mide dirección simétrica.
export type InstitutionalManager={cik:string;name:string;message:string;current?:InstitutionalReport;previous?:InstitutionalReport;splitFactor?:number;change?:number;direction?:number};
// Describe la investigación conjunta: estado, CUSIP, gestores, cobertura comparable, dirección con
// procedencia y advertencias.
export type InstitutionalResearch={status:ProviderStatus;cusip:string|null;managers:InstitutionalManager[];configured:number;comparable:number;direction:ResearchVariable;warnings:string[]};
// Representa las acciones agregadas por CUSIP y el número total de entradas XML examinadas, incluidas las
// que después se filtran.
export type HoldingsTable={positions:Record<string,number>;entries:number};
// Permite que las etiquetas XML tengan un prefijo de espacio de nombres opcional, por ejemplo ns:cusip.
const prefix='(?:[A-Za-z_][\\w.-]*:)?';
// Extrae el texto simple de una etiqueta de la tabla 13F; no es un analizador XML de propósito general.
export function xmlValue(xml:string,key:string):string|null{
  // Busca apertura y cierre de la etiqueta sin distinguir mayúsculas, recorta espacios y devuelve null si no
  // encuentra texto.
  return xml.match(new RegExp(`<${prefix}${key}\\b[^>]*>([^<]*)<\\/${prefix}${key}\\s*>`,'i'))?.[1]?.trim()??null;
// Cierra el bloque, objeto o declaración iniciado anteriormente.
}
// Acepta solo fechas reales YYYY-MM-DD; la comparación de ida y vuelta rechaza días imposibles que Date
// normalizaría.
export function validDate(value:unknown):value is string{return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;}
// Calcula el cierre del trimestre inmediatamente anterior al período recibido.
export function previousQuarter(period:string):string{
  // En UTC fija día 1, retrocede dos meses y usa día 0 para llegar al final del trimestre previo; devuelve
  // YYYY-MM-DD.
  const date=new Date(period+'T00:00:00Z');date.setUTCDate(1);date.setUTCMonth(date.getUTCMonth()-2);date.setUTCDate(0);return date.toISOString().slice(0,10);
// Cierra el bloque, objeto o declaración iniciado anteriormente.
}
// Interpreta el XML de una tabla de posiciones institucionales 13F.
export function parseHoldingsTable(xml:string):HoldingsTable{
  // Rechaza declaraciones DOCTYPE/ENTITY y exige contenedor informationTable de apertura y cierre; no admite
  // entidades externas.
  if(/<!DOCTYPE|<!ENTITY/i.test(xml)||!new RegExp(`<${prefix}informationTable\\b`,'i').test(xml)||!new RegExp(`<\\/${prefix}informationTable\\s*>`,'i').test(xml))throw Error('Tabla 13F no válida.');
  // Extrae cada bloque infoTable completo, incluso cuando contiene saltos de línea o prefijos XML.
  const blocks=[...xml.matchAll(new RegExp(`<${prefix}infoTable\\b[^>]*>([\\s\\S]*?)<\\/${prefix}infoTable\\s*>`,'gi'))];
  // Cuenta aperturas infoTable por separado para detectar bloques que quedaron sin cerrar.
  const starts=xml.match(new RegExp(`<${prefix}infoTable\\b`,'gi'))?.length??0;
  // Rechaza una tabla truncada o de más de 100000 entradas antes de procesar sus posiciones.
  if(starts!==blocks.length||blocks.length>100000)throw Error('Tabla 13F truncada o excesiva.');
  // Inicializa el diccionario de acciones por identificador CUSIP.
  const positions:Record<string,number>={};
  // Recorre cada bloque extraído del XML.
  for(const block of blocks){
    // Lee CUSIP, unidad de tenencia, presencia de put/call y cantidad reportada en sshPrnamt.
    const item=block[1],cusip=xmlValue(item,'cusip'),type=xmlValue(item,'sshPrnamtType'),option=xmlValue(item,'putCall'),raw=xmlValue(item,'sshPrnamt');
    // Excluye opciones y tenencias cuya unidad no sea SH, acciones; no confunde principal de bonos con acciones.
    if(option||type!=='SH')continue;
    // Exige CUSIP con formato admitido y cantidad entera no negativa representable de forma segura en
    // JavaScript.
    if(!cusip||!/^[A-Z0-9*@#]{9}$/.test(cusip)||raw===null||!/^\d+$/.test(raw)||!Number.isSafeInteger(Number(raw)))throw Error('Posición 13F inválida.');
    // Suma las filas del mismo CUSIP; ?? 0 inicia la suma cuando es la primera aparición del título.
    positions[cusip]=(positions[cusip]??0)+Number(raw);
    // Comprueba que la suma agregada tampoco exceda el rango de enteros exactos.
    if(!Number.isSafeInteger(positions[cusip]))throw Error('Posición fuera de rango.');
  // Cierra el bloque, objeto o declaración iniciado anteriormente.
  }
  // Devuelve cantidades por título y número de bloques originales; una ausencia no se convierte aquí en una
  // posición cero.
  return {positions,entries:blocks.length};
// Cierra el bloque, objeto o declaración iniciado anteriormente.
}
// Compara dos informes de un gestor y devuelve solo factor de split, cambio relativo y dirección
// normalizada.
export function compareInstitutionalReports(current:InstitutionalReport,previous:InstitutionalReport,factor:number):Pick<InstitutionalManager,'change'|'direction'|'splitFactor'>{
  // Exige trimestres consecutivos, factor positivo y finito, acciones no negativas y al menos una tenencia
  // distinta de cero.
  if(previousQuarter(current.period)!==previous.period||!Number.isFinite(factor)||factor<=0||current.shares<0||previous.shares<0||current.shares+previous.shares===0)throw Error('Períodos o acciones no comparables.');
  // Expresa las acciones anteriores en las unidades del trimestre actual y suma ambas cantidades para
  // normalizar la dirección.
  const adjusted=previous.shares*factor,denominator=current.shares+adjusted;
  // Rechaza ajustes no finitos o una suma sin base utilizable.
  if(!Number.isFinite(adjusted)||!denominator)throw Error('Base ajustada no válida.');
  // Calcula change = (actual − anterior ajustado) / anterior ajustado si había base; direction = diferencia /
  // suma queda entre −1 y 1.
  return {splitFactor:factor,change:adjusted>0?(current.shares-adjusted)/adjusted:undefined,direction:(current.shares-adjusted)/denominator};
// Cierra el bloque, objeto o declaración iniciado anteriormente.
}
