import {
  EffectComposer as WrappedEffectComposer,
  type EffectComposerProps
} from '@react-three/postprocessing'
import { useThree } from '@react-three/fiber'
import type { WebGLRenderer } from 'three'
import {
  EffectComposer as PostprocessingEffectComposer,
  NormalPass,
  Pass
} from 'postprocessing'
import type { EffectComposer as EffectComposerImpl } from 'postprocessing'
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FC,
  type RefAttributes
} from 'react'
import { mergeRefs } from 'react-merge-refs'
import {
  DepthTexture,
  HalfFloatType,
  Texture,
  Vector2,
  type WebGLRenderTarget
} from 'three'

type GuardedComposer = EffectComposerImpl & {
  renderer?: WebGLRenderer
  __safeAddPassApplied?: boolean
}

type RetriablePass = Pass & { __addPassRetryCount?: number }

const composerPrototype = PostprocessingEffectComposer.prototype as GuardedComposer

if (!composerPrototype.__safeAddPassApplied) {
  composerPrototype.addPass = function safeAddPass(pass: Pass, index?: number) {
    const scopedComposer = this as GuardedComposer & {
      inputBuffer: { texture: Texture & { type: unknown } }
      passes: Array<Pass & {
        renderToScreen?: boolean
        needsDepthTexture?: boolean
        setDepthTexture?: (depthTexture: Texture) => void
      }>
      autoRenderToScreen: boolean
      depthTexture: Texture | null
      createDepthTexture: () => DepthTexture
    }
    const passes = scopedComposer.passes
    const renderer = scopedComposer.renderer
    if (renderer == null) {
      const retriablePass = pass as RetriablePass
      retriablePass.__addPassRetryCount = (retriablePass.__addPassRetryCount ?? 0) + 1
      if (retriablePass.__addPassRetryCount > 60) {
        return
      }
      requestAnimationFrame(() => {
        safeAddPass.call(scopedComposer, pass, index)
      })
      return
    }
    ;(pass as RetriablePass).__addPassRetryCount = 0
    const context = renderer.getContext?.()
    const contextAttributes = context?.getContextAttributes?.()
    if (context == null || contextAttributes == null) {
      const retriablePass = pass as RetriablePass
      retriablePass.__addPassRetryCount = (retriablePass.__addPassRetryCount ?? 0) + 1
      if (retriablePass.__addPassRetryCount > 60) {
        return
      }
      requestAnimationFrame(() => {
        safeAddPass.call(scopedComposer, pass, index)
      })
      return
    }
    const drawingBufferSize = renderer.getDrawingBufferSize?.(new Vector2()) ?? new Vector2()
    const alpha = contextAttributes.alpha ?? false
    const frameBufferType = scopedComposer.inputBuffer?.texture?.type

  pass.setRenderer?.(renderer)
  pass.setSize?.(drawingBufferSize.width, drawingBufferSize.height)
  pass.initialize?.(renderer, alpha, frameBufferType)

    if (scopedComposer.autoRenderToScreen) {
      if (passes.length > 0) {
        const lastPass = passes[passes.length - 1]
        if (lastPass != null) {
          lastPass.renderToScreen = false
        }
      }
      if (pass.renderToScreen) {
        scopedComposer.autoRenderToScreen = false
      }
    }

    if (index !== void 0) {
      passes.splice(index, 0, pass)
    } else {
      passes.push(pass)
    }

    if (scopedComposer.autoRenderToScreen && passes.length > 0) {
      const lastPass = passes[passes.length - 1]
      if (lastPass != null) {
        lastPass.renderToScreen = true
      }
    }

    const needsDepthTexture = Boolean(pass.needsDepthTexture) || scopedComposer.depthTexture !== null
    if (needsDepthTexture) {
      if (scopedComposer.depthTexture === null) {
        const depthTexture = scopedComposer.createDepthTexture()
        passes.forEach(existingPass => {
          existingPass.setDepthTexture?.(depthTexture)
        })
      } else {
        pass.setDepthTexture?.(scopedComposer.depthTexture)
      }
    }
  }
  composerPrototype.__safeAddPassApplied = true
}

// Provided for half-float normal buffer.
export const EffectComposer: FC<
  EffectComposerProps & RefAttributes<EffectComposerImpl>
> = ({ ref: forwardedRef, ...props }) => {
  const renderer = useThree(({ gl }) => gl)
  const initialContextAvailable = useMemo(() => {
    try {
      return renderer.getContext() != null
    } catch {
      return false
    }
  }, [renderer])
  const [hasContext, setHasContext] = useState(initialContextAvailable)

  useEffect(() => {
    if (hasContext) {
      return
    }
    let cancelled = false
    const attemptRestore = () => {
      if (cancelled) {
        return
      }
      try {
        if (renderer.getContext() != null) {
          setHasContext(true)
          return
        }
      } catch {
        // Intentionally ignore and retry.
      }
      requestAnimationFrame(attemptRestore)
    }
    requestAnimationFrame(attemptRestore)
    return () => {
      cancelled = true
    }
  }, [hasContext, renderer])

  useEffect(() => {
    const canvas = renderer.domElement
    const handleLost = () => {
      setHasContext(false)
    }
    const handleRestored = () => {
      setHasContext(() => {
        try {
          return renderer.getContext() != null
        } catch {
          return false
        }
      })
    }
    canvas.addEventListener('webglcontextlost', handleLost, false)
    canvas.addEventListener('webglcontextrestored', handleRestored, false)
    return () => {
      canvas.removeEventListener('webglcontextlost', handleLost, false)
      canvas.removeEventListener('webglcontextrestored', handleRestored, false)
    }
  }, [renderer])

  const ref = useRef<EffectComposerImpl>(null)
  useLayoutEffect(() => {
    if (!hasContext) {
      return
    }
    const composer = ref.current
    if (composer == null) {
      return
    }
    const normalPass = composer.passes.find(pass => pass instanceof NormalPass)
    if (normalPass == null) {
      // Normal pass may not be available if postprocessing disables it.
      return
    }
    const typedNormalPass = normalPass as NormalPass & {
      renderTarget: WebGLRenderTarget
    }
    const { renderer } = composer as EffectComposerImpl & {
      renderer?: {
        capabilities?: { isWebGL2?: boolean }
        extensions?: { has?: (name: string) => boolean }
      }
    }
    const supportsHalfFloat =
      renderer?.capabilities?.isWebGL2 === true ||
      renderer?.extensions?.has?.('OES_texture_half_float') === true
    if (supportsHalfFloat) {
      typedNormalPass.renderTarget.texture.type = HalfFloatType
    }
  }, [hasContext, renderer])

  if (!hasContext) {
    return null
  }

  return (
    <WrappedEffectComposer
      ref={mergeRefs([ref, forwardedRef])}
      {...props}
      enableNormalPass
    />
  )
}
