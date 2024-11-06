import fs from 'fs'
import path from 'path'
import { JsonStreamStringify } from 'json-stream-stringify'
import KaitaiStruct from 'kaitai-struct'
import KaitaiStructCompiler from 'kaitai-struct-compiler'
import signalePkg from 'signale'
import vm from 'vm'
import yaml from 'yaml'

const { Signale } = signalePkg
let logger = new Signale()
const loggerOptions = {
  types: {
    export: {
      badge: '📤',
      label: 'Exporting:',
      color: 'cyan',
      logLevel: 'info'
    },
    transform: {
      badge: '📤',
      label: 'Transforming:',
      color: 'cyan',
      logLevel: 'info'
    },
    generate: {
      badge: '⚙️',
      label: 'Generating:',
      color: 'cyan',
      logLevel: 'info'
    },
    parse: {
      badge: '🔍',
      label: 'Parsing binary:',
      color: 'cyan',
      logLevel: 'info'
    },
    process: {
      label: 'Processing:',
      color: 'cyan',
      logLevel: 'info'
    },
    skip: {
      badge: '⤵️',
      label: 'Skipping:',
      color: 'yellow',
      logLevel: 'warn'
    },
    success: {
      badge: '✅',
      label: 'Success',
      color: 'green',
      logLevel: 'info'
    },
    error: {
      badge: '❌',
      label: 'Error',
      color: 'red',
      logLevel: 'error'
    }
  }
}

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

