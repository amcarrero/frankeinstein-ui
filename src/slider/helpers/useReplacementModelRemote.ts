import { useEffect, useMemo, useState } from 'react'

export interface ReplacementModelOverrides {
  modelPath?: string
  scale?: number
  rotation?: number
  elevation?: number
  visible?: boolean
  cleared?: boolean
}

export type ReplacementModelConnectionState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'error'

const DEFAULT_PORT = 43110
const WS_PATH = '/replacement-model'

interface ReplacementModelServerMessage {
  type: string
  payload?: unknown
  message?: string
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value != null && typeof value === 'object'

const parseOverrides = (payload: unknown): ReplacementModelOverrides | null => {
  if (!isRecord(payload)) {
    return null
  }
  const result: ReplacementModelOverrides = {}
  if (typeof payload.modelPath === 'string' && payload.modelPath.trim() !== '') {
    result.modelPath = payload.modelPath
  }
  if (typeof payload.scale === 'number' && Number.isFinite(payload.scale)) {
    result.scale = payload.scale
  }
  if (
    typeof payload.rotation === 'number' &&
    Number.isFinite(payload.rotation)
  ) {
    result.rotation = payload.rotation
  }
  if (
    typeof payload.elevation === 'number' &&
    Number.isFinite(payload.elevation)
  ) {
    result.elevation = payload.elevation
  }
  if (typeof payload.visible === 'boolean') {
    result.visible = payload.visible
  }
  if (payload.cleared === true) {
    result.cleared = true
  }
  return Object.keys(result).length > 0 ? result : null
}

const resolveHost = (): string => {
  if (typeof window === 'undefined') {
    return 'localhost'
  }
  const envHost = import.meta.env.VITE_REPLACEMENT_MODEL_HOST
  if (typeof envHost === 'string' && envHost.trim() !== '') {
    return envHost
  }
  return window.location.hostname
}

const resolvePort = (): string => {
  const envPort = import.meta.env.VITE_REPLACEMENT_MODEL_PORT
  if (typeof envPort === 'string' && envPort.trim() !== '') {
    return envPort.trim()
  }
  return String(DEFAULT_PORT)
}

const resolveHttpUrl = (): string | null => {
  if (typeof window === 'undefined') {
    return null
  }
  const explicit = import.meta.env.VITE_REPLACEMENT_MODEL_HTTP_URL
  if (typeof explicit === 'string' && explicit.trim() !== '') {
    return explicit.trim()
  }
  const host = resolveHost()
  const port = resolvePort()
  const protocol = window.location.protocol === 'https:' ? 'https' : 'http'
  const needsPort = !host.includes(':') && port !== ''
  const portSegment = needsPort ? `:${port}` : ''
  return `${protocol}://${host}${portSegment}${WS_PATH}`
}

const resolveWsUrl = (): string | null => {
  if (typeof window === 'undefined') {
    return null
  }
  const explicit = import.meta.env.VITE_REPLACEMENT_MODEL_WS_URL
  if (typeof explicit === 'string' && explicit.trim() !== '') {
    return explicit.trim()
  }
  const host = resolveHost()
  const port = resolvePort()
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
  const needsPort = !host.includes(':') && port !== ''
  const portSegment = needsPort ? `:${port}` : ''
  return `${protocol}://${host}${portSegment}${WS_PATH}`
}

export interface ReplacementModelRemoteState {
  overrides: ReplacementModelOverrides | null
  connectionState: ReplacementModelConnectionState
  lastError: string | null
}

export const useReplacementModelRemote = (): ReplacementModelRemoteState => {
  const [overrides, setOverrides] = useState<ReplacementModelOverrides | null>(
    null
  )
  const [connectionState, setConnectionState] =
    useState<ReplacementModelConnectionState>('idle')
  const [lastError, setLastError] = useState<string | null>(null)

  const httpUrl = useMemo(() => resolveHttpUrl(), [])
  const wsUrl = useMemo(() => resolveWsUrl(), [])

  useEffect(() => {
    if (httpUrl == null) {
      return
    }
    const abort = new AbortController()
    fetch(httpUrl, { signal: abort.signal })
      .then(async response => {
        if (!response.ok) {
          return null
        }
        const result = (await response.json()) as unknown
        if (!isRecord(result) || !('override' in result)) {
          return null
        }
        const { override } = result as { override?: unknown }
        if (override == null) {
          return null
        }
        return parseOverrides(override)
      })
      .then(initial => {
        if (abort.signal.aborted || initial == null) {
          return
        }
  setOverrides(initial)
      })
      .catch(error => {
        if (abort.signal.aborted) {
          return
        }
        setLastError(
          error instanceof Error ? error.message : 'Failed to query override'
        )
      })
    return () => {
      abort.abort()
    }
  }, [httpUrl])

  useEffect(() => {
    if (wsUrl == null) {
      return
    }
    if (typeof window === 'undefined') {
      return
    }
    let socket: WebSocket | null = null
    let disposed = false
    let reconnectTimer: number | null = null
    let attempt = 0

    const cleanupTimer = () => {
      if (reconnectTimer != null) {
        window.clearTimeout(reconnectTimer)
        reconnectTimer = null
      }
    }

    const scheduleReconnect = () => {
      cleanupTimer()
      if (disposed) {
        return
      }
      const delay = Math.min(5000, 500 * 2 ** attempt)
      reconnectTimer = window.setTimeout(() => {
        attempt += 1
        connect()
      }, delay)
    }

    const connect = () => {
      cleanupTimer()
      if (disposed) {
        return
      }
      setConnectionState('connecting')
      try {
        socket = new WebSocket(wsUrl)
      } catch (error) {
        setLastError(
          error instanceof Error
            ? error.message
            : 'Failed to create WebSocket connection'
        )
        setConnectionState('error')
        scheduleReconnect()
        return
      }

      socket.addEventListener('open', () => {
        if (disposed) {
          return
        }
        attempt = 0
        setConnectionState('connected')
        setLastError(null)
        try {
          socket?.send(JSON.stringify({ type: 'get-model' }))
        } catch (error) {
          setLastError(
            error instanceof Error
              ? error.message
              : 'Failed to request initial override'
          )
        }
      })

      socket.addEventListener('message', event => {
        if (disposed) {
          return
        }
        const data = event.data
        let parsed: ReplacementModelServerMessage | null = null
        try {
          parsed = JSON.parse(String(data)) as ReplacementModelServerMessage
        } catch (error) {
          setLastError(
            error instanceof Error ? error.message : 'Invalid server message'
          )
          return
        }
        if (parsed == null || typeof parsed.type !== 'string') {
          return
        }
        if (parsed.type === 'model-update') {
          const overridesPayload = parseOverrides(parsed.payload)
          setOverrides(overridesPayload)
          return
        }
        if (parsed.type === 'error') {
          if (typeof parsed.message === 'string') {
            setLastError(parsed.message)
            setConnectionState('error')
          }
        }
      })

      socket.addEventListener('close', () => {
        if (disposed) {
          return
        }
        setConnectionState('idle')
        scheduleReconnect()
      })

      socket.addEventListener('error', event => {
        if (disposed) {
          return
        }
        setConnectionState('error')
        const message = (() => {
          if ('message' in event && typeof (event as { message?: unknown }).message === 'string') {
            return (event as { message?: string }).message ?? 'WebSocket error'
          }
          return 'WebSocket error'
        })()
        setLastError(message)
        socket?.close()
      })
    }

    attempt = 0
    connect()

    return () => {
      disposed = true
      cleanupTimer()
      socket?.close()
    }
  }, [wsUrl])

  return { overrides, connectionState, lastError }
}
