import { ArrowUpRight, BookOpen, Check, Code2, Download, Maximize2, Package, Play, Radio, Workflow } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { MotionClip, NarratedDemo } from '@/components/media'
import { AgentShowcase, HeroPrompt, useReducedMotion } from '@/components/agent-demo'
import { CliShowcase } from '@/components/cli-showcase'
import { project, providers, workflows } from '@/data/product'

const heroAlt = 'Little Forge inside VS Code. The native Flask diff is open beside Impact Radar, which lists downstream files and related tests.'

function Hero({ reduced }: { reduced: boolean }) {
  return (
    <section className="hero" aria-labelledby="home-title">
      <div className="hero-inner">
        <div className="hero-copy">
          <div className="eyebrow hero-eyebrow"><Code2 size={18} /> VS Code &amp; terminal</div>
          <h1 id="home-title">Your code.<br />Your <em>call.</em></h1>
          <p>Little Forge reads your repository, proposes changes, and puts every hunk up for review in VS Code or your terminal.</p>
          <HeroPrompt reduced={reduced} />
          <div className="hero-actions">
            <Button asChild size="lg"><a href={project.release.file} download={project.release.filename}><Download /> Download for VS Code</a></Button>
            <Button asChild size="lg" variant="outline"><Link to="/#demo"><Play /> Watch the demo</Link></Button>
          </div>
          <a className="hero-registry-link" href={project.npmPackage} target="_blank" rel="noreferrer">
            <Package size={16} aria-hidden="true" /> Little Forge CLI on npm <ArrowUpRight size={15} aria-hidden="true" />
          </a>
          <div className="hero-meta"><span>v{project.release.version} · VSIX</span><span>Open source</span><span>Runs on TrueForge</span></div>
        </div>
        <figure className="hero-workbench">
          <div className="hero-laptop">
            <img className="laptop-chassis" src="/brand/forge-laptop.webp" alt="" width="1508" height="872" fetchPriority="high" />
            <div className="laptop-display">
              <Dialog>
                <DialogTrigger asChild>
                  <button className="laptop-native-view" type="button" aria-label="Enlarge VS Code screenshot">
                    <img src="/media/workbench.webp" alt={heroAlt} width="1280" height="681" fetchPriority="high" />
                    <span className="expand-image"><Maximize2 size={16} aria-hidden="true" /></span>
                  </button>
                </DialogTrigger>
                <DialogContent className="image-dialog">
                  <DialogTitle>Little Forge in VS Code</DialogTitle>
                  <DialogDescription>Native inline diff and Impact Radar from the Flask demo.</DialogDescription>
                  <img src="/media/workbench.webp" alt={heroAlt} width="1280" height="681" />
                </DialogContent>
              </Dialog>
            </div>
          </div>
          <figcaption>VS Code recording</figcaption>
        </figure>
      </div>
    </section>
  )
}

function ProviderRail() {
  return (
    <section className="wrap provider-rail" aria-label="Supported model providers">
      <Link className="provider-caption" to="/docs/models"><Workflow size={19} /> Your model, via TrueForge</Link>
      <ul>{providers.map(({ name, icon }) => (
        <li key={icon}><img src={`/brand/providers/${icon}.svg`} alt="" width="20" height="20" />{name}</li>
      ))}</ul>
    </section>
  )
}

function Workflows() {
  return (
    <section id="workflows" className="wrap workflows-section section-space" aria-labelledby="workflows-title">
      <div className="section-intro workflow-heading">
        <div><p className="eyebrow">Working in Little Forge</p><h2 id="workflows-title">From prompt to patch.</h2></div>
        <p>Explore the real VS Code workflow, from a function-sized edit to a multi-file proposal.</p>
      </div>
      <Tabs defaultValue="inline" className="workbench-tabs">
        <TabsList className="workbench-tab-list" aria-label="Feature previews">
          {workflows.map(({ id, label, icon: Icon }) => (
            <TabsTrigger className="workbench-tab" value={id} key={id}><Icon size={18} />{label}</TabsTrigger>
          ))}
        </TabsList>
        {workflows.map(({ id, title, description, notes, media, alt, docs }) => (
          <TabsContent value={id} key={id} className="workbench-stage">
            <div className="stage-copy">
              <h3>{title}</h3>
              <p>{description}</p>
              <ul>{notes.map((note) => <li key={note}><Check size={17} />{note}</li>)}</ul>
              <Button asChild variant="outline"><Link to={docs}><BookOpen /> Open the guide</Link></Button>
            </div>
            <div className="stage-screen"><MotionClip media={media} label={alt} /></div>
          </TabsContent>
        ))}
      </Tabs>
    </section>
  )
}