const getBinaryFile = async (binaryPath, ksyContent) => {
  const binaryFilename = `${ksyContent.meta.id}.${ksyContent.meta['file-extension']}`
  return fs.statSync(binaryPath).isDirectory()
    ? findBinaryFile(binaryPath, binaryFilename)
    : binaryPath
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

function snakeToCamel (str) {
  return str.replace(/_([a-z])/g, (match, group1) => group1.toUpperCase())
}

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

function extractKsyEnumsMappings (ksyContent) {
  const enumsNameMap = new Map()
  const fieldEnumMap = new Map()

  function traverse (obj, currentPath = '') {
    if (typeof obj !== 'object' || obj === null) return

    for (const key in obj) {
      const newPath = currentPath ? `${currentPath}::${key}` : key
      const value = obj[key]

      if (key === 'enums' && typeof value === 'object') {
        for (const [enumName, enumValues] of Object.entries(value)) {
          const upperEnumValues = Object.fromEntries(
            Object.entries(enumValues).map(([k, v]) => {
              if (typeof v === 'object' && v !== null && 'id' in v) {
                return [k, v.id.toUpperCase()]
              }
              return [k, v.toUpperCase()]
            })
          )
          enumsNameMap.set(enumName, upperEnumValues)
        }
      } else if (key === 'enum' && typeof value === 'string') {
        const fieldName = obj.id || currentPath.split('::').pop()
        fieldEnumMap.set(snakeToCamel(fieldName), value)
      } else {
        traverse(value, newPath)
      }
    }
  }

  traverse(ksyContent)
  return { enumsNameMap, fieldEnumMap }
}

class ObjectType {
  static Primitive = 'Primitive'
  static Array = 'Array'
  static TypedArray = 'TypedArray'
  static Object = 'Object'
  static Undefined = 'Undefined'
}

function isUndef (obj) {
  return typeof obj === 'undefined'
}

function getObjectType (obj) {
  if (obj instanceof Uint8Array) {
    return ObjectType.TypedArray
  } else if (obj === null || typeof obj !== 'object') {
    return isUndef(obj) ? ObjectType.Undefined : ObjectType.Primitive
  } else if (Array.isArray(obj)) {
    return ObjectType.Array
  } else {
    return ObjectType.Object
  }
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
  const enumsMap = extractKsyEnumsMappings(ksyContent)

  if (ParserConstructor) {
    return { ParserConstructor, enumsMap }
  } else {
    logger.error(`${parserModuleName.slice(0, -3)}`)
    throw new Error(`KaitaiStructCompiler output does not contain ${parserModuleName}`)
  }
}

async function parseInputFile ({ ParserConstructor, enumsMap }, binaryFile) {
  logger.parse(`${binaryFile}`)

  const inputBuffer = getBinaryBuffer(binaryFile)
  let parsedData = ParserConstructor
  try {
    parsedData = new ParserConstructor(new KaitaiStruct.KaitaiStream(inputBuffer, 0))
  } catch (error) {
    logger.error(`${binaryFile}`)
    console.error('Error during parsing:', error)
    throw error
  }

  return { parsedData, enumsMap }
}

async function exportToJson (extractedData, jsonFile, format = false) {
  const stringifyStream = new JsonStreamStringify(extractedData, undefined, format ? 2 : 0)
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

async function transformParsedData ({ parsedData, enumsMap }, binaryFile) {
  logger.transform(`${binaryFile}`)
  const { enumsNameMap, fieldEnumMap } = enumsMap

  function transform (value) {
    if (value === null || value === undefined) return value

    switch (getObjectType(value)) {
      case ObjectType.Primitive:
        return value

      case ObjectType.Array:
        return value.map(item => transform(item))

      case ObjectType.TypedArray:
        // To hex or not to hex... that is the question.
        // return Array.from(value).map(byte => `${byte.toString(16).padStart(2, '0')}`)
        return Array.from(value)

      case ObjectType.Object: {
        instantiateInstanceData(value)

        return Object.keys(value).reduce((acc, key) => {
          if (key.startsWith('_') && !key.startsWith('_m_')) return acc

          const normalizedKey = key.startsWith('_m_') ? key.slice(3) : key
          const enumKey = fieldEnumMap.get(normalizedKey)
          if (enumKey) {
            const enumValues = enumsNameMap.get(enumKey)
            acc[normalizedKey] = { name: enumValues[value[key]], value: value[key] }
          } else {
            acc[normalizedKey] = transform(value[key])
          }
          return acc
        }, {})
      }

      default:
        return value
    }
  }

  const transformedData = transform(parsedData)
  return transformedData
}

(async function main () {
  if (process.argv.length < 5) {
    console.log('Usage: node ksdump <format> <binary> <outpath> [--format]')
    return
  }

  const loggerConfig = loggerOptions
  loggerConfig.logLevel = 'info' // TODO: make this a cli arg
  // loggerConfig.interactive = true
  logger = new Signale(loggerConfig)
  logger.time('ksdump')
  logger.log()

  const [, , formatPath, binaryPath, outPath, formatFlag] = process.argv
  const formatOption = formatFlag === '--format'
  const parseYAML = (yamlFile) => yaml.parse(fs.readFileSync(yamlFile, 'utf-8'))

  const formatFiles = fs.statSync(formatPath).isDirectory()
    ? fs.readdirSync(formatPath).filter(file => file.endsWith('.ksy')).map(file => path.join(formatPath, file))
    : [formatPath]

  for (const formatFile of formatFiles) {
    logger.process(`${formatFile}`)

    const ksyContent = await parseYAML(formatFile)
    const binaryFile = await getBinaryFile(binaryPath, ksyContent)
    if (binaryFile) {
      const outFile = `${fs.statSync(formatPath).isDirectory() ? ksyContent.meta.id : getFilestem(binaryFile)}.json`
      const outputFilePath = path.join(outPath, outFile)
      await generateParser(ksyContent, path.dirname(formatPath))
        .then(({ ParserConstructor, enumsMap }) => parseInputFile({ ParserConstructor, enumsMap }, binaryFile))
        .then(({ parsedData, enumsMap }) => transformParsedData({ parsedData, enumsMap }, binaryFile))
        .then(transformedData => exportToJson(transformedData, outputFilePath, formatOption))
        .catch((error) => logger.error(`Skipped: ${error}`))
    } else {
      logger.skip(`${ksyContent.meta.id}.${ksyContent.meta['file-extension']} not found for ${path.basename(formatFile)}`)
    }
  }

  logger.log()
  logger.timeEnd('ksdump')
})()
