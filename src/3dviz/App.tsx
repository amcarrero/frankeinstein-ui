import { useState, type FC } from 'react'

import FullTilesRendererExperience from './full/FullTilesRendererExperience'

const App: FC = () => {
  const [reloadCount, setReloadCount] = useState(0)

  return (
    <>
      <div className='mode-toggle'>
        <button
          type='button'
          onClick={() => {
            setReloadCount(previous => previous + 1)
          }}
        >
          Reload Experience
        </button>
      </div>
      <FullTilesRendererExperience key={reloadCount} />
    </>
  )
}

export default App
