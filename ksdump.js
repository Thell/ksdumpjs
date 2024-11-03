const fs = require('fs')
const fsPromises = require('fs').promises
const path = require('path')
const { JsonStreamStringify } = require('json-stream-stringify')
const KaitaiStruct = require('kaitai-struct')
const KaitaiStructCompiler = require('kaitai-struct-compiler')
const signalePkg = require('signale')
const yaml = require('yaml')

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

const toCamelCase = (str) => str.charAt(0).toLowerCase() + str.slice(1)

const toPascalCase = (str) => str.replace(/(^\w|_\w)/g, (match) => match.replace('_', '').toUpperCase())

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

const yamlImporter = {
  importYaml: function (name, mode) {
    console.log("  -> Import yaml called with name '" + name + "' and mode '" + mode + "'.")
    console.log(`parsing ${'test/formats/' + name + '.ksy'}`)
    const importFileBuffer = fs.readFileSync('test/formats/' + name + '.ksy', 'utf8')
    const importKsyContent = yaml.parse(importFileBuffer)
    return Promise.resolve(importKsyContent)
  }
}

async function generateJavascriptParser (ksyContent) {
  logger.generate(`${ksyContent.meta.id}`)

  const parserName = `${toPascalCase(ksyContent.meta.id)}.js`
  const compiledFiles = await KaitaiStructCompiler.compile('javascript', ksyContent, yamlImporter)

  const tempDir = './parsers'
  await fsPromises.mkdir(tempDir, { recursive: true })

  let ParserConstructor
  let enumNameMap = new Map()
  for (const [fileName, fileContent] of Object.entries(compiledFiles)) {
    try {
      const filePath = path.join(tempDir, fileName)
      await fsPromises.writeFile(filePath, fileContent, 'utf8')

      if (fileName === parserName) {
        const importedModule = require(path.resolve(filePath))
        ParserConstructor = importedModule[parserName.slice(0, -3)]

        const enumNames = Object.getOwnPropertyNames(ParserConstructor).filter((name) => {
          const value = ParserConstructor[name]
          return typeof value === 'object' && value !== null && typeof value._read !== 'function'
        })
        enumNameMap = new Map(enumNames.map(name => [toCamelCase(name), name]))
      }
    } catch (error) {
      logger.error(parserName)
      console.error('Error during import:', error)
      throw error
    }
  }

  if (ParserConstructor) {
    return { ParserConstructor, enumNameMap }
  } else {
    logger.error(parserName)
    throw new Error(`KaitaiStructCompiler output does not contain ${parserName}`)
  }
}

async function parseInputFile ({ ParserConstructor, enumNameMap }, binaryFile) {
  logger.parse(`${binaryFile}`)
  const inputBuffer = getBinaryBuffer(binaryFile)
  const parsed = new ParserConstructor(new KaitaiStruct.KaitaiStream(inputBuffer, 0))

  logger.populate(`${binaryFile}`)
  processParsedData(parsed, ParserConstructor, enumNameMap)

  logger.extract(`${binaryFile}`)
  const data = extractParsedData(parsed, binaryFile)
  return data
}

async function processParsedData (data, ParserConstructor, enumNameMap) {
  const processObject = (obj) => {
    instantiateInstanceData(obj)

    for (const [key, value] of Object.entries(obj)) {
      if (key.startsWith('_') && !key.startsWith('_m_')) continue
      const enumKey = enumNameMap.get(key)
      if (enumKey) {
        const enumValues = ParserConstructor[enumKey]
        obj[key] = { name: enumValues[value], value }
      } else if (value !== null && typeof value === 'object') {
        processParsedData(value, ParserConstructor, enumNameMap)
      }
    }
  }

  if (Array.isArray(data)) {
    data.forEach(datum => processParsedData(datum, ParserConstructor, enumNameMap))
  } else if (data !== null && typeof data === 'object') {
    processObject(data)
  }
}

async function exportToJson (parsedData, jsonFile, format = false) {
  const stringifyStream = new JsonStreamStringify(parsedData, removeNullChars, format ? 2 : 0)
  const outputStream = fs.createWriteStream(jsonFile)

  logger.export(`${jsonFile}`)
  return new Promise((resolve, reject) => {
    stringifyStream
      .pipe(outputStream)
      .on('finish', () => {
        logger.success(`${jsonFile}`)
        resolve()
      })
      .on('error', (error) => {
        logger.error(`${jsonFile}`)
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
        .then(({ ParserConstructor, enumNameMap }) => parseInputFile({ ParserConstructor, enumNameMap }, binaryFile))
        .then(parsedData => exportToJson(parsedData, outputFilePath, formatOption))
        .catch((error) => logger.error(`Skipped: ${error}`))
    } else {
      logger.skip(`${ksyContent.meta.id}.${ksyContent.meta['file-extension']} not found for format ${path.basename(ksyFile)}.`)
    }
  }

  console.log()
  logger.timeEnd('ksdump')
})()