function Demo() {
  return (
    <section id="demo" aria-labelledby="demo-title" className="demo-section">
      <div className="wrap demo-grid">
        <div className="demo-copy">
          <p className="eyebrow"><Radio size={16} /> Narrated walkthrough</p>
          <h2 id="demo-title">Inside a real run.</h2>
          <p>Watch Little Forge edit Flask, review a four-file change, and recover when a model endpoint refuses the connection.</p>
          <dl><div><dt>Runtime</dt><dd>3:52</dd></div><div><dt>Demo repository</dt><dd>Flask 3.1.3</dd></div></dl>
        </div>
        <NarratedDemo />
      </div>
    </section>
  )
}

const tools = [
  { title: 'Task Contract & Guard', copy: 'Define the change scope and inspect what requires approval.', image: 'task-contract', alt: 'Task Contract shows permission choices, a required command approval, and a maximum number of files.' },
  { title: 'Repro to Regression', copy: 'Turn a failure report into a red–green test workflow.', image: 'repro-test', alt: 'Repro to Regression form with fields for a failure description, stack trace, and target file.' },
  { title: 'Tools & Diagnostics', copy: 'See workspace signals and open the matching TrueForge session.', image: 'tools-panel', alt: 'Little Forge Tools & Diagnostics drawer showing Signals, Memory, Guard, and Session.' },
]

function EditorTools() {
  return (
    <section className="wrap section-space tools-section" aria-labelledby="tools-title">
      <div className="section-intro workflow-heading">
        <div><p className="eyebrow">The editor toolset</p><h2 id="tools-title">Control at each step.</h2></div>
        <Button asChild variant="outline"><Link to="/docs/review"><BookOpen /> Review and checks</Link></Button>
      </div>
      <div className="tools-grid">
        {tools.map(({ title, copy, image, alt }) => (
          <Dialog key={image}>
            <article className={`tool-card tool-${image}`}>
              <div className="tool-copy"><h3>{title}</h3><p>{copy}</p></div>
              <DialogTrigger asChild><button type="button" className="tool-image" aria-label={`Enlarge ${title} screenshot`}>
                <img src={`/media/${image}.webp`} alt={alt} loading="lazy" />
                <span className="expand-image"><Maximize2 size={15} aria-hidden="true" /></span>
              </button></DialogTrigger>
            </article>
            <DialogContent className="image-dialog tall-image-dialog">
              <DialogTitle>{title}</DialogTitle><DialogDescription>{copy}</DialogDescription>
              <img src={`/media/${image}.webp`} alt={alt} />
            </DialogContent>
          </Dialog>
        ))}
      </div>
    </section>
  )
}

export function Home() {
  const reduced = useReducedMotion()
  return (
    <main id="main-content">
      <Hero reduced={reduced} />
      <ProviderRail />
      <CliShowcase />
      <AgentShowcase reduced={reduced} />
      <Workflows />
      <Demo />
      <EditorTools />
      <section className="wrap cta-panel" aria-labelledby="cta-title">
        <div><h2 id="cta-title">Make your first edit.</h2><p>Install the VSIX, start TrueForge, and open a repository in VS Code.</p></div>
        <div className="cta-actions">
          <Button asChild size="lg"><a href={project.release.file} download={project.release.filename}><Download /> Download v{project.release.version}</a></Button>
          <Button asChild size="lg" variant="outline"><Link to="/docs/installation"><BookOpen /> Installation guide</Link></Button>
        </div>
      </section>
    </main>
  )
}
