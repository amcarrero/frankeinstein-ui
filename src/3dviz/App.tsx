import { useState, type FC } from 'react'

import FullTilesRendererExperience from './full/FullTilesRendererExperience'
import SimpleTilesRendererExperience from './simple/SimpleTilesRendererExperience'

const App: FC = () => {
  const [mode, setMode] = useState<'full' | 'simple'>('full')

  return (
    <>
      <div className='mode-toggle'>
        <button
          type='button'
          data-active={mode === 'full'}
          onClick={() => {
            setMode('full')
          }}
        >
          Full Experience
        </button>
        <button
          type='button'
          data-active={mode === 'simple'}
          onClick={() => {
            setMode('simple')
          }}
        >
          Simple Preview
        </button>
      </div>
      {mode === 'full' ? (
        <FullTilesRendererExperience />
      ) : (
        <SimpleTilesRendererExperience />
      )}
    </>
  )
}

export default App
