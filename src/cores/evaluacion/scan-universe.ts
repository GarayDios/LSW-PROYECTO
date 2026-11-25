// Selección del universo admitido y filtros finales de puntuación, orden y tamaño de lista. Solo consume
// resultados ya calculados.

// Importa tipos compartidos para verificar las estructuras de datos; no ejecuta cálculos en tiempo de
// ejecución.
import type { ScannerSettings } from './scanner-settings.ts';
// Selecciona símbolos del catálogo, de la lista actual o del subconjunto tecnológico.
export function scanUniverse(catalog:readonly {symbol:string;sector:string}[],current:readonly string[],choice:ScannerSettings['scan']['universe']):string[]{
  // Tecnología admite los sectores Tecnología y Semiconductores; la lista actual se cruza con el catálogo.
  const allowed=choice==='technology'?catalog.filter(c=>['Tecnología','Semiconductores'].includes(c.sector)):choice==='current-list'?catalog.filter(c=>current.includes(c.symbol)):catalog;
  // Deduplica símbolos y limita el universo a los primeros 14 para acotar el trabajo y las consultas.
  return [...new Set(allowed.map(c=>c.symbol))].slice(0,14);
// Cierra el bloque, objeto o llamada definido anteriormente.
}
// Filtra y ordena resultados ya calculados conservando sus campos adicionales mediante un tipo genérico.
export function filterScanResults<T extends {symbol:string;score:number|null;probabilityOfProfit?:number|null}>(rows:readonly T[],settings:ScannerSettings['scan']):(T&{score:number})[]{
  // Excluye puntuaciones nulas/no finitas y las inferiores a la confluencia mínima antes de ordenar.
  return rows.filter((row):row is T&{score:number}=>row.score!==null&&Number.isFinite(row.score)&&row.score>=settings.minConfluence).sort((a,b)=>{
    // Para ordenar por PoP usa la probabilidad finita recibida; los faltantes se sitúan por debajo de cualquier
    // probabilidad válida.
    const pop=(row:T)=>row.probabilityOfProfit!==null&&row.probabilityOfProfit!==undefined&&Number.isFinite(row.probabilityOfProfit)?row.probabilityOfProfit:-1;
    // Aplica PoP solo si se eligió ese orden; desempata por confluencia y símbolo de forma reproducible.
    return (settings.order==='pop'?pop(b)-pop(a):0)||b.score-a.score||a.symbol.localeCompare(b.symbol);
  // Recorta la lista al límite configurado después de filtrar y ordenar.
  }).slice(0,settings.limit);
// Cierra el bloque, objeto o llamada definido anteriormente.
}
