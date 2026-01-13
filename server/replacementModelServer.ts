import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { WebSocketServer, type WebSocket, type RawData } from 'ws'

import type { SliderRepository, SliderSubmission } from './sliderRepository.js'

const DEFAULT_PORT = 43110
const WS_PATH = '/replacement-model'
const SLIDER_PATH = `${WS_PATH}/slider-values`
const JSON_MIME = 'application/json'

interface ReplacementModelOverrides {
  modelPath?: string
  scale?: number
  rotation?: number
  elevation?: number
  visible?: boolean
  cleared?: boolean
}

type ReplacementModelCommand =
  | { type: 'set-model'; payload: ReplacementModelOverrides }
  | { type: 'clear-model' }
  | { type: 'get-model' }

type ReplacementModelServerMessage =
  | { type: 'model-update'; payload: ReplacementModelOverrides | null }
  | { type: 'error'; message: string }

interface ReplacementModelServerInstance {
  port: number
  close: () => Promise<void>
  getOverride: () => ReplacementModelOverrides | null
}

interface ReplacementServerOptions {
  port?: number
  sliderRepository?: SliderRepository | null
}

const corsHeaders = Object.freeze({
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
})

let activeInstance: ReplacementModelServerInstance | null = null

export function startReplacementModelServer(
  options?: ReplacementServerOptions
): ReplacementModelServerInstance {
  if (activeInstance != null) {
    return activeInstance
  }

  const port = resolvePort(options?.port)
  let override: ReplacementModelOverrides | null = null
  const sliderRepository = options?.sliderRepository ?? null

  const httpServer = createServer(async (request, response) => {
    try {
      await handleHttpRequest(request, response)
    } catch (error) {
      respondJson(response, 500, {
        error: error instanceof Error ? error.message : 'Unknown server error'
      })
    }
  })

  const wss = new WebSocketServer({ server: httpServer, path: WS_PATH })

  wss.on('connection', socket => {
    safeSend(socket, serialize({ type: 'model-update', payload: override }))

    socket.on('message', data => {
      try {
        const command = parseCommand(data)
        applyCommand(command, socket)
      } catch (error) {
        safeSend(
          socket,
          serialize({
            type: 'error',
            message:
              error instanceof Error ? error.message : 'Invalid command payload'
          })
        )
      }
    })
  })

  const handleHttpRequest = async (
    request: IncomingMessage,
    response: ServerResponse
  ): Promise<void> => {
    if (request.url == null) {
      respondJson(response, 404, { error: 'Not found' })
      return
    }

    if (request.method === 'OPTIONS') {
      respondOptions(response)
      return
    }

    const url = parseRequestUrl(request.url)

    if (url.pathname === WS_PATH) {
      await handleOverrideRequest(request, response)
      return
    }

    if (url.pathname === SLIDER_PATH) {
      await handleSliderSubmission(request, response)
      return
    }

    respondJson(response, 404, { error: 'Not found' })
  }

  const handleOverrideRequest = async (
    request: IncomingMessage,
    response: ServerResponse
  ): Promise<void> => {
    if (request.method === 'GET') {
      respondJson(response, 200, { override })
      return
    }

    if (request.method === 'DELETE') {
      clearOverride()
      respondJson(response, 204)
      return
    }

    if (request.method === 'POST') {
      const body = await readBody(request)
      let commandPayload: unknown
      try {
        commandPayload = JSON.parse(body)
      } catch {
        respondJson(response, 400, { error: 'Invalid JSON body' })
        return
      }

      try {
        const overrides = normalizeOverrides(commandPayload)
        if (overrides.modelPath === 'clear' || overrides.cleared === true) {
          clearOverride()
          respondJson(response, 204)
          return
        }
        if (Object.keys(overrides).length === 0) {
          respondJson(response, 400, {
            error: 'At least one override field must be provided'
          })
          return
        }
        const previousVisible = override?.visible
        const shouldRestoreVisibility =
          overrides.modelPath != null &&
          overrides.modelPath !== 'clear' &&
          !('visible' in overrides)
        const nextOverride: ReplacementModelOverrides = {
          ...(override ?? {}),
          ...overrides
        }
        if (shouldRestoreVisibility) {
          nextOverride.visible = true
        } else if (!('visible' in overrides) && previousVisible === false) {
          delete nextOverride.visible
        }
        if (!('cleared' in overrides)) {
          delete nextOverride.cleared
        }
        override = nextOverride
        broadcastUpdate()
        respondJson(response, 204)
      } catch (error) {
        respondJson(response, 400, {
          error:
            error instanceof Error ? error.message : 'Invalid override payload'
        })
      }
      return
    }

    respondJson(response, 405, { error: 'Unsupported method' })
  }

  const handleSliderSubmission = async (
    request: IncomingMessage,
    response: ServerResponse
  ): Promise<void> => {
    if (request.method !== 'POST') {
      respondJson(response, 405, { error: 'Unsupported method' })
      return
    }

    const body = await readBody(request)
    let payload: unknown
    try {
      payload = JSON.parse(body)
    } catch {
      respondJson(response, 400, { error: 'Invalid JSON body' })
      return
    }

    let submission: SliderSubmission
    try {
      submission = normalizeSliderSubmission(payload)
    } catch (error) {
      respondJson(response, 400, {
        error: error instanceof Error ? error.message : 'Invalid payload'
      })
      return
    }

    if (sliderRepository == null) {
      respondJson(response, 503, {
        error: 'Slider submission storage not configured'
      })
      return
    }

    try {
      await sliderRepository.saveSliderSubmission(submission)
    } catch (error) {
      respondJson(response, 500, {
        error:
          error instanceof Error
            ? error.message
            : 'Failed to persist slider submission'
      })
      return
    }

    respondJson(response, 202, {
      status: 'accepted'
    })
  }

  const parseCommand = (data: RawData): ReplacementModelCommand => {
    const text = rawDataToString(data)
    const payload: unknown = JSON.parse(text)
    if (payload == null || typeof payload !== 'object') {
      throw new Error('Command payload must be an object')
    }
    const { type } = payload as { type?: unknown }
    if (type === 'set-model') {
      return {
        type,
        payload: normalizeOverrides((payload as { payload?: unknown }).payload)
      }
    }
    if (type === 'clear-model') {
      return { type }
    }
    if (type === 'get-model') {
      return { type }
    }
    throw new Error('Unsupported command type')
  }

  const applyCommand = (command: ReplacementModelCommand, socket: WebSocket) => {
    switch (command.type) {
      case 'set-model': {
        if (Object.keys(command.payload).length === 0) {
          throw new Error('set-model requires at least one field')
        }
        if (command.payload.modelPath === 'clear') {
          clearOverride()
          break
        }
        if (command.payload.cleared === true) {
          clearOverride()
          break
        }
        const previousVisible = override?.visible
        const shouldRestoreVisibility =
          command.payload.modelPath != null &&
          command.payload.modelPath !== 'clear' &&
          !('visible' in command.payload)
        const nextOverride: ReplacementModelOverrides = {
          ...(override ?? {}),
          ...command.payload
        }
        if (shouldRestoreVisibility) {
          nextOverride.visible = true
        } else if (!('visible' in command.payload) && previousVisible === false) {
          delete nextOverride.visible
        }
        if (!('cleared' in command.payload)) {
          delete nextOverride.cleared
        }
        override = nextOverride
        broadcastUpdate()
        break
      }
      case 'clear-model': {
        clearOverride()
        break
      }
      case 'get-model': {
        safeSend(socket, serialize({ type: 'model-update', payload: override }))
        break
      }
      default: {
        const never: never = command
        throw new Error(`Unhandled command: ${String(never)}`)
      }
    }
  }

  const broadcastUpdate = () => {
    const message = serialize({ type: 'model-update', payload: override })
    for (const client of wss.clients) {
      if (client.readyState === client.OPEN) {
        safeSend(client, message)
      }
    }
  }

  const isClearedOverride = (
    value: ReplacementModelOverrides | null
  ): boolean => {
    if (value == null) {
      return false
    }
    const { modelPath, scale, rotation, elevation, visible, cleared } = value
    if (cleared === true) {
      return true
    }
    return (
      modelPath == null &&
      scale == null &&
      rotation == null &&
      elevation == null &&
      visible === false
    )
  }

  const clearOverride = () => {
    if (isClearedOverride(override)) {
      return
    }
    override = { cleared: true, visible: false }
    broadcastUpdate()
  }

  const close = async (): Promise<void> => {
    try {
      await new Promise<void>((resolve, reject) => {
        wss.clients.forEach(client => client.terminate())
        wss.close(error => {
          if (error != null) {
            reject(error)
            return
          }
          httpServer.close(closeError => {
            if (closeError != null) {
              reject(closeError)
            } else {
              resolve()
            }
          })
        })
      })
    } finally {
      activeInstance = null
      if (sliderRepository != null) {
        try {
          await sliderRepository.close()
        } catch (error) {
          console.error(
            '[replacement-model] Error while closing slider repository:',
            error
          )
        }
      }
    }
  }

  httpServer.on('error', error => {
    if ('code' in (error as { code?: unknown }) && (error as { code?: unknown }).code === 'EADDRINUSE') {
      console.error(
        `[replacement-model] Failed to bind on port ${port}: address already in use.`
      )
    } else {
      console.error('[replacement-model] Server error:', error)
    }
  })

  httpServer.listen(port, () => {
    console.info(
      `[replacement-model] Listening for WebSocket and HTTP commands on port ${port}`
    )
  })

  const instance: ReplacementModelServerInstance = {
    port,
    close,
    getOverride: () => override
  }
  activeInstance = instance
  return instance
}

