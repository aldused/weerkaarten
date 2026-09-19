// A cached read may serve a map tile, point label and prefetch simultaneously.
// Cancel only the departing consumer; cancel the network read when none remain.
export function createSharedTask(work) {
  const controller = new AbortController();
  const task = {controller, users:0, settled:false};
  task.promise = Promise.resolve().then(() => {
    controller.signal.throwIfAborted();
    return work(controller.signal);
  }).finally(() => {task.settled=true;});
  // A cancelled queued read may have no remaining consumers.
  task.promise.catch(() => {});
  return task;
}
export function consumeTask(task, signal) {
  if(signal?.aborted)return Promise.reject(signal.reason);
  task.users++;
  return new Promise((resolve,reject) => {
    let finished=false;
    const finish=(fn,value)=>{
      if(finished)return;finished=true;
      signal?.removeEventListener('abort',abort);task.users--;
      fn(value);
      queueMicrotask(()=>{if(!task.settled&&!task.users)task.controller.abort();});
    };
    const abort=()=>finish(reject,signal.reason);
    signal?.addEventListener('abort',abort,{once:true});
    task.promise.then(value=>finish(resolve,value),error=>finish(reject,error));
  });
}
