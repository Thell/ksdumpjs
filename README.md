# About

Dumps all `<binary>` files to json using `<format>` files.

It captures enum value names, instance values and imported formats. I am sure
it does not cover even a minor portion of Kaitai Struct's format features but it
should work for most formats.

Once you have a working format for your data (and perhaps are still left with
'unknowns') this makes it a breeze to import that data into a spreadsheet for
formatted exploration and filtering, or pretty much any other analysis tool.

**Why?** The Kaitai Struct Web IDE parsing and export to json choke on large
files because of browser memory limits and the Kaitai Visualizer's `ksdump`
chokes on some of my formats that otherwise are compiled and iterated over just
fine using python or javascript. This project uses `json-stream-stringify` to
avoid maximum string length limits.

On a Ryzen 5700G it is capable of parsing a 165MB binary file using a format
consisting of 200+ `id` fields having nested types and instanced values in ~3s
and writing out the 614MB compact json on a 980 Pro SSD in ~25s and the
formatted 1GB output in ~30s.

## Example

```
> node ksdump .\test\formats\zip.ksy .\test\samples\sample1.zip .\jsons --format
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
```ps
> ./jq -b -S . .\jsons\sample1.json > sorted_sample1.json
> ./jq -b -S . check_sample1.json > sorted_check_sample1.json
> git diff --no-index -b sorted_sample1.json sorted_check_sample1.json
> $?
True
```

## Usage

Usage: `npm install && node ksdump <format> <binary> <outpath> [--format]`

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
