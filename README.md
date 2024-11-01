# About

Dumps all `<binary>` files to json using `<format>` files. It captures
enum value names and instance values. It does not handle ksy imports.

**Why?** The Kaitai Struct Web IDE parsing and export to json choke on large
files because of browser memory limits and the Kaitai Visualizer's `ksdump`
chokes on some of my formats that otherwise are compiled and iterated over just
fine using python or javascript. `ksdump.js` uses `json-stream-stringify` to
avoid maximum string length limits and uses `require-from-string` instead of
compiling and then writing out the parsers just to read them back in (which is
why it doesn't handle ksy imports).

On a Ryzen 5700G it is capable of parsing a 165MB binary file using a format
consisting of 200+ `id` fields having nested types and instanced values in ~4s
and writing out the 666MB compact json on a 980 Pro SSD in ~30s and formatting
to a 1.11GB file in ~78s.


## Usage

Usage: `npm install && node ksdump <format> <input> <outpath> [--format]`

The binary filename associated with a format is taken from the format's meta
fields as `${id}.${file-extension}`.

### Inputs

If `<format>` is a directory then `<binary>` must also be a directory. Each
`*.ksy` format file with a matching format meta associated filename will be
dumped.

If `<format>` is a file and `<binary>` is a file the format's meta associated
filename is ignored.

If `<format>` is a file and `<binary>` is a directory then the format's meta
associated filename is searched for in `${binary}`.

### Outputs

The json filename will be taken from the format's meta field as `${id}.json`
unless `<binary>` is a file, in which case it will be `${binary_stem}.json`.

Output is 'compact' by default, `--format` invokes `jq` to format. `jq` is
provided by `node-jq` and is located at `./node_modules/node-jq/bin/jq.exe`.
With `--format` a tmp file is created and `jq` is called equivalently to
`jq '.' tmp.json > formatted.json`.
