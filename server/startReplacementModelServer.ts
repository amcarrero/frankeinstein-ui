import { startReplacementModelServer } from './replacementModelServer'

const instance = startReplacementModelServer()

const shutdown = async () => {
  try {
    await instance.close()
  } catch (error) {
    console.error('[replacement-model] Error while shutting down:', error)
  } finally {
    process.exit(0)
  }
}

process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)
