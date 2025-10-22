import { useGLTF } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, type FC } from 'react'
import {
  Box3,
  MathUtils,
  Mesh,
  Object3D,
  Vector3,
  BufferGeometry,
  Float32BufferAttribute,
  MeshBasicMaterial,
  Group
} from 'three'
import { DRACOLoader, GLTFLoader, KTX2Loader } from 'three-stdlib'

import type { PolygonRegion } from './usePolygonClipping'

export interface ClippedReplacementModelProps {
  region: PolygonRegion
  modelPath: string
  scale?: number
  rotation?: number
  elevation?: number
  visible?: boolean
}

export const REPLACEMENT_LIGHTING_MASK_LAYER = 15

const KEY_LIGHT_HEIGHT = 800

// Draws a depth-only polygon in the region to occlude anything behind it.
// This prevents any residual fragments from the original tiles from showing.
export const DepthMask: FC<{ region: PolygonRegion; elevation?: number; visible?: boolean }> = ({ region, elevation = 0.5, visible = true }) => {
  const { localPolygon } = region
  const geometry = useMemo(() => {
    if (localPolygon.length < 3) return null
    const positions: number[] = []
    for (let i = 1; i < localPolygon.length - 1; i += 1) {
      const a = localPolygon[0]
      const b = localPolygon[i]
      const c = localPolygon[i + 1]
      positions.push(a.x, elevation, a.y, b.x, elevation, b.y, c.x, elevation, c.y)
    }
    const geom = new BufferGeometry()
    geom.setAttribute('position', new Float32BufferAttribute(positions, 3))
    return geom
  }, [localPolygon, elevation])

  const material = useMemo(() => {
    const mat = new MeshBasicMaterial({ colorWrite: false, depthWrite: true, depthTest: false })
    mat.polygonOffset = true
    mat.polygonOffsetFactor = -10
    mat.polygonOffsetUnits = -1000
    return mat
  }, [])

  if (!visible || geometry == null) return null

  return (
    <group matrixAutoUpdate={false} matrix={region.orientation} visible={visible}>
      <mesh
        geometry={geometry}
        material={material}
        renderOrder={-100}
        frustumCulled={false}
      />
    </group>
  )
}

interface ModelMetrics {
  size: Vector3
  center: Vector3
  minY: number
}

function computeModelMetrics(model: Object3D): ModelMetrics {
  model.updateMatrixWorld(true)
  const box = new Box3().setFromObject(model)
  const size = new Vector3()
  box.getSize(size)
  const center = new Vector3()
  box.getCenter(center)
  return {
    size,
    center,
    minY: box.min.y
  }
}

