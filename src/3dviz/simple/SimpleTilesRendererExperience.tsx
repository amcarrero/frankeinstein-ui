import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { ToneMapping } from '@react-three/postprocessing'
import { GlobeControls } from '3d-tiles-renderer/r3f'
import {
  EffectMaterial,
  type EffectComposer as EffectComposerImpl
} from 'postprocessing'
import {
  ChangeEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FC
} from 'react'
import { addDays, startOfYear } from 'date-fns'
import { useAtom } from 'jotai'

import {
  Atmosphere,
  Sky,
  Stars,
  type AtmosphereApi
} from '@takram/three-atmosphere/r3f'
import { Geodetic, PointOfView, radians } from '@takram/three-geospatial'
import { Dithering } from '@takram/three-geospatial-effects/r3f'
import { SRGBColorSpace } from 'three'

import { EffectComposer } from '../helpers/EffectComposer'
import { Globe } from '../helpers/Globe'
import { GoogleMapsAPIKeyPrompt } from '../helpers/GoogleMapsAPIKeyPrompt'
import { Stats } from '../helpers/Stats'
import { googleMapsApiKeyAtom } from '../helpers/states'

interface SimpleSettings {
  longitude: number
  latitude: number
  heading: number
  pitch: number
  distance: number
  dayOfYear: number
  timeOfDay: number
  exposure: number
}

const LOCATION_PRESETS = {
  manhattan: {
    label: 'Manhattan',
    settings: {
      longitude: -73.9709,
      latitude: 40.7589,
      heading: -155,
      pitch: -35,
      distance: 3000,
      dayOfYear: 1,
      timeOfDay: 7.6,
      exposure: 60
    }
  },
  volpe: {
    label: 'Volpe Center',
    settings: {
      longitude: -71.08540479612309,
      latitude: 42.36392670841971,
      heading: -155,
      pitch: -35,
      distance: 1000,
      dayOfYear: 1,
      timeOfDay: 7.6,
      exposure: 60
    }
  },
  fuji: {
    label: 'Mt Fuji',
    settings: {
      longitude: 138.5973,
      latitude: 35.2138,
      heading: 71,
      pitch: -31,
      distance: 7000,
      dayOfYear: 260,
      timeOfDay: 16,
      exposure: 10
    }
  }
} as const

type PresetKey = keyof typeof LOCATION_PRESETS | 'custom'

const DEFAULT_PRESET: PresetKey = 'manhattan'

const getDateFromControls = (dayOfYear: number, timeOfDay: number): Date => {
  const clampedDay = Math.min(Math.max(Math.round(dayOfYear), 1), 366)
  const clampedTime = Math.min(Math.max(timeOfDay, 0), 24)
  const currentYear = new Date().getFullYear()
  const start = startOfYear(new Date(currentYear, 0, 1))
  const date = addDays(start, clampedDay - 1)
  const hours = Math.floor(clampedTime)
  const minutes = Math.round((clampedTime - hours) * 60)
  date.setHours(hours, minutes, 0, 0)
  return date
}

