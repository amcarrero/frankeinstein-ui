import type { Material, Object3D, Plane } from 'three'
import { Line, LineSegments, Mesh, Points } from 'three'

type ClippableObject = Mesh | Line | LineSegments | Points

function getMaterials(object: ClippableObject): Material[] {
  const material = object.material
  if (Array.isArray(material)) {
    return material
  }
  return material != null ? [material] : []
}

export function applyClippingPlanesToObject(
  root: Object3D,
  planes: Plane[] | null,
  clipIntersection: boolean
): void {
  root.traverse(object => {
    if (
      object instanceof Mesh ||
      object instanceof Line ||
      object instanceof LineSegments ||
      object instanceof Points
    ) {
      const materials = getMaterials(object)
      materials.forEach(currentMaterial => {
        currentMaterial.clippingPlanes = planes
        currentMaterial.clipIntersection = clipIntersection
        if ('clipping' in currentMaterial) {
          ;(currentMaterial as Material & { clipping?: boolean }).clipping = planes != null
        }
        currentMaterial.needsUpdate = true
      })
    }
  })
}
