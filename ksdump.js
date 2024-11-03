import fs from 'fs'
import path from 'path'

import { JsonStreamStringify } from 'json-stream-stringify'
import KaitaiStruct from 'kaitai-struct'
import KaitaiStructCompiler from 'kaitai-struct-compiler'
import requireFromString from 'require-from-string'
import signalePkg from 'signale'
import yaml from 'yaml'

const { Signale } = signalePkg
const logger = new Signale({
  types: {
    export: {
      badge: '📤',
      label: 'Exporting:',
      color: 'cyan'
    },
    extract: {
      badge: '📤',
      label: 'Extracting parsed data:',
      color: 'cyan'
    },
    generate: {
      badge: '⚙️',
      label: 'Generating:',
      color: 'cyan'
    },
    parse: {
      badge: '🔍',
      label: 'Parsing binary:',
      color: 'cyan'
    },
    populate: {
      badge: '🔍',
      label: 'Populating enum/instance values:',
      color: 'cyan'
    },
    process: {
      label: 'Processing:',
      color: 'cyan'
    },
    skip: {
      badge: '⤵️',
      label: 'Skipping:',
      color: 'yellow'
    },
    success: {
      badge: '✅',
      label: 'Success',
      color: 'green'
    },
    error: {
      badge: '❌',
      label: 'Error',
      color: 'red'
    }
  }
})

const findBinaryFile = (directory, filename) => {
  const files = fs.readdirSync(directory, { withFileTypes: true })
  for (const file of files) {
    const fullPath = path.join(directory, file.name)
    if (file.isFile() && file.name === filename) {
      return fullPath
    } else if (file.isDirectory()) {
      const result = findBinaryFile(fullPath, filename)
      if (result) return result
    }
  }
  return null
}

const getBinaryFile = async (inputPath, ksyContent) => {
  const binaryFilename = `${ksyContent.meta.id}.${ksyContent.meta['file-extension']}`
  return fs.statSync(inputPath).isDirectory()
    ? findBinaryFile(inputPath, binaryFilename)
    : inputPath
}

const getBinaryBuffer = (binaryFile) => {
  const inputBinary = fs.readFileSync(binaryFile)
  return Buffer.from(inputBinary)
}

const getFilestem = (filepath) => {
  const filename = path.basename(filepath)
  const lastIndex = filename.lastIndexOf('.')
  return lastIndex > 0 ? filename.substring(0, lastIndex) : filename
}

const removeNullChars = (key, value) => {
  const nullChar = String.fromCharCode(0)
  return typeof value === 'string' ? value.replace(new RegExp(nullChar, 'g'), '') : value
}

const toPascalCase = (str) =>
  str.replace(/(^\w|_\w)/g, (match) => match.replace('_', '').toUpperCase())

const initializeParser = (parser) => {
  const GeneratedParser = requireFromString(parser)
  const parserName = Object.keys(GeneratedParser)[0]
  const ParserConstructor = GeneratedParser[parserName]

  const enumNames = Object.getOwnPropertyNames(ParserConstructor).filter((name) => {
    const value = ParserConstructor[name]
    return typeof value === 'object' && value !== null && typeof value._read !== 'function'
  })

  return { ParserConstructor, enumNames }
}

const instantiateInstanceData = (obj) => {
  // New properties prefixed with `_m_` are created at instantiation.
  const prototype = Object.getPrototypeOf(obj)
  if (prototype) {
    Object.getOwnPropertyNames(prototype).forEach((prop) => {
      if (!prop.startsWith('_') && obj[prop] !== undefined) {
        // Intentionally empty to trigger instantiation side effect.
      }
    })
  }
}

const extractParsedData = (data) => {
  if (Array.isArray(data)) {
    return data.map(extractParsedData)
  } else if (data !== null && typeof data === 'object') {
    return Object.keys(data).reduce((acc, key) => {
      if (key.startsWith('_m_')) {
        // Promote instance property to a properly named property.
        acc[key.slice(3)] = extractParsedData(data[key])
      } else if (!key.startsWith('_')) {
        acc[key] = extractParsedData(data[key])
      }
      return acc
    }, {})
  }
  return data
}

