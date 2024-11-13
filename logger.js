import signalePkg from 'signale'

export const { Signale } = signalePkg

export const loggerOptions = {
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
