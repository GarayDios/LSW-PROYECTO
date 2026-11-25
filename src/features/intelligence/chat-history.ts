type ChatMessage={role:'user'|'assistant';content:string};

/** Keep the latest question and a bounded tail, even after a long or partial answer. */
export function assistantMessageHistory(messages:readonly ChatMessage[]):ChatMessage[]{
  const result:ChatMessage[]=[];
  const encoder=new TextEncoder();let bytes=0;
  for(const message of messages.slice(-19).toReversed()){
    const marker='[Inicio omitido por espacio; se conserva el final del mensaje.]\n';
    const content=message.role==='assistant'&&message.content.length>4000
      ?marker+message.content.slice(-(4000-marker.length)):message.content.slice(0,4000);
    const size=encoder.encode(content).length;
    if(bytes+size>24000)break;
    result.unshift({role:message.role,content});bytes+=size;
  }
  return result;
}
