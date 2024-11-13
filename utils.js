import fs from 'fs'
import path from 'path'
import yaml from 'yaml'

export function findFile (directory, filename) {
  const files = fs.readdirSync(directory, { withFileTypes: true })
  for (const file of files) {
    const fullPath = path.join(directory, file.name)
    if (file.isFile() && file.name === filename) {
      return fullPath
    } else if (file.isDirectory()) {
      const result = findFile(fullPath, filename)
      if (result) return result
    }
  }
  return null
}

export async function getBinaryFile (binaryPath, ksyContent) {
  const binaryFilename = `${ksyContent.meta.id}.${ksyContent.meta['file-extension']}`
  return fs.statSync(binaryPath).isDirectory()
    ? findFile(binaryPath, binaryFilename)
    : binaryPath
}

export function getFilestem (filepath) {
  const fileExt = path.extname(filepath)
  return path.basename(filepath, fileExt)
}

export function snakeToCamel (str) {
  return str.replace(/_([a-z])/g, (match, group1) => group1.toUpperCase())
}

export function toPascalCase (str) {
  return str.replace(/(^\w|_\w)/g, (match) => match.replace('_', '').toUpperCase())
}

export function parseYAML (yamlFile) {
  return yaml.parse(fs.readFileSync(yamlFile, 'utf-8'))
}
