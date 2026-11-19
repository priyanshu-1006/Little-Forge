import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import '@fontsource-variable/space-grotesk'
import '@fontsource-variable/bricolage-grotesque'
import '@fontsource-variable/inter'
import '@fontsource/ibm-plex-mono/400.css'
import { SiteHeader, SiteFooter, RouteEffects } from '@/components/layout'
import { Home } from '@/pages/home'
import { DocsPage, NotFound } from '@/pages/docs'
import { DownloadPage } from '@/pages/download'
import './styles.css'

function LandingPage() {
  useEffect(() => { document.title = 'Little Forge — Your code. Your call.' }, [])
  return <Home />
}

function App() {
  return (
    <BrowserRouter>
      <RouteEffects />
      <SiteHeader />
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/download" element={<DownloadPage />} />
        <Route path="/docs/:slug?" element={<DocsPage />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
      <SiteFooter />
    </BrowserRouter>
  )
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
