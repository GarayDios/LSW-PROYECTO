"use client";
import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {fitChartWindow,panChartWindow,zoomChartWindow,type ChartWindow} from '../chart-zoom';

export function useChartZoom<T extends {time:number}>(rows:readonly T[],identity:string,minimum=8,focusTime?:number){
  const key=`${identity}|${rows[0]?.time}|${rows.at(-1)?.time}|${rows.length}`;
  const [selection,setSelection]=useState<{key:string;window:ChartWindow}|null>(null);
  const window=fitChartWindow(rows.length,selection?.key===key?selection.window:{start:0,end:rows.length},minimum);
  const focusIndex=focusTime===undefined?-1:rows.findIndex(row=>row.time===focusTime);
  const change=useCallback((factor:number,anchor?:number)=>{
    setSelection(current=>{
      const range=fitChartWindow(rows.length,current?.key===key?current.window:{start:0,end:rows.length},minimum);
      const fraction=anchor??(focusIndex>=range.start&&focusIndex<range.end?(focusIndex-range.start)/Math.max(1,range.end-range.start-1):.5);
      return {key,window:zoomChartWindow(rows.length,range,factor,fraction,minimum)};
    });
  },[key,rows.length,minimum,focusIndex]);
  function pan(start:number){setSelection({key,window:panChartWindow(rows.length,window,start,minimum)});}
  // Selecting a different date reveals that point without undoing the chosen zoom.
  useEffect(()=>{
    if(focusIndex<0)return;
    setSelection(current=>{
      if(current?.key!==key)return current;
      const range=fitChartWindow(rows.length,current.window,minimum);
      if(focusIndex>=range.start&&focusIndex<range.end)return current;
      const count=range.end-range.start,start=focusIndex<range.start?focusIndex:focusIndex-count+1;
      return {key,window:panChartWindow(rows.length,range,start,minimum)};
    });
  },[focusIndex,key,minimum,rows.length]);
  const visible=useMemo(()=>rows.slice(window.start,window.end),[rows,window.start,window.end]);
  return {visible,start:window.start,end:window.end,total:rows.length,count:window.end-window.start,
    isZoomed:window.end-window.start<rows.length,canZoomIn:window.end-window.start>Math.min(minimum,rows.length),
    canZoomOut:window.end-window.start<rows.length,change,pan,reset:()=>setSelection(null)};
}

/** Native listener avoids passive-wheel warnings and leaves ordinary page scrolling alone. */
export function useChartWheelZoom(change:(factor:number,anchor?:number)=>void,left:number,right:number){
  const ref=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    const surface=ref.current;if(!surface)return;
    const wheel=(event:WheelEvent)=>{
      if(!event.ctrlKey||event.deltaY===0)return;
      const matrix=surface.querySelector('svg')?.getScreenCTM();if(!matrix)return;
      const point=new DOMPoint(event.clientX,event.clientY).matrixTransform(matrix.inverse());
      const anchor=Math.max(0,Math.min(1,(point.x-left)/(right-left)));
      event.preventDefault();change(event.deltaY<0?.7:1/.7,anchor);
    };
    surface.addEventListener('wheel',wheel,{passive:false});
    return()=>surface.removeEventListener('wheel',wheel);
  },[change,left,right]);
  return ref;
}
