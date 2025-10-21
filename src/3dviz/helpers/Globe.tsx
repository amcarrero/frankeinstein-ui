import type {
  TilesRenderer as TilesRendererImpl,
  TilesRendererEventMap
} from '3d-tiles-renderer'
import {
  GLTFExtensionsPlugin,
  GoogleCloudAuthPlugin,
  TileCompressionPlugin,
  TilesFadePlugin,
  UpdateOnChangePlugin
} from '3d-tiles-renderer/plugins'
import {
  TilesAttributionOverlay,
  TilesPlugin,
  TilesRenderer
} from '3d-tiles-renderer/r3f'
import { useAtomValue, useSetAtom } from 'jotai'
import { useEffect, useState, type FC, type ReactNode, type Ref } from 'react'
import { mergeRefs } from 'react-merge-refs'
import type { Material, Object3D, Plane } from 'three'
import { Line, LineSegments, Mesh, Points } from 'three'
import { DRACOLoader } from 'three-stdlib'

import { radians } from '@takram/three-geospatial'

import { TileCreasedNormalsPlugin } from '../plugins/TileCreasedNormalsPlugin'
import { googleMapsApiKeyAtom, needsApiKeyAtom } from './states'

function applyClippingPlanes(
  scene: Object3D,
  planes: Plane[] | null,
  clipIntersection: boolean
): void {
  let applied = 0
  const materialTypes = new Set<string>()
  scene.traverse(object => {
    if (
      object instanceof Mesh ||
      object instanceof Line ||
      object instanceof LineSegments ||
      object instanceof Points
    ) {
      const material = object.material
      const materials: Material[] = Array.isArray(material)
        ? material
        : material != null
          ? [material]
          : []
      materials.forEach(currentMaterial => {
        currentMaterial.clippingPlanes = planes
        currentMaterial.clipIntersection = clipIntersection
        if ('clipping' in currentMaterial) {
          // Required for ShaderMaterial-derived instances.
          ;(currentMaterial as Material & { clipping?: boolean }).clipping = true
        }
        currentMaterial.needsUpdate = true
        applied += 1
        materialTypes.add(currentMaterial.type)
      })
    }
  })
}

const dracoLoader = new DRACOLoader()
dracoLoader.setDecoderPath('https://www.gstatic.com/draco/v1/decoders/')

export interface GlobeProps {
  ref?: Ref<TilesRendererImpl>
  children?: ReactNode
  clippingPlanes?: Plane[]
  clipIntersection?: boolean
}
export const Globe: FC<GlobeProps> = ({
  ref,
  children,
  clippingPlanes,
  clipIntersection = false
}) => {
  const inputApiKey = useAtomValue(googleMapsApiKeyAtom)
  const fallbackApiKey =
    import.meta.env.VITE_GOOGLE_MAPS_API_KEY ??
    import.meta.env.STORYBOOK_GOOGLE_MAP_API_KEY ??
    ''
  const apiKey = inputApiKey !== '' ? inputApiKey : fallbackApiKey

  const [tiles, setTiles] = useState<TilesRendererImpl | null>(null)
  const setNeedsApiKey = useSetAtom(needsApiKeyAtom)
  useEffect(() => {
    if (tiles == null) {
      return
    }
    const callback = (): void => {
      setNeedsApiKey(true)
    }
    tiles.addEventListener('load-error', callback)
    return () => {
      tiles.removeEventListener('load-error', callback)
    }
  }, [tiles, setNeedsApiKey])

  useEffect(() => {
    if (tiles == null) {
      return
    }
    const planes = clippingPlanes != null && clippingPlanes.length > 0
      ? clippingPlanes
      : null
    const handleLoadModel = ({
      scene
    }: TilesRendererEventMap['load-model']): void => {
      applyClippingPlanes(scene, planes, clipIntersection)
    }

    applyClippingPlanes(tiles.group, planes, clipIntersection)
    tiles.addEventListener('load-model', handleLoadModel)
    return () => {
      tiles.removeEventListener('load-model', handleLoadModel)
    }
  }, [tiles, clippingPlanes, clipIntersection])

  return (
    <TilesRenderer
      ref={mergeRefs([ref, setTiles])}
      // Reconstruct tiles when API key changes.
      key={apiKey}
      // The root URL sometimes becomes null without specifying the URL.
      url={`https://tile.googleapis.com/v1/3dtiles/root.json?key=${apiKey}`}
    >
      <TilesPlugin
        plugin={GoogleCloudAuthPlugin}
        args={[
          {
            apiToken: apiKey,
            autoRefreshToken: true
          }
        ]}
      />
      <TilesPlugin plugin={GLTFExtensionsPlugin} dracoLoader={dracoLoader} />
      <TilesPlugin plugin={TileCompressionPlugin} />
      <TilesPlugin plugin={UpdateOnChangePlugin} />
      <TilesPlugin plugin={TilesFadePlugin} />
      <TilesPlugin
        plugin={TileCreasedNormalsPlugin}
        args={[{ creaseAngle: radians(30) }]}
      />
      {children}
      <TilesAttributionOverlay />
    </TilesRenderer>
  )
}
