import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { SMAA, ToneMapping } from '@react-three/postprocessing'
import type { TilesRenderer as TilesRendererImpl } from '3d-tiles-renderer'
import { CameraTransition, GlobeControls } from '3d-tiles-renderer/r3f'
import {
  EffectMaterial,
  type EffectComposer as EffectComposerImpl
} from 'postprocessing'
import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type FC
} from 'react'
import { Leva, button } from 'leva'

import {
  AerialPerspective,
  Atmosphere,
  Sky,
  Stars,
  type AtmosphereApi
} from '@takram/three-atmosphere/r3f'
import { Clouds } from '@takram/three-clouds/r3f'
import { Geodetic, PointOfView, radians } from '@takram/three-geospatial'
import {
  Depth,
  Dithering,
  LensFlare,
  Normal
} from '@takram/three-geospatial-effects/r3f'
import { SRGBColorSpace } from 'three'

import { EffectComposer } from '../helpers/EffectComposer'
import {
  ClippedReplacementModel,
  DepthMask
} from '../helpers/ClippedReplacementModel'
import { Globe } from '../helpers/Globe'
import { GoogleMapsAPIKeyPrompt } from '../helpers/GoogleMapsAPIKeyPrompt'
import { HaldLUT } from '../helpers/HaldLUT'
import { Stats } from '../helpers/Stats'
import { exportClippedRegionToGlb } from '../helpers/exportClippedRegionToGlb'
import { useCloudsControls } from '../helpers/useCloudsControls'
import { useColorGradingControls } from '../helpers/useColorGradingControls'
import { useControls } from '../helpers/useControls'
import { useGoogleMapsAPIKeyControls } from '../helpers/useGoogleMapsAPIKeyControls'
import { usePolygonClipping } from '../helpers/usePolygonClipping'
import {
  useLocalDateControls,
  type LocalDateControlsParams
} from '../helpers/useLocalDateControls'
import { usePovControls } from '../helpers/usePovControls'
import { useToneMappingControls } from '../helpers/useToneMappingControls'
import { useReplacementModelRemote } from '../helpers/useReplacementModelRemote'

interface SceneProps extends LocalDateControlsParams {
  exposure?: number
  longitude?: number
  latitude?: number
  heading?: number
  pitch?: number
  distance?: number
  coverage?: number
}

const REPLACEMENT_MODELS = {
  volpeConcept: {
    label: 'Volpe 3',
    modelPath: '/sample-3.glb'
  },
  volpe2: {
    label: 'Volpe 2',
    modelPath: '/sample-2.glb'
  },
  volpe: {
    label: 'Volpe',
    modelPath: '/sample.glb'
  }
} as const

type ReplacementModelKey = keyof typeof REPLACEMENT_MODELS

const REPLACEMENT_OPTIONS: Record<string, ReplacementModelKey> = {
  Volpe: 'volpe',
  'Volpe 2': 'volpe2',
  'Volpe 3': 'volpeConcept'
}


