import {createFieldHandler} from './handler.mjs';
import {nativeReader} from './native-reader.mjs';
import {readyWasm} from './wasm.mjs';
export default {fetch:createFieldHandler({readField:async(url,variable,ranges,signal)=>nativeReader(await readyWasm(),undefined,signal).readVariable(url,variable,ranges,signal)})};
