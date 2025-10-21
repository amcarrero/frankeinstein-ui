import { Suspense, type FC } from 'react'

import ThreeDVizApp from './3dviz/App'
import OverlayExperience from './overlay/App'

const App: FC = () => {
  return (
    <div className='root-shell'>
      <div className='background-layer'>
          <ThreeDVizApp />
      </div>
      <div className='overlay-layer'>
        <OverlayExperience />
      </div>
    </div>
  )
}

export default App
