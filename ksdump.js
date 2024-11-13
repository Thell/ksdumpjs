#!/usr/bin/env node

import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'
import fs from 'fs'
import { glob } from 'glob'
import main from './main.js'

function validatePath (path) {
  if (!fs.existsSync(path)) {
    throw new Error(`The path '${path}' does not exist.`)
  } else {
    return path
  }
}

yargs(hideBin(process.argv))
  .scriptName('ksdumpjs')
  .option('format', {
    alias: 'f',
    describe: 'Path to the Kaitai Struct format file or directory',
    type: 'path',
    default: './formats',
    coerce: validatePath,
    normalize: true
  })
  .option('binary', {
    describe: 'Path to the binary file or directory to parse',
    alias: 'b',
    type: 'string',
    default: './binaries',
    coerce: (binaryPath) => {
      if (/[*?[\]{}]/.test(binaryPath)) {
        return glob.sync(binaryPath)
      }
      return validatePath(binaryPath)
    }
  })
  .check((argv) => {
    const isFormatDir = fs.existsSync(argv.format) && fs.statSync(argv.format).isDirectory()
    const isBinaryFile = fs.existsSync(argv.binary) && fs.statSync(argv.binary).isFile()
    const isBinaryGlob = Array.isArray(argv.binary)

    if (isFormatDir && isBinaryFile) {
      throw new Error('Invalid: Cannot use a specific binary file with a directory of formats.')
    }
    if (isFormatDir && isBinaryGlob) {
      throw new Error('Invalid: Cannot use a glob pattern of binary files with a directory of formats.')
    }
    if (isBinaryGlob && argv.binary.length < 1) {
      throw new Error('Invalid: no files match binary glob pattern.')
    }

    return true
  })
  .group(['format', 'binary'], 'Input Options:')

  .option('out', {
    describe: 'Output path for generated JSONs',
    alias: 'o',
    type: 'string',
    default: './jsons'
  })
  .option('parser', {
    alias: 'p',
    describe: 'Output path for compiled parsers',
    type: 'string',
    default: './parsers'
  })
  .option('spaces', {
    alias: 's',
    describe: 'Format JSON (use compact format if not present)',
    type: 'number',
    coerce: (value) => {
      const hasSpacesFlag = process.argv.some(arg => arg.startsWith('--spaces') || arg === '-s')
      return hasSpacesFlag ? value : 0
    },
    default: 2
  })
  .group(['out', 'parser', 'spaces'], 'Output Options:')

  .option('log-level', {
    alias: 'l',
    describe: 'Set console log level',
    type: 'string',
    choices: ['info', 'warn', 'error', 'oneline'],
    default: 'info'
  })

  .command(
    '$0',
    'A tool to dump binary files into JSON using Kaitai Struct formats.',
    (yargs) => { },
    (argv) => {
      // console.log(argv)
      try {
        main(argv)
      } catch (error) {
        console.error(`Error: ${error.message}`)
        process.exit(1)
      }
    }
  )

  .example([
    ['$0', 'Dump all ksy associated binaries'],
    ['$0 -f ./my_formats -b ./inputs', 'Dump all ksy associated binaries'],
    ['$0 -f ./my.ksy', 'Dump a single associated binary'],
    ['$0 -f zip.ksy -b sample1.zip', 'Dump a specific binary'],
    ['$0 -f zip.ksy -b ./binaries/*.zip', 'Dump all zip binaries']
  ])

  // eslint-disable-next-line no-template-curly-in-string
  .epilogue('Associated binary names are from ksy meta as ${id}.${file-extension}\n' +
    'Associated binaries will be found in nested directories.\n' +
    'If an associated binary is not found it will be logged and skipped.\n' +
    '-f (format) must be a specific ksy when -b (binary) points to a specific file.')

  .showHelpOnFail(true)
  .help()
  .alias('help', 'h')

  .recommendCommands()
  .strict()
  .parse()
