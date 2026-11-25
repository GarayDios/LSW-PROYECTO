"use client";
import {useEffect,useRef,useState,type FormEvent} from 'react';
import {MessageSquare,Send,Sparkles,Square,RotateCcw} from 'lucide-react';
import type {InvestorPreferences} from '../../cores/02-inteligencia-artificial/preferences';
import type {PersonalizedRecommendation} from '../../cores/02-inteligencia-artificial/recommendations';
import type {AnalysisSettings} from '../research/analysis-settings';
import type {StrategyId} from '../../cores/compartido/types';
import {assistantMessageHistory} from './chat-history';
import './intelligence-panel.css';

type Message={role:'user'|'assistant';content:string;asOf?:string|null;model?:string;recommendation?:PersonalizedRecommendation|null;dataError?:string|null;truncated?:boolean};
type Reply={answer:string;asOf:string|null;model:string;recommendation:PersonalizedRecommendation|null;dataError:string|null;truncated?:boolean};
const suggestions=['¿Qué me recomiendas revisar con mi perfil?','¿Qué riesgos ves en esta empresa?','Compara Wheel y PMCC para mi objetivo.','Explícame qué dice la simulación histórica.'];

export default function IntelligenceChat({symbol,provider,start,end,cutoff,preferences,settings,onChoose}:{symbol:string;provider:'alpaca'|'webull'|'demo';start:string;end:string;cutoff?:string;preferences:InvestorPreferences;settings:AnalysisSettings;onChoose:(strategy:StrategyId)=>void}){
  const [messages,setMessages]=useState<Message[]>([]),[question,setQuestion]=useState(''),[pending,setPending]=useState(false),[error,setError]=useState('');
  const [status,setStatus]=useState<{configured:boolean;model:string}|null>(null),[statusError,setStatusError]=useState('');
  const controller=useRef<AbortController|null>(null),latest=useRef<HTMLDivElement>(null),sending=useRef(false);
  useEffect(()=>{const abort=new AbortController();void fetch('/api/intelligence',{signal:abort.signal,cache:'no-store',credentials:'same-origin'}).then(async response=>{const body=await response.json() as {configured:boolean;model:string;error?:{message?:string}};if(!response.ok)throw Error(body.error?.message??'No se pudo consultar la conexión de IA.');setStatus(body);}).catch(cause=>{if(!abort.signal.aborted)setStatusError(cause.message);});return()=>{abort.abort();controller.current?.abort();};},[]);
  useEffect(()=>{if(messages.length)latest.current?.scrollIntoView({block:'nearest',behavior:'smooth'});},[messages,pending]);
  async function send(text:string){
    const content=text.trim();if(!content||sending.current||content.length>4000)return;
    const thread=[...messages,{role:'user' as const,content}];
    sending.current=true;setPending(true);setError('');setMessages(thread);setQuestion('');
    const abort=new AbortController();controller.current=abort;
    try{
      const response=await fetch('/api/intelligence',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},signal:abort.signal,
        body:JSON.stringify({messages:assistantMessageHistory(thread),symbol,provider,start,end,cutoff,preferences,settings})});
      const result=await response.json() as Reply&{error?:{message?:string}};
      if(!response.ok)throw Error(result.error?.message??'No se pudo completar tu pregunta.');
      if(!abort.signal.aborted)setMessages([...thread,{role:'assistant',content:result.answer,asOf:result.asOf,model:result.model,recommendation:result.recommendation,dataError:result.dataError,truncated:result.truncated}]);
    }catch(cause){if(!abort.signal.aborted)setError(cause instanceof Error?cause.message:'No se pudo completar tu pregunta.');setMessages(thread.slice(0,-1));setQuestion(content);}
    finally{sending.current=false;setPending(false);controller.current=null;}
  }
  function submit(event:FormEvent){event.preventDefault();void send(question);}
  const unavailable=status?.configured===false||!!statusError;
  return <section className="panel intelligence-chat" aria-label="Conversación con el asistente de IA">
    <header className="intelligence-chat-heading"><div className="intelligence-assistant-icon"><Sparkles size={24}/></div><div><span className="intelligence-kicker">TU ASISTENTE DE ANÁLISIS</span><h2>Una conversación para decidir mejor.</h2><p>Pregunta, compara y entiende el porqué de cada recomendación.</p></div><button type="button" className="secondary-button" disabled={pending||!messages.length} onClick={()=>{setMessages([]);setError('');setQuestion('');}}><RotateCcw size={15}/>Nueva conversación</button></header>
    <div className="intelligence-chat-context"><span>{symbol}</span><span>{provider==='demo'?'Modo educativo':provider==='alpaca'?'Datos Alpaca':'Webull Sandbox'}</span><span>{preferences.horizonSessions} sesiones</span><span>Solo modelos gratuitos</span><span>Capital: {preferences.capital.toLocaleString('es-MX',{style:'currency',currency:'USD',maximumFractionDigits:0})}</span><span>{status?.configured?'OpenRouter configurado':status?'Conexión pendiente':'Comprobando conexión…'}</span></div>
    {(unavailable)&&<div className="intelligence-setup" role="status"><strong>{statusError||'Conecta OpenRouter para empezar a conversar.'}</strong><p>Crea una clave en <a href="https://openrouter.ai/settings/keys" target="_blank" rel="noreferrer">OpenRouter</a>. Configura <code>OPENROUTER_API_KEY</code> en <code>.env.local</code> y reinicia el servidor. El propietario usa <code>INTELLIGENCE_OWNER_USER_ID</code> o el ID ya configurado del bróker.</p><p>Solo se envían tu conversación, tu perfil y un resumen del análisis al hacer una pregunta.</p></div>}
    <div className="intelligence-messages" role="log" aria-label="Historial de conversación" aria-live="polite" aria-relevant="additions">
      {!messages.length&&<div className="intelligence-chat-empty"><MessageSquare size={30}/><h3>¿Qué quieres entender hoy de {symbol}?</h3><p>Puedo ayudarte a interpretar el análisis, comparar estrategias y revisar qué encaja con tu capital y riesgo.</p><div className="intelligence-suggestions">{suggestions.map(text=><button type="button" key={text} disabled={pending} onClick={()=>{setQuestion(text);if(!unavailable&&status?.configured)void send(text);}}>{text}</button>)}</div></div>}
      {messages.map((message,index)=><article key={index} className={`intelligence-message intelligence-message-${message.role}`}><span className="intelligence-message-author">{message.role==='user'?'Tú':'TEPIC · Asistente'}</span><div className="intelligence-message-content">{message.content}</div>
        {message.truncated&&<div className="intelligence-partial-response" role="status"><p>La respuesta quedó incompleta por el límite del modelo.</p>{index===messages.length-1&&<button className="secondary-button" type="button" disabled={pending||unavailable} onClick={()=>void send('Continúa y completa tu respuesta anterior desde donde quedó, sin repetir lo ya explicado.')}>Continuar respuesta</button>}</div>}
        {message.role==='assistant'&&<><small>{message.asOf?`Evidencia al ${new Date(message.asOf).toLocaleString('es-MX',{timeZone:'America/New_York'})} ET`:'Respuesta educativa · sin datos de mercado verificados'} · {message.model}</small>{message.dataError&&<p className="intelligence-data-warning">Datos pendientes: {message.dataError}</p>}
        {message.recommendation&&<div className="intelligence-chat-recommendation"><span>Resultado verificado por el terminal</span><strong>{message.recommendation.title}</strong><p>{message.recommendation.reason}</p>{message.recommendation.best&&<button type="button" className="secondary-button" onClick={()=>onChoose(message.recommendation!.best!.strategy)}>Revisar estrategia</button>}</div>}</>}
      </article>)}
      {pending&&<div className="intelligence-thinking" role="status"><span/>Revisando tus datos y tu pregunta…</div>}<div ref={latest}/>
    </div>
    {error&&<p className="intelligence-chat-error" role="alert">{error} Tu pregunta está lista para reintentar.</p>}
    <form className="intelligence-composer" onSubmit={submit}><label htmlFor="intelligence-question">Tu pregunta sobre {symbol}</label><textarea id="intelligence-question" aria-label="Pregunta al asistente de IA" value={question} maxLength={4000} rows={3} placeholder={`Por ejemplo: ¿qué estrategia tendría sentido para ${symbol} con mi perfil y por qué?`} onChange={event=>setQuestion(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.nativeEvent.isComposing){event.preventDefault();if(!pending&&!unavailable)void send(question);}}}/><div><span>Enter para enviar · Shift + Enter para nueva línea</span>{pending?<button type="button" className="secondary-button" onClick={()=>controller.current?.abort()}><Square size={14}/>Detener</button>:<button type="submit" className="primary-button" disabled={!question.trim()||unavailable||!status?.configured}><Send size={16}/>Preguntar</button>}</div></form>
    <p className="intelligence-chat-footnote">Las sugerencias usan tu perfil y la evidencia disponible. Cada operación se revisa en la mesa de órdenes.</p>
  </section>;
}