async function generateJavascriptParser (ksyContent) {
  logger.generate(`${ksyContent.meta.id}`)

  const compiler = KaitaiStructCompiler
  const compiled = await compiler.compile('javascript', ksyContent)

  const parserName = toPascalCase(ksyContent.meta.id) + '.js'
  const parserKey = Object.keys(compiled).find((key) => key === parserName)
  if (compiled[parserKey] === undefined) {
    logger.error(`${ksyContent.meta.id}`)
    console.log(`No match found for ${ksyContent.meta.id} in compiled format output!`)
  }
  return compiled[parserKey]
}

async function parseInputFile (parser, binaryFile) {
  logger.parse(`${binaryFile}`)

  const inputBuffer = getBinaryBuffer(binaryFile)
  const { ParserConstructor, enumNames } = initializeParser(parser)
  const parsed = new ParserConstructor(new KaitaiStruct.KaitaiStream(inputBuffer, 0))

  logger.populate(`${binaryFile}`)
  processParsedData(parsed, ParserConstructor, enumNames)

  logger.extract(`${binaryFile}`)
  const data = extractParsedData(parsed, binaryFile)
  return data
}

async function processParsedData (data, ParserConstructor, enumNames) {
  if (Array.isArray(data)) {
    data.forEach(datum => processParsedData(datum, ParserConstructor, enumNames))
  } else if (data !== null && typeof data === 'object') {
    instantiateInstanceData(data)
    // Populate enum value names and keep instance properties.
    for (const key in data) {
      if (key.startsWith('_') && !key.startsWith('_m_')) continue
      const capitalizedKey = key.charAt(0).toUpperCase() + key.slice(1)
      if (enumNames.includes(capitalizedKey)) {
        const enumValues = ParserConstructor[capitalizedKey]
        data[key] = { name: enumValues[data[key]], value: data[key] }
      } else {
        processParsedData(data[key], ParserConstructor, enumNames)
      }
    }
  }
};

async function exportToJson (parsedData, jsonFile, format = false) {
  const stringifyStream = new JsonStreamStringify(parsedData, removeNullChars, format ? 2 : 0)
  const outputStream = fs.createWriteStream(jsonFile)
  let once = true

  return new Promise((resolve, reject) => {
    stringifyStream
      .pipe(outputStream)
      .on('drain', () => {
        if (once) {
          logger.export(`${jsonFile}`)
          once = false
        }
      })
      .on('finish', () => {
        logger.success(`${jsonFile}`)
        resolve()
      })
      .on('error', (error) => {
        logger.error(`${jsonFile}`)
        logger.error('Error writing JSON file:', error)
        reject(error)
      })
  })
}

(async function main () {
  logger.time('ksdump')
  console.log()

  if (process.argv.length < 5) {
    console.log('Usage: node ksdump <format> <input> <outpath> [--format]')
    return
  }

  const [, , formatPath, inputPath, outputPath, formatFlag] = process.argv
  const formatOption = formatFlag === '--format'
  const parseYAML = (yamlFile) => yaml.parse(fs.readFileSync(yamlFile, 'utf-8'))

  const formatFiles = fs.statSync(formatPath).isDirectory()
    ? fs.readdirSync(formatPath).filter(file => file.endsWith('.ksy')).map(file => path.join(formatPath, file))
    : [formatPath]

  for (const ksyFile of formatFiles) {
    logger.process(`${ksyFile}`)

    const ksyContent = await parseYAML(ksyFile)
    const binaryFile = await getBinaryFile(inputPath, ksyContent)
    const outFile = `${fs.statSync(formatPath).isDirectory() ? ksyContent.meta.id : getFilestem(binaryFile)}.json`
    const outputFilePath = path.join(outputPath, outFile)

    if (binaryFile) {
      await generateJavascriptParser(ksyContent)
        .then(parser => parseInputFile(parser, binaryFile))
        .then(parsedData => exportToJson(parsedData, outputFilePath, formatOption))
    } else {
      logger.skip(`${ksyContent.meta.id}.${ksyContent.meta['file-extension']} not found for format ${path.basename(ksyFile)}.`)
    }
  }

  console.log()
  logger.timeEnd('ksdump')
})()