const SimpleScene: FC<{ settings: SimpleSettings }> = ({ settings }) => {
  const {
    longitude,
    latitude,
    heading,
    pitch,
    distance,
    dayOfYear,
    timeOfDay,
    exposure
  } = settings

  const renderer = useThree(({ gl }) => gl)
  useEffect(() => {
    if (renderer != null) {
      renderer.outputColorSpace = SRGBColorSpace
    }
  }, [renderer])

  const camera = useThree(({ camera }) => camera)
  useLayoutEffect(() => {
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
  const motionDate = useMemo(
    () => getDateFromControls(dayOfYear, timeOfDay),
    [dayOfYear, timeOfDay]
  )
  const dateRef = useRef(motionDate)
  useEffect(() => {
    dateRef.current = motionDate
  }, [motionDate])

  useFrame(() => {
    atmosphereRef.current?.updateByDate(dateRef.current)
  })

  return (
    <Atmosphere ref={atmosphereRef} correctAltitude>
      <Sky />
      <Stars data='atmosphere/stars.bin' />
      <Globe />
      <GlobeControls enableDamping />
      <EffectComposer ref={composerRef} multisampling={0}>
        <ToneMapping mode='AgX' exposure={exposure} />
        <Dithering />
      </EffectComposer>
    </Atmosphere>
  )
}

export const SimpleTilesRendererExperience: FC = () => {
  const [activePreset, setActivePreset] = useState<PresetKey>(DEFAULT_PRESET)
  const [settings, setSettings] = useState<SimpleSettings>(
    LOCATION_PRESETS[DEFAULT_PRESET].settings
  )
  const [apiKey, setApiKey] = useAtom(googleMapsApiKeyAtom)

  const applyPreset = (preset: PresetKey) => {
    if (preset === 'custom') {
      return
    }
    setSettings(LOCATION_PRESETS[preset].settings)
  }

  const handlePresetChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const preset = event.target.value as PresetKey
    setActivePreset(preset)
    applyPreset(preset)
  }

  const handleNumberChange = (field: keyof SimpleSettings) =>
    (event: ChangeEvent<HTMLInputElement>) => {
      const nextValue = event.target.valueAsNumber
      if (!Number.isFinite(nextValue)) {
        return
      }
      setSettings(previous => ({
        ...previous,
        [field]: nextValue
      }))
      setActivePreset('custom')
    }

  const handleApiKeyChange = (event: ChangeEvent<HTMLInputElement>) => {
    setApiKey(event.target.value)
  }

  const handleReset = () => {
    setActivePreset(DEFAULT_PRESET)
    setSettings(LOCATION_PRESETS[DEFAULT_PRESET].settings)
  }

  return (
    <>
      <div className='controls'>
        <h2>Simple Controls</h2>
        <div className='control-group'>
          <label htmlFor='preset'>Location preset</label>
          <select
            id='preset'
            value={activePreset}
            onChange={handlePresetChange}
          >
            {Object.entries(LOCATION_PRESETS).map(([key, { label }]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
            <option value='custom'>Custom (manual)</option>
          </select>
        </div>
        <div className='control-group'>
          <label htmlFor='latitude'>Latitude (°)</label>
          <input
            id='latitude'
            type='number'
            step='0.0001'
            value={settings.latitude}
            onChange={handleNumberChange('latitude')}
          />
        </div>
        <div className='control-group'>
          <label htmlFor='longitude'>Longitude (°)</label>
          <input
            id='longitude'
            type='number'
            step='0.0001'
            value={settings.longitude}
            onChange={handleNumberChange('longitude')}
          />
        </div>
        <div className='control-group'>
          <label htmlFor='heading'>Heading (°)</label>
          <input
            id='heading'
            type='number'
            step='1'
            value={settings.heading}
            onChange={handleNumberChange('heading')}
          />
        </div>
        <div className='control-group'>
          <label htmlFor='pitch'>Pitch (°)</label>
          <input
            id='pitch'
            type='number'
            step='1'
            value={settings.pitch}
            onChange={handleNumberChange('pitch')}
          />
        </div>
        <div className='control-group'>
          <label htmlFor='distance'>Distance (m)</label>
          <input
            id='distance'
            type='number'
            step='10'
            value={settings.distance}
            onChange={handleNumberChange('distance')}
          />
        </div>
        <div className='control-group'>
          <label htmlFor='day-of-year'>Day of year</label>
          <input
            id='day-of-year'
            type='number'
            min='1'
            max='366'
            value={settings.dayOfYear}
            onChange={handleNumberChange('dayOfYear')}
          />
        </div>
        <div className='control-group'>
          <label htmlFor='time-of-day'>Time of day (hours)</label>
          <input
            id='time-of-day'
            type='number'
            min='0'
            max='24'
            step='0.1'
            value={settings.timeOfDay}
            onChange={handleNumberChange('timeOfDay')}
          />
        </div>
        <div className='control-group'>
          <label htmlFor='exposure'>Exposure</label>
          <input
            id='exposure'
            type='number'
            min='0'
            step='0.5'
            value={settings.exposure}
            onChange={handleNumberChange('exposure')}
          />
        </div>
        <div className='control-group'>
          <label htmlFor='google-maps-api-key'>Google Maps API key</label>
          <input
            id='google-maps-api-key'
            type='text'
            value={apiKey}
            onChange={handleApiKeyChange}
            placeholder='Optional override'
          />
        </div>
        <div className='control-group'>
          <button type='button' onClick={handleReset}>
            Reset to default
          </button>
        </div>
      </div>
      <Canvas>
        <Stats />
        <SimpleScene settings={settings} />
      </Canvas>
      <GoogleMapsAPIKeyPrompt />
    </>
  )
}

export default SimpleTilesRendererExperience
