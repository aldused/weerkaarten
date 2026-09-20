import {harmonie} from './harmonie.mjs';
import {createFieldHandler} from './handler.mjs';
import {nativeReader} from './native-reader.mjs';
import {readyWasm} from './wasm.mjs';
const ecmwf=createFieldHandler({readField:async(url,variable,ranges,signal)=>nativeReader(await readyWasm(),undefined,signal).readVariable(url,variable,ranges,signal)});
export default {fetch:(request,env,ctx)=>new URL(request.url).pathname.startsWith('/harmonie/')?harmonie(request,env,ctx):ecmwf(request,env,ctx)};
