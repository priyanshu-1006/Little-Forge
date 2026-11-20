import { ArrowUpRight, BookOpen, Download, FileCheck2, GitFork, Package, Terminal } from 'lucide-react'
import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { CodeBlock } from '@/components/code-block'
import { project } from '@/data/product'

export function DownloadPage() {
  useEffect(() => { document.title = 'Download Little Forge for VS Code or Terminal' }, [])
  const { release, cliRelease } = project

  return (
    <main id="main-content" className="wrap download-page">
      <section className="download-hero" aria-labelledby="download-title">
        <div>
          <p className="eyebrow"><Package size={17} /> VS Code extension</p>
          <h1 id="download-title">Download<br />Little Forge.</h1>
          <p>Install the VSIX in VS Code and connect your local TrueForge harness.</p>
          <div className="cta-actions">
            <Button asChild size="lg"><a href={release.file} download={release.filename}><Download /> Download v{release.version}</a></Button>
            <Button asChild size="lg" variant="outline"><Link to="/download#cli-download-title"><Terminal /> Terminal CLI</Link></Button>
          </div>
        </div>
        <img src="/brand/little-forge.webp" alt="" width="224" height="214" />
      </section>
      <div className="download-content">
        <section aria-labelledby="setup-title" className="setup-panel">
          <p className="eyebrow"><Terminal size={16} /> Install the release</p>
          <h2 id="setup-title">Ready in your editor.</h2>
          <p>Open <strong>Extensions</strong> in VS Code, select the three-dot menu, choose <strong>Install from VSIX</strong>, and pick the downloaded file.</p>
          <CodeBlock label="VS Code CLI" value={`code --install-extension ${release.filename}`} />
          <p>Start TrueForge and configure a model before opening the Little Forge panel.</p>
          <Button asChild variant="outline"><Link to="/docs/installation"><BookOpen /> Follow the setup guide</Link></Button>
        </section>
        <aside className="release-panel" aria-labelledby="release-title">
          <p className="eyebrow"><FileCheck2 size={16} /> Release details</p><h2 id="release-title">Version {release.version}</h2>
          <dl>
            <div><dt>Package</dt><dd>{release.filename}</dd></div>
            <div><dt>Size</dt><dd>{Math.round(release.bytes / 1024)} KiB</dd></div>
            <div><dt>VS Code</dt><dd>{release.vscode} or newer</dd></div>
            <div><dt>Node.js for the harness</dt><dd>{release.node} or newer</dd></div>
          </dl>
          <CodeBlock label="SHA-256" value={release.sha256} />
          <Button asChild variant="ghost"><a href={project.repository} target="_blank" rel="noreferrer"><GitFork /> View source</a></Button>
        </aside>
      </div>
      <section className="cli-download-panel" aria-labelledby="cli-download-title">
        <div>
          <p className="eyebrow"><Terminal size={16} /> Terminal CLI</p>
          <h2 id="cli-download-title">Little Forge in your terminal.</h2>
          <p>Open an interactive coding workspace with a streaming conversation, Ask, Plan and Build modes, and inline diff approval.</p>
          <div className="cta-actions">
            <Button asChild><a href={project.npmPackage} target="_blank" rel="noreferrer">View on npm <ArrowUpRight /></a></Button>
            <Button asChild variant="outline"><Link to="/docs/cli"><BookOpen /> CLI guide</Link></Button>
          </div>
          <a className="cli-archive-link" href={cliRelease.file} download={cliRelease.filename}>Download CLI archive v{cliRelease.version}</a>
        </div>
        <CodeBlock label="Install from the npm registry" value={project.cliInstall} />
      </section>
      <section className="faq-section" aria-labelledby="faq-title">
        <h2 id="faq-title">Before you install.</h2>
        <Accordion type="single" collapsible>
          <AccordionItem value="harness"><AccordionTrigger>What needs to run locally?</AccordionTrigger><AccordionContent>VS Code and the TrueForge harness run on your machine. Your model can be hosted by a configured provider or a compatible local endpoint.</AccordionContent></AccordionItem>
          <AccordionItem value="models"><AccordionTrigger>Where do I configure a model?</AccordionTrigger><AccordionContent>Open Providers &amp; models in Little Forge and use the provider setup or TrueForge settings. <Link to="/docs/models">Read the provider guide.</Link></AccordionContent></AccordionItem>
          <AccordionItem value="source"><AccordionTrigger>Can I build the extension from source?</AccordionTrigger><AccordionContent>Yes. Run <code>npm ci</code> and <code>npm run package</code> from the Little Forge repository root to create a VSIX.</AccordionContent></AccordionItem>
        </Accordion>
      </section>
    </main>
  )
}