const resolvePort = (overridePort?: number): number => {
  if (typeof overridePort === 'number' && Number.isFinite(overridePort)) {
    return overridePort
  }
  if (typeof process.env.REPLACEMENT_MODEL_PORT === 'string') {
    const parsed = Number(process.env.REPLACEMENT_MODEL_PORT)
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed
    }
  }
  return DEFAULT_PORT
}

const parseRequestUrl = (input: string): URL => new URL(input, 'http://localhost')

const normalizeSliderSubmission = (payload: unknown): SliderSubmission => {
  if (payload == null || typeof payload !== 'object') {
    throw new Error('Slider submission payload must be an object')
  }

  const {
    sessionId,
    questionId,
    question,
    prompt,
    questionText,
    value,
    recordedAt,
    submittedAt
  } = payload as Record<string, unknown>

  if (typeof sessionId !== 'string' || sessionId.trim().length === 0) {
    throw new Error('sessionId must be a non-empty string')
  }

  if (typeof questionId !== 'string' || questionId.trim().length === 0) {
    throw new Error('questionId must be a non-empty string')
  }

  if (value == null) {
    throw new Error('value must be provided')
  }

  const submission: SliderSubmission = {
    sessionId: sessionId.trim(),
    questionId: questionId.trim(),
    value: coerceNumber(value)
  }

  const questionLabel = questionText ?? question ?? prompt
  if (questionLabel != null) {
    if (typeof questionLabel !== 'string' || questionLabel.trim().length === 0) {
      throw new Error('questionText must be a non-empty string when provided')
    }
    submission.questionText = questionLabel
  }

  const timestampCandidate = submittedAt ?? recordedAt
  if (timestampCandidate != null) {
    submission.recordedAt = normalizeDate(timestampCandidate)
  }

  return submission
}