export const ClippedReplacementModel: FC<ClippedReplacementModelProps> = ({
  region,
  modelPath,
  scale = 1.05,
  rotation = 120,
  elevation = -30,
  visible = true
}) => {
  const normalizedModelPath = useMemo(() => {
    if (/^(https?:)?\/\//.test(modelPath)) {
      return modelPath
    }
    return modelPath.startsWith('/') ? modelPath : `/${modelPath}`
  }, [modelPath])
  const renderer = useThree(({ gl }) => gl)
  const extendLoader = useMemo(() => {
    if (renderer == null) {
      return undefined
    }
    return (loader: GLTFLoader): void => {
      const draco = new DRACOLoader()
      draco.setDecoderPath('https://www.gstatic.com/draco/v1/decoders/')
      loader.setDRACOLoader(draco)
      const ktx2 = new KTX2Loader()
      ktx2.setTranscoderPath('https://unpkg.com/three@0.180.0/examples/jsm/libs/basis/')
      ktx2.detectSupport(renderer)
      loader.setKTX2Loader(ktx2)
    }
  }, [renderer])
  useEffect(() => {
    useGLTF.preload(normalizedModelPath)
  }, [normalizedModelPath])
  const { scene } = useGLTF(normalizedModelPath, true, true, extendLoader)
  const model = useMemo(() => {
    const clone = scene.clone(true)
    clone.layers.set(REPLACEMENT_LIGHTING_MASK_LAYER)
    clone.traverse(object => {
      if (object instanceof Mesh) {
        object.castShadow = true
        object.receiveShadow = true
        object.layers.set(REPLACEMENT_LIGHTING_MASK_LAYER)
        const materials = Array.isArray(object.material)
          ? object.material
          : object.material != null
            ? [object.material]
            : []
        materials.forEach(material => {
          const standard = material as { metalness?: number; roughness?: number; needsUpdate?: boolean }
          const currentMetalness = standard.metalness
          if (typeof currentMetalness === 'number' && currentMetalness > 0) {
            standard.metalness = 0
            if (typeof standard.roughness === 'number') {
              standard.roughness = Math.max(standard.roughness ?? 1, 0.6)
            }
            standard.needsUpdate = true
          }
        })
      }
    })
    return clone
  }, [scene])

  const metrics = useMemo(() => computeModelMetrics(model), [model])
  const { bounds } = region

  const localCenterX = (bounds.min.x + bounds.max.x) * 0.5
  const localCenterZ = (bounds.min.y + bounds.max.y) * 0.5
  const width = bounds.max.x - bounds.min.x
  const depth = bounds.max.y - bounds.min.y

  const scaleCandidates: number[] = []
  if (metrics.size.x > 0 && width > 0) {
    scaleCandidates.push(width / metrics.size.x)
  }
  if (metrics.size.z > 0 && depth > 0) {
    scaleCandidates.push(depth / metrics.size.z)
  }
  const baseScale =
    scaleCandidates.length > 0 ? Math.min(...scaleCandidates) : 1
  const finalScale = baseScale * scale

  const rotationRad = MathUtils.degToRad(rotation)

  const pivotX = -metrics.center.x
  const pivotY = -metrics.minY
  const pivotZ = -metrics.center.z

  const groupRef = useRef<Group>(null)

  return (
    <group
      ref={groupRef}
      matrixAutoUpdate={false}
      matrix={region.orientation}
      visible={visible}
      onUpdate={group => {
        group.layers.set(REPLACEMENT_LIGHTING_MASK_LAYER)
      }}
    >
      <ambientLight
        intensity={2}
        onUpdate={light => {
          light.layers.set(REPLACEMENT_LIGHTING_MASK_LAYER)
        }}
      />
      <directionalLight
        position={[0, 500, 200]}
        intensity={1.5}
        onUpdate={light => {
          light.layers.set(REPLACEMENT_LIGHTING_MASK_LAYER)
        }}
      />
      <spotLight
        position={[0, KEY_LIGHT_HEIGHT, 0]}
        intensity={5}
        angle={Math.PI / 2.5}
        penumbra={0.4}
        decay={0}
        castShadow
        target-position={[0, 0, 0]}
        onUpdate={light => {
          light.layers.set(REPLACEMENT_LIGHTING_MASK_LAYER)
          light.target.layers.set(REPLACEMENT_LIGHTING_MASK_LAYER)
        }}
      />
      <group
        position={[localCenterX, 0, localCenterZ]}
        onUpdate={inner => {
          inner.layers.set(REPLACEMENT_LIGHTING_MASK_LAYER)
        }}
      >
        <group
          rotation-y={rotationRad}
          position={[0, elevation, 0]}
          onUpdate={inner => {
            inner.layers.set(REPLACEMENT_LIGHTING_MASK_LAYER)
          }}
        >
          <group
            scale={[finalScale, finalScale, finalScale]}
            onUpdate={inner => {
              inner.layers.set(REPLACEMENT_LIGHTING_MASK_LAYER)
            }}
          >
            <primitive object={model} position={[pivotX, pivotY, pivotZ]} />
          </group>
        </group>
      </group>
    </group>
  )
}

useGLTF.preload('/sample-5.glb')
useGLTF.preload('/sample-4.glb')
useGLTF.preload('/sample-3.glb')
useGLTF.preload('/sample-2.glb')
useGLTF.preload('/sample.glb')
