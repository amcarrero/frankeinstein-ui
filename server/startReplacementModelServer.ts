import { createSliderRepository } from './sliderRepository.js'
import { startReplacementModelServer } from './replacementModelServer.js'

const sliderRepository = await initializeSliderRepository()

const instance = startReplacementModelServer({ sliderRepository })

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

async function initializeSliderRepository() {
  const maxAttempts = Number(process.env.SLIDER_STORAGE_RETRY_ATTEMPTS ?? 5)
  const baseDelayMs = Number(process.env.SLIDER_STORAGE_RETRY_DELAY_MS ?? 1000)

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const repository = await createSliderRepository()
      console.info('[replacement-model] Slider storage initialized.')
      return repository
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown initialization error'
      if (attempt < maxAttempts) {
        const delayMs = baseDelayMs * attempt
        console.warn(
          `[replacement-model] Slider storage init failed (attempt ${attempt}/${maxAttempts}): ${message}. Retrying in ${delayMs}ms.`
        )
        await delay(delayMs)
        continue
      }
      console.warn(
        `[replacement-model] Slider storage disabled after ${maxAttempts} attempts: ${message}`
      )
    }
  }

  return null
}

const delay = (ms: number): Promise<void> =>
  new Promise(resolve => {
    setTimeout(resolve, ms)
  })
