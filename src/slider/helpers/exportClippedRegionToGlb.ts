import type { TilesRenderer as TilesRendererImpl } from '3d-tiles-renderer'
import {
  BufferGeometry,
  Group,
  Material,
  Mesh,
  Plane,
  type Object3D
} from 'three'
import { GLTFExporter } from 'three-stdlib'

import { clipGeometryWithPlanes } from './clipGeometryWithPlanes'

interface ExportClippedRegionOptions {
  tiles: TilesRendererImpl
  planes: Plane[]
  fileName: string
}

function cloneMaterial(material: Material): Material {
  const cloned = material.clone()
  cloned.clippingPlanes = null
  cloned.clipIntersection = false
  cloned.clipShadows = false
  return cloned
}

function gatherMeshes(root: Object3D): Mesh[] {
  const meshes: Mesh[] = []
  root.traverse(object => {
    if (object instanceof Mesh) {
      meshes.push(object)
    }
  })
  return meshes
}

export async function exportClippedRegionToGlb({
  tiles,
  planes,
  fileName
}: ExportClippedRegionOptions): Promise<void> {
  if (planes.length === 0) {
    throw new Error('No clipping planes provided.')
  }
  tiles.group.updateMatrixWorld(true)
  const exporter = new GLTFExporter()
  const exportGroup = new Group()

  const meshes = gatherMeshes(tiles.group)
  for (const mesh of meshes) {
    if (mesh.visible === false) {
      continue
    }
    const geometry = mesh.geometry
    if (!(geometry instanceof BufferGeometry)) {
      continue
    }
    const worldGeometry = geometry.clone()
    worldGeometry.applyMatrix4(mesh.matrixWorld)
    const clipped = clipGeometryWithPlanes(worldGeometry, planes)
    if (clipped == null) {
      continue
    }
    if (clipped.getAttribute('normal') != null) {
      clipped.computeVertexNormals()
    }
    clipped.computeBoundingSphere()
    clipped.computeBoundingBox()
    if (Array.isArray(mesh.material)) {
      continue
    }
    const material = mesh.material
    if (material == null) {
      continue
    }
    const exportMesh = new Mesh(clipped, cloneMaterial(material))
    exportGroup.add(exportMesh)
  }

  if (exportGroup.children.length === 0) {
    throw new Error('No geometry found inside the clipped region.')
  }

  const arrayBuffer = await new Promise<ArrayBuffer>((resolve, reject) => {
    exporter.parse(
      exportGroup,
      result => {
        if (result instanceof ArrayBuffer) {
          resolve(result)
          return
        }
        if (result instanceof Blob) {
          result.arrayBuffer().then(resolve).catch(reject)
          return
        }
        reject(new Error('Unexpected GLTF export result.'))
      },
      reject,
      { binary: true }
    )
  })

  const blob = new Blob([arrayBuffer], {
    type: 'model/gltf-binary'
  })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  setTimeout(() => {
    URL.revokeObjectURL(url)
  }, 0)
}
