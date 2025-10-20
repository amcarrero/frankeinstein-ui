import { Suspense, type FC } from 'react'

import ThreeDVizApp from './3dviz/App'
import OverlayExperience from './overlay/App'

const App: FC = () => {
  return (
    <div className='root-shell'>
      <div className='background-layer'>
        <Suspense fallback={<div className='loading-banner'>Loading visualization…</div>}>
          <ThreeDVizApp />
        </Suspense>
      </div>
      <div className='overlay-layer'>
        <OverlayExperience />
      </div>
    </div>
  )
}

export default App
