import {easternTime} from '../../../features/research/contract-terms.ts';

const dateAt=(time:number)=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(time));
const day=(year:number,month:number,date:number)=>new Date(Date.UTC(year,month-1,date)).toISOString().slice(0,10);
const nth=(year:number,month:number,weekday:number,n:number)=>{const first=new Date(Date.UTC(year,month-1,1)).getUTCDay();return day(year,month,1+(weekday-first+7)%7+(n-1)*7);};
const observed=(year:number,month:number,date:number)=>{const t=Date.UTC(year,month-1,date),w=new Date(t).getUTCDay();return new Date(t+(w===6?-1:w===0?1:0)*86400000).toISOString().slice(0,10);};
function goodFriday(year:number){const a=year%19,b=Math.floor(year/100),c=year%100,d=Math.floor(b/4),e=b%4,f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3),h=(19*a+b-d-g+15)%30,i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451),month=Math.floor((h+l-7*m+114)/31),date=(h+l-7*m+114)%31+1;return new Date(Date.UTC(year,month-1,date)-2*86400000).toISOString().slice(0,10);}

/** Published NYSE regular-session rules, including DST and scheduled early closes.
 * Fresh provider quotes and provider preview remain mandatory before sending;
 * this calculated calendar cannot certify emergency exchange closures.
 */
export function webullSession(date:string):{open:number;close:number}|null{
  const t=Date.parse(date+'T12:00:00Z'),year=Number(date.slice(0,4)),weekday=new Date(t).getUTCDay();
  if(!Number.isFinite(t)||weekday===0||weekday===6)return null;
  const memorial=new Date(Date.UTC(year,5,0));while(memorial.getUTCDay()!==1)memorial.setUTCDate(memorial.getUTCDate()-1);
  // NYSE does not observe a Saturday New Year's Day on the prior Friday.
  const newYear=new Date(Date.UTC(year,0,1)).getUTCDay()===6?day(year,1,1):observed(year,1,1);
  const holidays=[newYear,nth(year,1,1,3),nth(year,2,1,3),goodFriday(year),memorial.toISOString().slice(0,10),...(year>=2022?[observed(year,6,19)]:[]),observed(year,7,4),nth(year,9,1,1),nth(year,11,4,4),observed(year,12,25)];
  if(holidays.includes(date))return null;
  const thanksgiving=nth(year,11,4,4),blackFriday=new Date(Date.parse(thanksgiving)+86400000).toISOString().slice(0,10);
  const early=date===blackFriday||date===day(year,12,24)||date===day(year,7,3)&&weekday<5;
  return {open:Date.parse(easternTime(date,'09:30:00')!),close:Date.parse(easternTime(date,early?'13:00:00':'16:00:00')!)};
}
export function webullMarketOpen(time=Date.now()):boolean{const session=webullSession(dateAt(time));return !!session&&time>=session.open&&time<session.close;}
export function webullQuoteUsable(at:string|null,received:number,maxAge=3600000):boolean{
  if(!at)return false;const time=Date.parse(at);if(!Number.isFinite(time)||time>received)return false;
  if(received-time<=maxAge)return true;
  // Only the immediately preceding completed session is usable for analysis.
  // It keeps its original timestamp; execution uses the stricter F5 checks.
  const today=webullSession(dateAt(received));if(today&&received>=today.open&&received<today.close)return false;
  for(let offset=0;offset<8;offset++){
    const date=dateAt(received-offset*86400000),session=webullSession(date);
    if(session&&session.close<=received)return time>=session.close-maxAge&&time<=session.close+60000;
  }
  return false;
}
