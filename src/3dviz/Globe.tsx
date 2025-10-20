import { TilesRenderer } from '3d-tiles-renderer/r3f'
import {
  GLTFExtensionsPlugin,
  GoogleCloudAuthPlugin,
  TileCompressionPlugin,
  UpdateOnChangePlugin
} from '3d-tiles-renderer/plugins'
import { TilesPlugin } from '3d-tiles-renderer/r3f'
import { DRACOLoader } from 'three-stdlib'
import type { FC, ReactNode } from 'react'

const dracoLoader = new DRACOLoader()
dracoLoader.setDecoderPath('https://www.gstatic.com/draco/v1/decoders/')

interface GlobeProps {
  apiKey: string
  children?: ReactNode
}

export const Globe: FC<GlobeProps> = ({ apiKey, children }) => {
  return (
    <TilesRenderer
      url={`https://tile.googleapis.com/v1/3dtiles/root.json?key=${apiKey}`}
    >
      <TilesPlugin
        plugin={GoogleCloudAuthPlugin}
        apiToken={apiKey}
        autoRefreshToken={true}
      />
      <TilesPlugin plugin={GLTFExtensionsPlugin} dracoLoader={dracoLoader} />
      <TilesPlugin plugin={TileCompressionPlugin} />
      <TilesPlugin plugin={UpdateOnChangePlugin} />
      {children}
    </TilesRenderer>
  )
}