const Scene: FC<SceneProps> = ({
  exposure = 60,
  longitude = -71.0845,
  latitude = 42.3645,
  heading = -125,
  pitch = -40,
  distance = 300,
  coverage = 0.3,
  dayOfYear = 1,
  timeOfDay = 7.6,
  ...localDate
}) => {
  const renderer = useThree(({ gl }) => gl)
  useEffect(() => {
    if (renderer != null) {
      renderer.outputColorSpace = SRGBColorSpace
    }
  }, [renderer])
  const { toneMappingMode } = useToneMappingControls({ exposure })
  const tilesRef = useRef<TilesRendererImpl>(null)
  const { orthographic } = useControls(
    'camera',
    { orthographic: false },
    { collapsed: true }
  )
  const lut = useColorGradingControls()
  const { lensFlare, normal, depth } = useControls(
    'effects',
    {
      lensFlare: true,
      depth: false,
      normal: false
    },
    { collapsed: true }
  )
  const {
    enabled: clippingEnabled,
    clippingPlanes,
    clipIntersection,
    polygonKey,
    mode,
    region
  } = usePolygonClipping()
  const [replacementControls, setReplacementControls] = useControls(
    'replacement',
    () => ({
      enabled: { value: true },
      model: {
        label: 'Model',
        value: 'volpeConcept',
        options: REPLACEMENT_OPTIONS
      },
      scale: {
        label: 'Scale',
        value: 1.05,
        min: 0.25,
        max: 4,
        step: 0.05
      },
      rotation: {
        label: 'Rotation',
        value: 120,
        min: -180,
        max: 180,
        step: 1
      },
      elevation: {
        label: 'Elevation',
        value: -30,
        min: -200,
        max: 200,
        step: 1
      }
    }),
    { collapsed: true }
  ) as unknown as [{
    enabled: boolean
    model: ReplacementModelKey
    scale: number
    rotation: number
    elevation: number
  }, (values: Partial<{
    enabled: boolean
    model: ReplacementModelKey
    scale: number
    rotation: number
    elevation: number
  }>) => void]
  const {
    enabled: replacementEnabled,
    model: replacementModel,
    scale: replacementScale,
    rotation: replacementRotation,
    elevation: replacementElevation
  } = replacementControls
  const { overrides: remoteReplacementOverrides } = useReplacementModelRemote()
  const replacementModelConfig =
    REPLACEMENT_MODELS[replacementModel] ?? REPLACEMENT_MODELS.volpeConcept
  const remoteVisibilityPreference =
    remoteReplacementOverrides?.cleared === true
      ? false
      : remoteReplacementOverrides?.visible ??
        (remoteReplacementOverrides != null ? true : undefined)
  const effectiveModelPath =
    remoteReplacementOverrides?.modelPath ?? replacementModelConfig.modelPath
  const effectiveScale =
    remoteReplacementOverrides?.scale ?? replacementScale
  const effectiveRotation =
    remoteReplacementOverrides?.rotation ?? replacementRotation
  const effectiveElevation =
    remoteReplacementOverrides?.elevation ?? replacementElevation
  const baseReplacementVisibility =
    clippingEnabled && region != null && mode === 'exclude interior'
  const replacementVisible =
    baseReplacementVisibility &&
    (remoteVisibilityPreference ?? replacementEnabled)
  const invalidate = useThree(state => state.invalidate)
  // Ensure demand-driven canvas renders when remote overrides change.
  useEffect(() => {
    invalidate()
  }, [
    invalidate,
    replacementVisible,
    effectiveModelPath,
    effectiveScale,
    effectiveRotation,
    effectiveElevation,
    remoteReplacementOverrides?.cleared,
    remoteReplacementOverrides?.visible
  ])
  const replacementDefaultsApplied = useRef(false)
  useEffect(() => {
    if (replacementDefaultsApplied.current) {
      return
    }
    const hasLegacyDefaults =
      replacementScale === 1 &&
      replacementRotation === 0 &&
      replacementElevation === 0
    const hasRequestedDefaults =
      replacementScale === 1.05 &&
      replacementRotation === 120 &&
      replacementElevation === -30
    if (hasLegacyDefaults) {
      setReplacementControls({
        scale: 1.05,
        rotation: 120,
        elevation: -30
      })
    }
    if (hasLegacyDefaults || hasRequestedDefaults) {
      replacementDefaultsApplied.current = true
    }
  }, [
    replacementScale,
    replacementRotation,
    replacementElevation,
    setReplacementControls
  ])
  const camera = useThree(({ camera }) => camera)
  usePovControls(camera, { collapsed: true })
  const motionDate = useLocalDateControls({
    longitude,
    dayOfYear,
    timeOfDay,
    ...localDate
  })
  const { correctAltitude, correctGeometricError } = useControls(
    'atmosphere',
    {
      correctAltitude: true,
      correctGeometricError: true
    }
  )
  const [{ enabled: cloudsEnabled, toneMapping: cloudsToneMapping }, cloudsProps] =
    useCloudsControls({ coverage, animate: true })
  const {
    enable: enabled,
    sun,
    sky,
    transmittance,
    inscatter
  } = useControls('aerial perspective', {
    enable: true,
    sun: true,
    sky: true,
    transmittance: true,
    inscatter: true
  })

  const exportClippedArea = useCallback(async () => {
    if (clippingPlanes == null || clippingPlanes.length === 0) {
      return
    }
    const tiles = tilesRef.current
    if (tiles == null) {
      return
    }
    const slug = polygonKey
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
    const safeSlug = slug !== '' ? slug : 'clipped-region'
    try {
      await exportClippedRegionToGlb({
        tiles,
        planes: clippingPlanes,
        fileName: `clipped-${safeSlug}-${mode.replace(/\s+/g, '-')}.glb`
      })
    } catch {
      // Ignore export failures.
    }
  }, [clippingPlanes, mode, polygonKey])

  const handleExportButton = useCallback(() => {
    void exportClippedArea()
  }, [exportClippedArea])

  useControls(
    'clipping',
    () => ({
      'export glb': button(handleExportButton)
    }),
    [handleExportButton]
  )

  useLayoutEffect(() => {
    if (camera.position.length() > 10) {
      return
    }

    new PointOfView(distance, radians(heading), radians(pitch)).decompose(
      new Geodetic(radians(longitude), radians(latitude)).toECEF(),
      camera.position,
      camera.quaternion,
      camera.up
    )
  }, [longitude, latitude, heading, pitch, distance, camera])

  const composerRef = useRef<EffectComposerImpl>(null)
  useFrame(() => {
    const composer = composerRef.current
    if (composer != null) {
      composer.passes.forEach(pass => {
        if (pass.fullscreenMaterial instanceof EffectMaterial) {
          pass.fullscreenMaterial.adoptCameraSettings(camera)
        }
      })
    }
  })

  const atmosphereRef = useRef<AtmosphereApi>(null)
  useFrame(() => {
    atmosphereRef.current?.updateByDate(new Date(motionDate.get()))
  })

  return (
    <Atmosphere ref={atmosphereRef} correctAltitude={correctAltitude}>
      <Sky />
      <Stars data='atmosphere/stars.bin' />
      <Globe
        ref={tilesRef}
        clippingPlanes={clippingPlanes}
        clipIntersection={clipIntersection}
      >
        {region != null && clippingEnabled && mode === 'exclude interior' && (
          <DepthMask region={region} elevation={0.5} />
        )}
        <GlobeControls enableDamping />
        {replacementVisible && region != null && (
          <ClippedReplacementModel
            region={region}
            modelPath={effectiveModelPath}
            scale={effectiveScale}
            rotation={effectiveRotation}
            elevation={effectiveElevation}
            visible={replacementVisible}
          />
        )}
      </Globe>
      <EffectComposer ref={composerRef} multisampling={0}>
        <Fragment
          key={JSON.stringify([
            enabled,
            sun,
            sky,
            transmittance,
            inscatter,
            correctGeometricError,
            lensFlare,
            normal,
            depth,
            lut,
            cloudsEnabled,
            cloudsToneMapping,
            cloudsProps.coverage,
            (cloudsProps as { animate?: boolean }).animate ?? false
          ])}
        >
          {!normal && !depth && cloudsEnabled && (
            <Clouds shadow-farScale={0.25} {...cloudsProps} />
          )}
          {enabled && !normal && !depth && (
            <AerialPerspective
              sunLight={sun}
              skyLight={sky}
              transmittance={transmittance}
              inscatter={inscatter}
              correctGeometricError={correctGeometricError}
              albedoScale={2 / Math.PI}
            />
          )}
          {cloudsToneMapping && (
            <>
              {lensFlare && <LensFlare />}
              {depth && <Depth useTurbo />}
              {normal && <Normal />}
              {!normal && !depth && (
                <>
                  <ToneMapping mode={toneMappingMode} />
                  {lut != null && <HaldLUT path={lut} />}
                  <SMAA />
                  <Dithering />
                </>
              )}
            </>
          )}
        </Fragment>
      </EffectComposer>
      <CameraTransition mode={orthographic ? 'orthographic' : 'perspective'} />
    </Atmosphere>
  )
}

export const FullTilesRendererExperience: FC<SceneProps> = props => {
  useGoogleMapsAPIKeyControls()
  return (
    <>
      <Canvas frameloop='demand' gl={{ depth: false }}>
        <Stats />
        <Scene {...props} />
      </Canvas>
      <Leva collapsed />
      <GoogleMapsAPIKeyPrompt />
    </>
  )
}

export default FullTilesRendererExperience
