import { useControls } from './useControls'
import type { CloudsProps } from '@takram/three-clouds/r3f'

interface CloudsControlOptions {
  coverage?: number
  animate?: boolean
}

interface CloudsControlValues {
  enabled: boolean
  toneMapping: boolean
}

export function useCloudsControls(
  { coverage = 0.3, animate = false }: CloudsControlOptions = {}
): [CloudsControlValues, Partial<CloudsProps>] {
  const { enabled, coverage: coverageControl, animate: animateControl } =
    useControls('clouds', {
      enabled: true,
      coverage: { value: coverage, min: 0, max: 1, step: 0.01 },
      animate: animate
    }, { collapsed: true })

  const finalCoverage = coverageControl ?? coverage
  const animationEnabled = animateControl ?? animate

  return [
    {
      enabled,
      toneMapping: true
    },
    {
      coverage: finalCoverage,
      qualityPreset: 'high',
      localWeatherVelocity: animationEnabled ? [0.001, 0] : [0, 0]
    }
  ]
}
