import { BookOpen, Download, GitFork, Menu, Search } from 'lucide-react'
import { useEffect } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { project } from '@/data/product'
import { DocsSearch } from './docs-search'

const links = [
  { label: 'Workflows', to: '/#workflows' },
  { label: 'Demo', to: '/#demo' },
  { label: 'Documentation', to: '/docs' },
]

export function Brand() {
  return (
    <Link to="/" className="brand" aria-label="Little Forge home">
      <span className="brand-icon"><img src="/brand/little-forge.webp" alt="" width="26" height="26" /></span>
      <span>Little Forge<span className="brand-period">.</span></span>
    </Link>
  )
}

export function SiteHeader() {
  const location = useLocation()
  return (
    <header className="site-header">
      <a className="skip-link" href="#main-content">Skip to content</a>
      <div className="site-header-inner">
        <Brand />
        <nav aria-label="Main navigation" className="desktop-nav">
          {links.map(({ label, to }) => to.startsWith('/#')
            ? <Link key={to} to={to} aria-current={location.pathname === '/' && location.hash === to.slice(1) ? 'location' : undefined}>{label}</Link>
            : <NavLink key={to} to={to}>{label}</NavLink>)}
        </nav>
        <div className="flex items-center gap-2.5">
          <DocsSearch keyboardShortcut trigger={<Button variant="ghost" size="icon" className="header-search" aria-label="Search documentation"><Search /></Button>} />
          <Button asChild variant="ghost" size="icon" className="github-button">
            <a href={project.repository} target="_blank" rel="noreferrer" aria-label="Little Forge on GitHub"><GitFork /></a>
          </Button>
          <Button asChild className="header-download" size="sm"><Link to="/download"><Download /> Download</Link></Button>
          <Dialog>
            <DialogTrigger asChild><Button variant="outline" size="icon" className="mobile-menu" aria-label="Open navigation"><Menu /></Button></DialogTrigger>
            <DialogContent className="mobile-dialog">
              <DialogTitle>Little Forge</DialogTitle>
              <DialogDescription className="sr-only">Website navigation</DialogDescription>
              <nav aria-label="Mobile navigation">
                {[...links, { label: 'Download', to: '/download' }].map(({ label, to }) => (
                  <DialogClose key={to} asChild><Link to={to}>{label}</Link></DialogClose>
                ))}
                <a href={project.repository} target="_blank" rel="noreferrer">GitHub</a>
              </nav>
            </DialogContent>
          </Dialog>
        </div>
      </div>
    </header>
  )
}

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="wrap footer-main">
        <div><Brand /><p>A coding agent for VS Code, powered by TrueForge.</p></div>
        <nav aria-label="Footer navigation" className="footer-nav">
          <Link to="/docs"><BookOpen size={16} /> Documentation</Link>
          <Link to="/download"><Download size={16} /> Download</Link>
          <a href={project.repository} target="_blank" rel="noreferrer"><GitFork size={16} /> Source on GitHub</a>
        </nav>
      </div>
      <div className="wrap footer-base"><span>Built by Optimistic Mutant Coders</span><a href={`${project.repository}/blob/main/LICENSE`} target="_blank" rel="noreferrer">MIT License</a></div>
    </footer>
  )
}

export function RouteEffects() {
  const { pathname, hash, key } = useLocation()
  useEffect(() => {
    if (!hash) {
      window.scrollTo({ top: 0, behavior: 'instant' })
      return
    }
    let fragment: string
    try { fragment = decodeURIComponent(hash.slice(1)) } catch { return }
    const handle = requestAnimationFrame(() => document.getElementById(fragment)?.scrollIntoView({ block: 'start' }))
    return () => cancelAnimationFrame(handle)
  }, [pathname, hash, key])
  return null
}