const normalizeDate = (value: unknown): Date => {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) {
    return value
  }
  if (typeof value === 'number' || typeof value === 'string') {
    const candidate = new Date(value)
    if (!Number.isNaN(candidate.valueOf())) {
      return candidate
    }
  }
  throw new Error('recordedAt/submittedAt must be a valid date or timestamp')
}

const normalizeOverrides = (payload: unknown): ReplacementModelOverrides => {
  if (payload == null || typeof payload !== 'object') {
    throw new Error('Override payload must be an object')
  }

  const result: ReplacementModelOverrides = {}
  const { modelPath, scale, rotation, elevation, visible, cleared } = payload as Record<string, unknown>

  if (modelPath != null) {
    if (typeof modelPath !== 'string' || modelPath.trim() === '') {
      throw new Error('modelPath must be a non-empty string when provided')
    }
    result.modelPath = modelPath
  }

  if (scale != null) {
    const numeric = coerceNumber(scale)
    if (!Number.isFinite(numeric) || numeric <= 0) {
      throw new Error('scale must be a positive number when provided')
    }
    result.scale = numeric
  }

  if (rotation != null) {
    const numeric = coerceNumber(rotation)
    if (!Number.isFinite(numeric)) {
      throw new Error('rotation must be a finite number when provided')
    }
    result.rotation = numeric
  }

  if (elevation != null) {
    const numeric = coerceNumber(elevation)
    if (!Number.isFinite(numeric)) {
      throw new Error('elevation must be a finite number when provided')
    }
    result.elevation = numeric
  }

  if (visible != null) {
    if (typeof visible === 'boolean') {
      result.visible = visible
    } else if (visible === 'true' || visible === 'false') {
      result.visible = visible === 'true'
    } else {
      throw new Error('visible must be a boolean value when provided')
    }
  }

  if (cleared != null) {
    if (cleared === true || cleared === 'true') {
      result.cleared = true
    } else if (cleared === false || cleared === 'false') {
      // Explicit false clears the flag
    } else {
      throw new Error('cleared must be a boolean value when provided')
    }
  }

  return result
}

const coerceNumber = (value: unknown): number => {
  if (typeof value === 'number') {
    return value
  }
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (!Number.isNaN(parsed)) {
      return parsed
    }
  }
  throw new Error('Numeric field must be a number or numeric string')
}

const readBody = async (request: IncomingMessage): Promise<string> => {
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks).toString('utf-8')
}

const rawDataToString = (data: RawData): string => {
  if (typeof data === 'string') {
    return data
  }
  if (Array.isArray(data)) {
    return Buffer.concat(data).toString('utf-8')
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString('utf-8')
  }
  return Buffer.from(data as Buffer).toString('utf-8')
}

const serialize = (message: ReplacementModelServerMessage): string =>
  JSON.stringify(message)

const safeSend = (socket: WebSocket, data: string): void => {
  try {
    socket.send(data)
  } catch (error) {
    console.warn('[replacement-model] Failed to send message to client:', error)
  }
}

const respondJson = (
  response: ServerResponse,
  status: number,
  payload?: Record<string, unknown>
): void => {
  response.writeHead(status, {
    'Content-Type': JSON_MIME,
    ...corsHeaders
  })
  if (payload != null) {
    response.end(JSON.stringify(payload))
  } else {
    response.end()
  }
}

const respondOptions = (response: ServerResponse): void => {
  response.writeHead(204, {
    ...corsHeaders
  })
  response.end()
}
