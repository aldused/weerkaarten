// Retry only temporary transport failures. Keep the original request identity
// and cancellation; a missing run or invalid field must fail immediately.
export async function retryFetch(url,options={},fetcher=globalThis.fetch,{retries=2,timeoutMs=12000,delayMs=300}={}){
 const {signal,...rest}=options;
 for(let attempt=0;;attempt++){
  signal?.throwIfAborted();
  try{
   const timed=AbortSignal.timeout(timeoutMs),response=await fetcher(url,{...rest,signal:signal?AbortSignal.any([signal,timed]):timed});
   if(![408,429,500,502,503,504].includes(response.status)||attempt>=retries)return response;
   await response.body?.cancel();
  }catch(error){
   signal?.throwIfAborted();
   if(attempt>=retries||!(error instanceof TypeError||error.name==='TimeoutError'))throw error;
  }
  await new Promise((resolve,reject)=>{
   const abort=()=>{clearTimeout(timer);reject(signal.reason);};
   const timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve();},delayMs*(attempt+1));
   signal?.addEventListener('abort',abort,{once:true});
   if(signal?.aborted)abort();
  });
 }
}
