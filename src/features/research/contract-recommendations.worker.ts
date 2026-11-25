import {recommendContracts,type ContractRecommendationRequest,type ContractRecommendations} from '../../cores/evaluacion/contract-recommendations';
export type ContractRecommendationReply={result:ContractRecommendations;error?:never}|{result?:never;error:string};
const scope=globalThis as unknown as {onmessage:(event:MessageEvent<ContractRecommendationRequest>)=>void;postMessage:(reply:ContractRecommendationReply)=>void};
scope.onmessage=event=>{try{scope.postMessage({result:recommendContracts(event.data)});}catch(error){scope.postMessage({error:error instanceof Error?error.message:'No se pudieron comparar los contratos.'});}};
