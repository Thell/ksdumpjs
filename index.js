if (process.argv.length < 4) {
    console.log('Usage: node index.js <formatYaml> <inputBinary>');
    return;
}

var yamlFn = process.argv[2];
var inputFn = process.argv[3];

var fs = require("fs");
var KaitaiStructCompiler = require("kaitai-struct-compiler");
var KaitaiStruct = require("kaitai-struct");
var KaitaiStream = KaitaiStruct.KaitaiStream;
var yamljs = require("yamljs");

