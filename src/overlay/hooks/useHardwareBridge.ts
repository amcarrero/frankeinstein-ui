import { useCallback, useEffect, useRef, useState } from 'react'

const DEFAULT_SOCKET_URL = 'ws://10.134.5.198:8080/'

type HardwareMessage = {
  type: string
  value?: string
  [key: string]: unknown
}

interface UseHardwareBridgeOptions {
  url?: string
  shouldListen?: boolean
  onSliderChange?: (value: number) => void
  onConfirm?: (message: HardwareMessage) => void
}

interface UseHardwareBridgeResult {
  connectionState: ConnectionState
  lastMessage: HardwareMessage | null
  reconnect: () => void
}

type ConnectionState =
  | 'idle'
  | 'connecting'
  | 'open'
  | 'closed'
  | 'error'
  | 'reconnecting'

const parseMessage = (event: MessageEvent<string>): HardwareMessage | null => {
  try {
    const [type = '', rawValue = ''] = String(event.data).split(/:\s*/, 2)
    if (type === '') {
      return null
    }
    return { type, value: rawValue }
  } catch (error) {
    console.warn('Hardware bridge received malformed payload', event.data, error)
    return null
  }
}

export const useHardwareBridge = ({
  url = DEFAULT_SOCKET_URL,
  onSliderChange,
  onConfirm,
  shouldListen = true
}: UseHardwareBridgeOptions = {}): UseHardwareBridgeResult => {
  const socketRef = useRef<WebSocket | null>(null)
  const sliderHandlerRef = useRef(onSliderChange)
  const confirmHandlerRef = useRef(onConfirm)
  const reconnectTimerRef = useRef<number | null>(null)

  const [connectionState, setConnectionState] = useState<ConnectionState>('idle')
  const [lastMessage, setLastMessage] = useState<HardwareMessage | null>(null)
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    sliderHandlerRef.current = onSliderChange
  }, [onSliderChange])

  useEffect(() => {
    confirmHandlerRef.current = onConfirm
  }, [onConfirm])

  const closeSocket = useCallback(() => {
    if (reconnectTimerRef.current != null) {
      window.clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = null
    }

    if (socketRef.current != null) {
      socketRef.current.close()
      socketRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!shouldListen) {
      closeSocket()
      setConnectionState('idle')
      return undefined
    }

    let didUnmount = false
    setConnectionState('connecting')

    const socket = new WebSocket(url)
    socketRef.current = socket

    socket.onopen = () => {
      if (didUnmount) {
        return
      }
      setConnectionState('open')
    }

    socket.onmessage = event => {
      if (didUnmount) {
        return
      }
      const parsed = parseMessage(event)
      if (parsed == null) {
        return
      }
      setLastMessage(parsed)
      if (parsed.type === 'slider' && typeof parsed.value !== 'undefined') {
        const numericValue = Number(parsed.value)
        if (Number.isFinite(numericValue)) {
          sliderHandlerRef.current?.(numericValue)
        }
        return
      }

      if (parsed.type === 'button') {
        confirmHandlerRef.current?.(parsed)
      }
    }

    socket.onerror = () => {
      if (!didUnmount) {
        setConnectionState('error')
      }
    }

    socket.onclose = () => {
      if (didUnmount) {
        return
      }
      setConnectionState('closed')
      reconnectTimerRef.current = window.setTimeout(() => {
        if (shouldListen) {
          setConnectionState('reconnecting')
          socketRef.current = null
          setRevision((count: number) => count + 1)
        }
      }, 1500)
    }

    return () => {
      didUnmount = true
      closeSocket()
    }
  }, [closeSocket, revision, shouldListen, url])

  const reconnect = useCallback(() => {
    closeSocket()
    setConnectionState('reconnecting')
  setRevision((count: number) => count + 1)
  }, [closeSocket])

  return {
    connectionState,
    lastMessage,
    reconnect
  }
}
