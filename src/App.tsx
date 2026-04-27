import { useEffect, useState } from 'react'
import OcrWorkspace from './features/ocr/OcrWorkspace'
import LandingPage from './pages/LandingPage'

function App() {
  const [route, setRoute] = useState(() => window.location.hash)

  useEffect(() => {
    const updateRoute = () => setRoute(window.location.hash)

    window.addEventListener('hashchange', updateRoute)

    return () => window.removeEventListener('hashchange', updateRoute)
  }, [])

  return route === '#app' ? <OcrWorkspace /> : <LandingPage />
}

export default App
