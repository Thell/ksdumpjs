# About

This is a tool to dump binary files into JSON using Kaitai Struct formats.

It instantiates instance values, populates enum name values and loads format
imports.

It most likely does not cover many constructs that can be created using Kaitai
Struct but it should work for most formats. It serves as a lightweight
alternative to installing the Kaitai Struct Visualizer's ksdump.

[Kaitai Struct](https://kaitai.io/)  
[Kaitai Struct Visualizer](https://github.com/kaitai-io/kaitai_struct_visualizer)

## Install

`npm install -g ksdumpjs`

## Usage

**Concept**

Without any args `ksdumpjs` will use ksy format files in `./formats` to compile
parsers that are output to `./parsers` and then parse binary files in
`./binaries` based on the format's meta section using `${id}.{file-extension}`
to identify a matching binary for the format placing the JSON output in
`./jsons`.

**Arguments**

```
--format, -f: Path to a .ksy format file or directory of format files. Default is ./formats.
--binary, -b: Path to a binary file, directory, or glob pattern. Default is ./binaries.
--out, -o: Output path for JSON files. Default is ./jsons.
--parser, -p: Directory for compiled parsers. Default is ./parsers.
--spaces, -s: Number of spaces for formatted JSON output (use compact output if omitted).
```

**Details**

| Format     | Binary     | Result | Comment                                                                                          |
|------------|------------|--------|--------------------------------------------------------------------------------------------------|
| directory  | directory  | allow  | Use `.ksy` meta `{id}.{file-extension}` to find matches in binary                               |
| file       | directory  | allow  | Use `.ksy` meta `{id}.{file-extension}` to find match in binary                                 |
| file       | file       | allow  |                                                                                                |
| file       | glob       | allow  | Use format on each binary result of glob                                                        |
| directory  | file       | deny   | Ambiguous: cannot determine which `.ksy` file in the directory should match the binary file     |
| directory  | glob       | deny   | Ambiguous: cannot determine which `.ksy` file in the directory should match the binary files    |
| glob       | `<any>`    | deny   | Ambiguous: multiple `.ksy` files could match the binary files                                   |

Note: use forwardslash for paths, backslash will escape any glob tokens.

## Example

```
> node ksdump .\test\formats\zip.ksy .\test\samples\sample1.zip .\jsons -s
►  ksdump           Initialized timer...

Processing:      .\test\formats\zip.ksy
⚙️  Generating:      Zip
  -> Importing common/dos_datetime
     Parsing common/dos_datetime
🔍  Parsing binary:  .\test\samples\sample1.zip
📤  Transforming:    .\test\samples\sample1.zip
📤  Exporting:       jsons\sample1.json
✅  Success          jsons\sample1.json

[█] ksdump           Timer run for: 128ms
```

Verify correctness against Kaitai Struct Web-IDE exported json:

`jq` will sort the field order since the instantiated instance field orders
differs between ksdumpjs and the Kaitai Struct Web-IDE.

```ps
> ./jq -b -S . .\jsons\sample1.json > sorted_sample1.json
> ./jq -b -S . check_sample1.json > sorted_check_sample1.json
> git diff --no-index sorted_sample1.json sorted_check_sample1.json
> $?
True
```

## Why

ksdumpjs allows you to parse structured binary data into JSON for easier
integration with analysis tools, such as spreadsheets. Compared to the Kaitai
Struct Web IDE, which struggles with large files due to browser memory limits,
ksdumpjs uses json-stream-stringify to avoid memory constraints.

On a Ryzen 5700G, ksdumpjs can parse a 165MB binary file containing 200+ fields
with nested types in ~3 seconds, and output 614MB of JSON in ~25 seconds
(or 1GB formatted output in ~30 seconds).
