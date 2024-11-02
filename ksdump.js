import fs from "fs";
import path from "path";
import { execSync } from 'child_process';

import { JsonStreamStringify } from 'json-stream-stringify';
import KaitaiStruct from "kaitai-struct";
import KaitaiStructCompiler from "kaitai-struct-compiler";
import "node-jq";
import require_from_string from "require-from-string";
import signale_pkg from 'signale';
import yaml from "yaml";


const { Signale } = signale_pkg;
const logger = new Signale({
    types: {
        export: {
            badge: '📤',
            label: 'Exporting',
            color: 'cyan',
        },
        format: {
            badge: '📝',
            label: 'Formatting with jq:',
            color: 'cyan',
        },
        generate: {
            badge: '⚙️',
            label: 'Generating:',
            color: 'cyan',
        },
        parse: {
            badge: '🔍',
            label: 'Parsing binary:',
            color: 'cyan',
        },
        populate: {
            badge: '🔍',
            label: 'Populating enum/instance values:',
            color: 'cyan',
        },
        process: {
            label: 'Processing:',
            color: 'cyan',
        },
        skip: {
            badge: '⤵️',
            label: 'Skipping:',
            color: 'green',
        },
        success: {
            badge: '✅',
            label: 'Success',
            color: 'green',
        },
        error: {
            badge: '❌',
            label: 'Error',
            color: 'red',
        },
    },
});


function getFilestem(filepath) {
    const filename = path.basename(filepath);
    const lastIndex = filename.lastIndexOf(".");
    return lastIndex > 0 ? filename.substring(0, lastIndex) : filename;
}

async function generateJavascriptParser(ksyContent) {
    logger.generate(`${ksyContent.meta.id}`);

    const toPascalCase = (str) =>
        str.replace(/(^\w|_\w)/g, (match) => match.replace('_', '').toUpperCase());

    const compiler = KaitaiStructCompiler;
    const compiled = await compiler.compile("javascript", ksyContent);

    const parserName = toPascalCase(ksyContent.meta.id) + ".js";
    const parserKey = Object.keys(compiled).find((key) => key === parserName);
    if (compiled[parserKey] == undefined) {
        logger.error(`${ksyContent.meta.id}`);
        console.log(`No match found for ${ksyContent.meta.id} in compiled format output!`);
    }
    return compiled[parserKey];
}

async function parseInputFile(parser, binaryFile) {
    logger.parse(`${binaryFile}`);
    const inputBinary = fs.readFileSync(binaryFile);
    const inputBuffer = Buffer.from(inputBinary);
    const inputStream = new KaitaiStruct.KaitaiStream(inputBuffer, 0);

    const GeneratedParser = require_from_string(parser);
    const parserName = Object.keys(GeneratedParser)[0];
    const ParserConstructor = GeneratedParser[parserName];
    const parsed = new ParserConstructor(inputStream);

    const enumNames = Object.getOwnPropertyNames(ParserConstructor).filter((name) => {
        const value = ParserConstructor[name];
        return typeof value === "object" && value !== null && typeof value._read !== "function";
    });

    const processParsedData = (data) => {
        if (Array.isArray(data)) {
            data.forEach(processParsedData);
        } else if (data !== null && typeof data === "object") {
            // Instantiate instance members, these virtual properties create
            // new properties prefixed with `_m_`.
            const prototype = Object.getPrototypeOf(data);
            if (prototype) {
                Object.getOwnPropertyNames(prototype).forEach((prop) => {
                    if (!prop.startsWith('_')) {
                        const _ = data[prop];
                    }
                });
            }

            // Populate enum value names, perhaps even in an instantiated instance.
            for (const key in data) {
                if (key.startsWith("_") && !key.startsWith("_m_")) continue;
                const capitalizedKey = key.charAt(0).toUpperCase() + key.slice(1);
                if (enumNames.includes(capitalizedKey)) {
                    const enumValues = ParserConstructor[capitalizedKey];
                    data[key] = { name: enumValues[data[key]], value: data[key] };
                } else {
                    processParsedData(data[key]);
                }
            }
        }
    };

    logger.populate(`${binaryFile}`);
    processParsedData(parsed);

    return parsed;
}

