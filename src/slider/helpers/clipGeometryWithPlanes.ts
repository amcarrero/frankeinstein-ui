import {
  BufferAttribute,
  BufferGeometry,
  Float32BufferAttribute,
  InterleavedBufferAttribute,
  Plane,
  Vector3
} from 'three'

interface VertexData {
  position: Vector3
  attributes: Record<string, Float32Array>
}

function cloneVertex(vertex: VertexData): VertexData {
  const attributes: Record<string, Float32Array> = {}
  Object.keys(vertex.attributes).forEach(name => {
    attributes[name] = vertex.attributes[name].slice()
  })
  return {
    position: vertex.position.clone(),
    attributes
  }
}

function interpolateVertex(
  a: VertexData,
  b: VertexData,
  t: number
): VertexData {
  const position = new Vector3().copy(b.position).sub(a.position).multiplyScalar(t).add(a.position)
  const attributes: Record<string, Float32Array> = {}
  Object.keys(a.attributes).forEach(name => {
    const attrA = a.attributes[name]
    const attrB = b.attributes[name]
    const result = new Float32Array(attrA.length)
    for (let index = 0; index < attrA.length; index += 1) {
      result[index] = attrA[index] + (attrB[index] - attrA[index]) * t
    }
    attributes[name] = result
  })
  return { position, attributes }
}

function clipPolygonWithPlane(vertices: VertexData[], plane: Plane): VertexData[] {
  if (vertices.length === 0) {
    return vertices
  }
  const result: VertexData[] = []
  for (let index = 0; index < vertices.length; index += 1) {
    const current = vertices[index]
    const next = vertices[(index + 1) % vertices.length]
    const currentDistance = plane.distanceToPoint(current.position)
    const nextDistance = plane.distanceToPoint(next.position)
    const currentInside = currentDistance <= 0
    const nextInside = nextDistance <= 0

    if (currentInside && nextInside) {
      result.push(cloneVertex(next))
      continue
    }

    if (currentInside && !nextInside) {
      const t = currentDistance / (currentDistance - nextDistance)
      result.push(interpolateVertex(current, next, t))
      continue
    }

    if (!currentInside && nextInside) {
      const t = currentDistance / (currentDistance - nextDistance)
      result.push(interpolateVertex(current, next, t))
      result.push(cloneVertex(next))
    }
  }
  return result
}

function getAttributeComponent(
  attribute: BufferAttribute | InterleavedBufferAttribute,
  index: number,
  component: number
): number {
  switch (component) {
    case 0:
      return attribute.getX(index)
    case 1:
      return attribute.getY(index)
    case 2:
      return attribute.getZ(index)
    case 3:
      return attribute.getW(index)
    default:
      return attribute.array[index * attribute.itemSize + component]
  }
}

function toVertexData(
  geometry: BufferGeometry,
  index: number,
  attributeNames: string[]
): VertexData {
  const positionAttribute = geometry.getAttribute('position') as
    | BufferAttribute
    | InterleavedBufferAttribute
  const position = new Vector3(
    positionAttribute.getX(index),
    positionAttribute.getY(index),
    positionAttribute.getZ(index)
  )
  const attributes: Record<string, Float32Array> = {}
  attributeNames.forEach(name => {
    const attribute = geometry.getAttribute(name) as
      | BufferAttribute
      | InterleavedBufferAttribute
    const array = new Float32Array(attribute.itemSize)
    for (let component = 0; component < attribute.itemSize; component += 1) {
      array[component] = getAttributeComponent(attribute, index, component)
    }
    attributes[name] = array
  })
  return { position, attributes }
}

export function clipGeometryWithPlanes(
  geometry: BufferGeometry,
  planes: Plane[]
): BufferGeometry | null {
  const positionAttribute = geometry.getAttribute('position')
  if (
    !(
      positionAttribute instanceof BufferAttribute ||
      positionAttribute instanceof InterleavedBufferAttribute
    )
  ) {
    return null
  }
  const attributeNames = Object.keys(geometry.attributes).filter(
    name => name !== 'position'
  )
  // Add 'clipped' attribute to mark clipped triangles
  attributeNames.push('clipped')
  const hasIndex = geometry.index !== null
  const indexArray = hasIndex ? geometry.index!.array : null
  const triangleCount = hasIndex
    ? indexArray!.length / 3
    : positionAttribute.count / 3

  const attributeWriters: Record<string, number[]> = {}
  attributeNames.forEach(name => {
    attributeWriters[name] = []
  })

  const positions: number[] = []

  const pushVertex = (vertex: VertexData, clipped = false): void => {
    positions.push(vertex.position.x, vertex.position.y, vertex.position.z)
    attributeNames.forEach(name => {
      if (name === 'clipped') {
        attributeWriters[name].push(clipped ? 1 : 0)
        return
      }
      const values = vertex.attributes[name]
      const writer = attributeWriters[name]
      for (let component = 0; component < values.length; component += 1) {
        writer.push(values[component])
      }
    })
  }

  for (let triangleIndex = 0; triangleIndex < triangleCount; triangleIndex += 1) {
    const getIndex = (corner: number): number => {
      if (indexArray != null) {
        return Number(indexArray[triangleIndex * 3 + corner])
      }
      return triangleIndex * 3 + corner
    }
    let polygon = [
      toVertexData(geometry, getIndex(0), attributeNames),
      toVertexData(geometry, getIndex(1), attributeNames),
      toVertexData(geometry, getIndex(2), attributeNames)
    ]
  let wasClipped = false
    for (const plane of planes) {
      const before = polygon.length
      polygon = clipPolygonWithPlane(polygon, plane)
      if (polygon.length < 3) {
        wasClipped = true
        break
      }
      if (polygon.length < before) {
        wasClipped = true
      }
    }
    if (polygon.length < 3) {
      // Physically remove clipped triangle: do not push any vertices
      continue
    }
    const clipped = wasClipped
    for (let i = 1; i < polygon.length - 1; i += 1) {
      pushVertex(polygon[0], clipped)
      pushVertex(polygon[i], clipped)
      pushVertex(polygon[i + 1], clipped)
    }
  }

  if (positions.length === 0) {
    return null
  }

  const result = new BufferGeometry()
  result.setAttribute('position', new Float32BufferAttribute(positions, 3))
  attributeNames.forEach(name => {
    const writer = attributeWriters[name]
    if (writer.length === 0) {
      return
    }
    if (name === 'clipped') {
      result.setAttribute('clipped', new Float32BufferAttribute(writer, 1))
      return
    }
    const attribute = geometry.getAttribute(name) as BufferAttribute
    result.setAttribute(name, new Float32BufferAttribute(writer, attribute.itemSize))
  })
  return result
}
