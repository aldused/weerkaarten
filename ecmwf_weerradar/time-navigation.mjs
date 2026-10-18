/** Coalesce pointer scrubbing to the last intended hour. Cached views bypass
 * the small dwell, while explicit clicks/keys always take effect immediately.
 */
export class TimeNavigation {
  constructor(select,{delayMs=65,cached=()=>false,setTimer=setTimeout,clearTimer=clearTimeout}={}){
    this.select=select;this.delayMs=delayMs;this.cached=cached;this.setTimer=setTimer;this.clearTimer=clearTimer;this.timer=null;this.pending=null;
  }
  cancel(){if(this.timer!==null)this.clearTimer(this.timer);this.timer=null;this.pending=null;}
  hover(index,pointerType){
    if(pointerType!=='mouse'||!Number.isInteger(index)||this.pending===index)return;
    this.cancel();this.pending=index;
    const commit=()=>{this.timer=null;this.pending=null;this.select(index);};
    if(this.cached(index))commit();else this.timer=this.setTimer(commit,this.delayMs);
  }
}
export function isTimeNavigationKey(event){
  if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)||event.altKey||event.ctrlKey||event.metaKey||event.shiftKey||event.isComposing)return false;
  const target=event.target;
  const editor=target?.closest?.('input,select,textarea,dialog,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="combobox"]');
  return !editor||editor.id==='time-slider';
}