async function exportToJson(parsedData, jsonFile, format = false) {
    logger.export(`${jsonFile}`);

    const filterObject = (obj) => {
        if (Array.isArray(obj)) {
            return obj.map(filterObject);
        } else if (obj !== null && typeof obj === 'object') {
            return Object.keys(obj).reduce((acc, key) => {
                if (key.startsWith('_m_')) {
                    // Instantiated instance member.
                    acc[key.slice(3)] = filterObject(obj[key]);
                } else if (!key.startsWith('_')) {
                    acc[key] = filterObject(obj[key]);
                }
                return acc;
            }, {});
        } else {
            return obj;
        }
    };

    function removeNullChars(key, value) {
        if (typeof value === 'string') {
            return value.replace(/\u0000/g, '');
        }
        return value;
    }

    const filteredData = filterObject(parsedData);
    const stringifyStream = new JsonStreamStringify(filteredData, removeNullChars);
    const outputStream = fs.createWriteStream(jsonFile);


    return new Promise((resolve, reject) => {
        stringifyStream
            .pipe(outputStream)
            .on('finish', async () => {
                if (format) {
                    try {
                        logger.format(`${jsonFile}`);
                        const tmpFile = `${jsonFile}.tmp`;
                        fs.renameSync(jsonFile, tmpFile);

                        const jqPath = "./node_modules/node-jq/bin/jq.exe";
                        const command = `"${jqPath}" . "${tmpFile}" > "${jsonFile}"`;
                        execSync(command, { stdio: 'inherit' });

                        fs.unlinkSync(tmpFile);
                        logger.success(`${jsonFile}`);
                        console.log();
                    } catch (error) {
                        logger.error("Error formatting JSON:", error);
                        return reject(error);
                    }
                } else {
                    logger.success(`${jsonFile}`);
                    console.log();

                }
                resolve();
            })
            .on('error', error => {
                logger.error("Error writing JSON file:", error);
                reject(error);
            });
    });
}

const findBinaryFile = (directory, filename) => {
    const files = fs.readdirSync(directory, { withFileTypes: true });
    for (const file of files) {
        const fullPath = path.join(directory, file.name);
        if (file.isFile() && file.name === filename) {
            return fullPath;
        } else if (file.isDirectory()) {
            const result = findBinaryFile(fullPath, filename);
            if (result) return result;
        }
    }
    return null;
};

(async function main() {
    logger.time('ksdump');
    console.log();

    if (process.argv.length < 5) {
        console.log("Usage: node ksdump <format> <input> <outpath> [--format]");
        return;
    }

    const [, , formatPath, inputPath, outputPath, formatFlag] = process.argv;
    const formatOption = formatFlag === "--format";
    const parseYAML = (yamlFile) => yaml.parse(fs.readFileSync(yamlFile, 'utf-8'));

    logger.process(`${formatPath}`);
    const promises = [];
    if (fs.statSync(formatPath).isDirectory()) {
        const ksyFiles = fs.readdirSync(formatPath).filter(file => file.endsWith(".ksy"));
        for (const ksyFile of ksyFiles) {
            const ksyContent = await parseYAML(path.join(formatPath, ksyFile));
            const parser = await generateJavascriptParser(ksyContent);
            if (parser == undefined) continue;

            const binaryFilename = `${ksyContent.meta.id}.${ksyContent.meta["file-extension"]}`;
            const binaryFile = findBinaryFile(inputPath, binaryFilename);
            if (!binaryFile) {
                logger.skip(`${binaryFilename} not found for format ${ksyFile}.`);
                continue;
            }
            const parsedData = await parseInputFile(parser, binaryFile);
            promises.push(exportToJson(parsedData, path.join(outputPath, `${ksyContent.meta.id}.json`), formatOption));
        };
    } else {
        const ksyContent = await parseYAML(formatPath);
        const parser = await generateJavascriptParser(ksyContent);
        if (parser != undefined) {
            const binaryFilename = `${ksyContent.meta.id}.${ksyContent.meta["file-extension"]}`;
            const binaryFile = fs.statSync(inputPath).isDirectory()
                ? findBinaryFile(inputPath, binaryFilename)
                : inputPath;
            if (!binaryFile) {
                logger.skip(`${binaryFilename} not found.`);
                return;
            }
            const parsedData = await parseInputFile(parser, binaryFile);
            promises.push(exportToJson(parsedData, path.join(outputPath, `${getFilestem(binaryFile)}.json`), formatOption));
        }
    }

    await Promise.all(promises);
    logger.timeEnd('ksdump');
})();
