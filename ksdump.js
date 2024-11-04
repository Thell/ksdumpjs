import fs from 'fs'
import path from 'path'
import { JsonStreamStringify } from 'json-stream-stringify'
import KaitaiStruct from 'kaitai-struct'
import KaitaiStructCompiler from 'kaitai-struct-compiler'
import signalePkg from 'signale'
import vm from 'vm'
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

function createKaitaiLoader (parsersDir) {
  return function kaitaiLoader (moduleName) {
    if (moduleName === 'kaitai-struct/KaitaiStream') {
      return KaitaiStruct.KaitaiStream
    }

    const exportName = moduleName.split('/').pop()
    const modulePath = path.join(parsersDir, `${exportName}.js`)
    if (fs.existsSync(modulePath)) {
      const moduleContent = fs.readFileSync(modulePath, 'utf8')
      const modifiedContent = `${moduleContent}\n\nmodule.exports = typeof ${exportName} !== 'undefined' ? ${exportName} : {};`

      const moduleSandbox = { module: {}, exports: {}, require: createKaitaiLoader(parsersDir) }
      const moduleScript = new vm.Script(modifiedContent, { filename: modulePath })
      vm.createContext(moduleSandbox)
      moduleScript.runInContext(moduleSandbox)
      return moduleSandbox.exports
    }

    throw new Error(`Module '${moduleName}' not found`)
  }
}

function loadParser (parserModuleName, parsersDir) {
  const kaitaiLoader = createKaitaiLoader(parsersDir)
  const exportName = parserModuleName.slice(0, -3)
  const parserPath = path.join(parsersDir, parserModuleName)
  const parserContent = fs.readFileSync(parserPath, 'utf8')
  const modifiedParserContent = `${parserContent}\n\nmodule.exports = typeof ${exportName} !== 'undefined' ? ${exportName} : {};`

  const parserSandbox = { module: {}, exports: {}, require: kaitaiLoader }
  const parserScript = new vm.Script(modifiedParserContent, { filename: parserPath })
  vm.createContext(parserSandbox)
  parserScript.runInContext(parserSandbox)

  const exports = parserSandbox.exports
  const parserKey = Object.keys(exports).find(key => key.toLowerCase() === exportName.toLowerCase())
  return exports[parserKey]
}

async function compileParser (ksyContent, formatsDir) {
  const yamlImporter = {
    importYaml: function (name, mode) {
      logger.log(`  -> Importing ${name}`)
      logger.log(`     Parsing ${name}`)
      const importFileBuffer = fs.readFileSync(path.join(formatsDir, name + '.ksy'), 'utf8')
      const importKsyContent = yaml.parse(importFileBuffer)
      return Promise.resolve(importKsyContent)
    }
  }
  return KaitaiStructCompiler.compile('javascript', ksyContent, yamlImporter, false)
}

async function generateParser (ksyContent, formatsDir) {
  const parserModuleName = `${toPascalCase(ksyContent.meta.id)}.js`
  logger.generate(`${parserModuleName.slice(0, -3)}`)

  const parsersDir = './parsers' // TODO: make this a cli option where if not defined uses a tmpdir
  fs.mkdirSync(parsersDir, { recursive: true })

  const compiledFiles = await compileParser(ksyContent, formatsDir)
  for (const [fileName, fileContent] of Object.entries(compiledFiles)) {
    const filePath = path.join(parsersDir, fileName)
    fs.writeFileSync(filePath, fileContent)
  }
  const ParserConstructor = loadParser(parserModuleName, parsersDir)

  // Extract enum names if they exist
  const enumNames = Object.getOwnPropertyNames(ParserConstructor).filter((name) => {
    const value = ParserConstructor[name]
    return typeof value === 'object' && value !== null && typeof value._read !== 'function'
  })
  const enumNameMap = new Map(enumNames.map(name => [toCamelCase(name), name]))

  if (ParserConstructor) {
    return { ParserConstructor, enumNameMap }
  } else {
    logger.error(`${parserModuleName.slice(0, -3)}`)
    throw new Error(`KaitaiStructCompiler output does not contain ${parserModuleName}`)
  }
}

async function parseInputFile ({ ParserConstructor, enumNameMap }, binaryFile) {
  logger.parse(`${binaryFile}`)
  const inputBuffer = getBinaryBuffer(binaryFile)
  let parsed = ParserConstructor
  try {
    parsed = new ParserConstructor(new KaitaiStruct.KaitaiStream(inputBuffer, 0))
  } catch (error) {
    logger.error(`${binaryFile}`)
    console.error('Error during parsing:', error)
    throw error
  }

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
  logger.log()

  if (process.argv.length < 5) {
    console.log('Usage: node ksdump <format> <input> <outpath> [--format]')
    return
  }

  const [, , formatPath, inputPath, outPath, formatFlag] = process.argv
  const formatOption = formatFlag === '--format'
  const parseYAML = (yamlFile) => yaml.parse(fs.readFileSync(yamlFile, 'utf-8'))

  const formatFiles = fs.statSync(formatPath).isDirectory()
    ? fs.readdirSync(formatPath).filter(file => file.endsWith('.ksy')).map(file => path.join(formatPath, file))
    : [formatPath]

  for (const formatFile of formatFiles) {
    logger.process(`${formatFile}`)

    const ksyContent = await parseYAML(formatFile)
    const binaryFile = await getBinaryFile(inputPath, ksyContent)
    const outFile = `${fs.statSync(formatPath).isDirectory() ? ksyContent.meta.id : getFilestem(binaryFile)}.json`
    const outputFilePath = path.join(outPath, outFile)

    if (binaryFile) {
      await generateParser(ksyContent, path.dirname(formatPath))
        .then(({ ParserConstructor, enumNameMap }) => parseInputFile({ ParserConstructor, enumNameMap }, binaryFile))
        .then(parsedData => exportToJson(parsedData, outputFilePath, formatOption))
        .catch((error) => logger.error(`Skipped: ${error}`))
    } else {
      logger.skip(`${ksyContent.meta.id}.${ksyContent.meta['file-extension']} not found for ${path.basename(formatFile)}`)
    }
  }

  logger.log()
  logger.timeEnd('ksdump')
})()
