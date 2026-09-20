// Adapter from @openmeteo/file-reader 0.0.19 (GPL-2.0), with a live memory view.
import OmFileFormat from "@openmeteo/file-format-wasm";
import binary from "../assets/om_reader_wasm.web.wasm";
const DATA_TYPES = {
    DATA_TYPE_NONE: 0,
    DATA_TYPE_INT8: 1,
    DATA_TYPE_UINT8: 2,
    DATA_TYPE_INT16: 3,
    DATA_TYPE_UINT16: 4,
    DATA_TYPE_INT32: 5,
    DATA_TYPE_UINT32: 6,
    DATA_TYPE_INT64: 7,
    DATA_TYPE_UINT64: 8,
    DATA_TYPE_FLOAT: 9,
    DATA_TYPE_DOUBLE: 10,
    DATA_TYPE_STRING: 11,
    DATA_TYPE_INT8_ARRAY: 12,
    DATA_TYPE_UINT8_ARRAY: 13,
    DATA_TYPE_INT16_ARRAY: 14,
    DATA_TYPE_UINT16_ARRAY: 15,
    DATA_TYPE_INT32_ARRAY: 16,
    DATA_TYPE_UINT32_ARRAY: 17,
    DATA_TYPE_INT64_ARRAY: 18,
    DATA_TYPE_UINT64_ARRAY: 19,
    DATA_TYPE_FLOAT_ARRAY: 20,
    DATA_TYPE_DOUBLE_ARRAY: 21,
    DATA_TYPE_STRING_ARRAY: 22,
};
const HEADER_TYPES = {
    OM_HEADER_INVALID: 0,
    OM_HEADER_LEGACY: 1,
    OM_HEADER_READ_TRAILER: 2,
};
const ERROR_CODES = {
    ERROR_OK: 0,
};

const SIZEOF_DECODER=104;
function createWrappedModule(rawModule) {
    return {
        // Memory management functions
        _malloc: rawModule._malloc,
        _free: rawModule._free,
        setValue: rawModule.setValue,
        getValue: rawModule.getValue,
        get HEAPU8(){return rawModule.HEAPU8;},
        // Map all the C functions to their prefixed versions
        om_header_size: rawModule._om_header_size,
        om_header_type: rawModule._om_header_type,
        om_trailer_size: rawModule._om_trailer_size,
        om_trailer_read: rawModule._om_trailer_read,
        om_variable_init: rawModule._om_variable_init,
        om_variable_get_type: rawModule._om_variable_get_type,
        om_variable_get_compression: rawModule._om_variable_get_compression,
        om_variable_get_scale_factor: rawModule._om_variable_get_scale_factor,
        om_variable_get_add_offset: rawModule._om_variable_get_add_offset,
        om_variable_get_dimensions_count: rawModule._om_variable_get_dimensions_count,
        om_variable_get_dimensions_ptr: rawModule._om_variable_get_dimensions,
        om_variable_get_chunks_ptr: rawModule._om_variable_get_chunks,
        om_variable_get_name_ptr: rawModule._om_variable_get_name,
        om_variable_get_children_count: rawModule._om_variable_get_children_count,
        om_variable_get_children: rawModule._om_variable_get_children,
        om_variable_get_scalar: rawModule._om_variable_get_scalar,
        om_decoder_init: rawModule._om_decoder_init,
        om_decoder_init_index_read: rawModule._om_decoder_init_index_read,
        om_decoder_init_data_read: rawModule._om_decoder_init_data_read,
        om_decoder_read_buffer_size: rawModule._om_decoder_read_buffer_size,
        om_decoder_next_index_read: rawModule._om_decoder_next_index_read,
        om_decoder_next_data_read: rawModule._om_decoder_next_data_read,
        om_decoder_decode_chunks: rawModule._om_decoder_decode_chunks,
        // Constants
        ...HEADER_TYPES,
        ...ERROR_CODES,
        ...DATA_TYPES,
        // Additional info
        sizeof_decoder: SIZEOF_DECODER,
    };
}

let ready;export function readyWasm(){return ready??=OmFileFormat({instantiateWasm(imports,receive){const instance=new WebAssembly.Instance(binary,imports);receive(instance,binary);return instance.exports;}}).then(createWrappedModule);}
