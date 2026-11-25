export type ChartWindow={start:number;end:number};

/** End is exclusive. Only the viewport changes; source rows are never resampled here. */
export function fitChartWindow(total:number,window:ChartWindow,minimum=8):ChartWindow{
  if(total<=0)return {start:0,end:0};
  const count=Math.min(total,Math.max(Math.min(total,minimum),Math.round(window.end-window.start)));
  const start=Math.max(0,Math.min(total-count,Math.round(window.start)));
  return {start,end:start+count};
}

export function zoomChartWindow(total:number,window:ChartWindow,factor:number,anchor=.5,minimum=8):ChartWindow{
  const current=fitChartWindow(total,window,minimum);
  if(!total)return current;
  const count=current.end-current.start;
  const next=Math.max(Math.min(minimum,total),Math.min(total,Math.round(count*factor)));
  const fraction=Math.max(0,Math.min(1,anchor));
  const focus=current.start+(count-1)*fraction;
  const start=Math.round(focus-(next-1)*fraction);
  return fitChartWindow(total,{start,end:start+next},minimum);
}

export function panChartWindow(total:number,window:ChartWindow,start:number,minimum=8):ChartWindow{
  return fitChartWindow(total,{start,end:start+window.end-window.start},minimum);
}
