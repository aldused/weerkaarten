/** A loaded frame can stay hidden for instant back/forward navigation.
 * Its immutable time/run and full viewport/settings key travel with its layers.
 */
export function mayRetainFrame(frame,currentViewKey,isLoaded){
  return !!frame && ['weather','significant'].includes(frame.mode) &&
    frame.viewKey===currentViewKey && frame.ids.length>0 &&
    (frame.variables||[]).every(variable=>frame.ids.some(id=>id.endsWith('-'+variable))) && frame.ids.every(isLoaded);
}
