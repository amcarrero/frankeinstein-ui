import { useEffect, useMemo } from 'react'
import { useThree } from '@react-three/fiber'
import { Box2, Matrix4, Plane, Vector2, Vector3 } from 'three'

import { Ellipsoid, Geodetic, radians } from '@takram/three-geospatial'

import { useControls } from './useControls'

type Coordinate = readonly [number, number]

type PolygonDefinition = {
  label: string
  coordinates: Coordinate[]
}

const polygonDefinitions: Record<string, PolygonDefinition | null> = {
  Off: null,
  Volpe: {
    label: 'Volpe',
    coordinates: [
      [-71.0836324261049, 42.36386927118764],
      [-71.08616660428874, 42.36493185147623],
      [-71.08714607193009, 42.36395542701564],
      [-71.08447196979746, 42.36277795380633]
    ]
  }
}

export interface PolygonRegion {
  planes: Plane[]
  center: Vector3
  east: Vector3
  north: Vector3
  up: Vector3
  orientation: Matrix4
  bounds: Box2
  // Polygon vertices projected to local East-North plane (relative to center)
  localPolygon: Vector2[]
}

interface PolygonClippingResult {
  enabled: boolean
  clippingPlanes?: Plane[]
  clipIntersection: boolean
  polygonKey: string
  mode: 'exclude interior' | 'keep interior'
  region?: PolygonRegion
}

const edge = new Vector3()
const surfaceNormal = new Vector3()
const planeNormal = new Vector3()
const scratchRelative = new Vector3()
const scratchPoint2 = new Vector2()


function removeDuplicateClosingVertex(coordinates: Coordinate[]): Coordinate[] {
  if (coordinates.length < 2) {
    return coordinates
  }
  const first = coordinates[0]
  const last = coordinates[coordinates.length - 1]
  if (Math.abs(first[0] - last[0]) < 1e-9 && Math.abs(first[1] - last[1]) < 1e-9) {
    return coordinates.slice(0, -1)
  }
  return coordinates
}

function coordinatesToECEF(coordinates: Coordinate[]): Vector3[] {
  return coordinates.map(([longitude, latitude]) =>
    new Geodetic(radians(longitude), radians(latitude)).toECEF()
  )
}

function createPolygonRegion(
  coordinates: Coordinate[] | undefined,
  invertNormals: boolean
): PolygonRegion | undefined {
  if (coordinates == null) {
    return undefined
  }
  const trimmed = removeDuplicateClosingVertex(coordinates)
  if (trimmed.length < 3) {
    return undefined
  }
  const vertices = coordinatesToECEF(trimmed)
  const center = new Vector3()
  let radiusSum = 0
  vertices.forEach(vertex => {
    center.add(vertex)
    radiusSum += vertex.length()
  })
  center.multiplyScalar(1 / vertices.length)
  const averageRadius = radiusSum / vertices.length
  center.normalize().multiplyScalar(averageRadius)

  const east = new Vector3()
  const north = new Vector3()
  const up = new Vector3()
  Ellipsoid.WGS84.getEastNorthUpVectors(center, east, north, up)

  const planes: Plane[] = []
  for (let index = 0; index < vertices.length; index += 1) {
    const current = vertices[index]
    const next = vertices[(index + 1) % vertices.length]
    edge.copy(next).sub(current)
    surfaceNormal.copy(current).normalize()
    planeNormal.copy(surfaceNormal).cross(edge)
    if (planeNormal.lengthSq() === 0) {
      continue
    }
    planeNormal.normalize()
    const plane = new Plane().setFromNormalAndCoplanarPoint(planeNormal, current)
    planes.push(plane)
  }
  const centerDistances = planes.map(plane => plane.distanceToPoint(center))
  // eslint-disable-next-line no-console
  import.meta.env.DEV && console.debug('[usePolygonClipping] center distances', centerDistances)
  const needsFlip = centerDistances.some(distance => distance >= 0)
  if (needsFlip) {
    planes.forEach(plane => {
      plane.negate()
    })
  }
  if (invertNormals) {
    planes.forEach(plane => {
      plane.negate()
    })
  }

  const bounds = new Box2().makeEmpty()
  const localPolygon: Vector2[] = []
  vertices.forEach(vertex => {
    scratchRelative.copy(vertex).sub(center)
    const eastCoord = scratchRelative.dot(east)
    const northCoord = scratchRelative.dot(north)
    scratchPoint2.set(eastCoord, northCoord)
    bounds.expandByPoint(scratchPoint2)
    localPolygon.push(scratchPoint2.clone())
  })

  if (planes.length === 0 || !Number.isFinite(bounds.min.x) || !Number.isFinite(bounds.min.y)) {
    return undefined
  }

  return {
    planes,
    center: center.clone(),
    east: east.clone(),
    north: north.clone(),
    up: up.clone(),
    orientation: new Matrix4()
      .makeBasis(east, up, north)
      .setPosition(center.clone()),
    bounds: bounds.clone(),
    localPolygon
  }
}

export function usePolygonClipping(): PolygonClippingResult {
  const [controlValues] = useControls(
    'clipping',
    () => ({
      enabled: { value: true },
      polygonKey: {
        label: 'Polygon',
        value: 'Volpe',
        options: Object.keys(polygonDefinitions)
      },
      mode: {
        label: 'Mode',
        value: 'exclude interior',
        options: {
          'Exclude interior': 'exclude interior',
          'Keep interior': 'keep interior'
        }
      },
      clipIntersection: {
        label: 'Clip intersection',
        value: true
      }
    }),
    { collapsed: true }
  ) as unknown as [{
    enabled: boolean
    polygonKey: keyof typeof polygonDefinitions
    mode: 'exclude interior' | 'keep interior'
    clipIntersection: boolean
  }]

  const { enabled, polygonKey, mode, clipIntersection } = controlValues

  const invertNormals = mode === 'keep interior'
  const definition = polygonDefinitions[polygonKey] ?? null

  const region = useMemo(() => {
    if (!enabled || definition == null) {
      return undefined
    }
    return createPolygonRegion(definition.coordinates, invertNormals)
  }, [definition, enabled, invertNormals])

  const clippingPlanes = region?.planes

  // eslint-disable-next-line no-console
  import.meta.env.DEV &&
    console.debug('[usePolygonClipping] enabled', enabled, 'polygon', polygonKey, 'planes', clippingPlanes?.length ?? 0)

  const { gl, invalidate } = useThree()
  useEffect(() => {
    if (clippingPlanes == null || clippingPlanes.length === 0) {
      if (gl.clippingPlanes.length > 0) {
        gl.clippingPlanes = []
      }
      if (gl.localClippingEnabled) {
        gl.localClippingEnabled = false
        invalidate()
      }
      return
    }
    if (gl.clippingPlanes.length > 0) {
      gl.clippingPlanes = []
    }
    if (!gl.localClippingEnabled) {
      gl.localClippingEnabled = true
      invalidate()
    }
    return () => {
      if (gl.clippingPlanes.length > 0) {
        gl.clippingPlanes = []
      }
      if (gl.localClippingEnabled) {
        gl.localClippingEnabled = false
        invalidate()
      }
    }
  }, [clippingPlanes, gl, invalidate])

  const isEnabled = enabled && clippingPlanes != null && clippingPlanes.length > 0

  return {
    enabled: isEnabled,
    clippingPlanes,
    clipIntersection,
    polygonKey,
    mode,
    region
  }
}
