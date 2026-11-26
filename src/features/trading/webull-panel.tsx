"use client";
import {useState} from 'react';
import WebullTicket from './webull-ticket';
import F5Panel from '../f5/f5-panel';
import type {StrategyId} from '../../cores/compartido/types';
import type {F5RecommendationDraft} from '../f5/recommendation-draft';
export default function WebullPanel(props:{symbol:string;allowTrading:boolean;initialStrategy?:StrategyId;initialWheelPhase?:'put'|'call';initialDraft?:F5RecommendationDraft;onActivity?:()=>void}){
  const [view,setView]=useState<'f5'|'desk'>('f5');
  return <><nav className="manual-destinations" aria-label="Mesa Webull"><button className={view==='f5'?'primary-button':'secondary-button'} onClick={()=>setView('f5')}>Estrategias F5 Webull</button><button className={view==='desk'?'primary-button':'secondary-button'} onClick={()=>setView('desk')}>Acciones y gestión Webull</button></nav>{view==='f5'?<F5Panel key={'webull:'+props.symbol} broker="webull" underlying={props.symbol} initialStrategy={props.initialStrategy??'wheel'} initialWheelPhase={props.initialWheelPhase} initialDraft={props.initialDraft} allowTrading={props.allowTrading} onActivity={props.onActivity}/>:<WebullTicket key={props.symbol+':'+props.allowTrading} {...props}/>}</>;
}
