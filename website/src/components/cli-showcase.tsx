import { ArrowUpRight, BookOpen, Package, Terminal } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { CodeBlock } from '@/components/code-block'
import { project } from '@/data/product'

const examples = [
  {
    id: 'ask', title: 'Ask', prompt: 'Where are CLI commands registered?',
    activity: 'Read src/flask/cli.py', status: 'Read-only answer',
    lines: [{ text: 'FlaskGroup registers the built-in commands in its constructor.' }, { text: 'Commands can use with_appcontext to access the active app.' }],
  },
  {
    id: 'plan', title: 'Plan', prompt: 'Plan a CLI command that prints app config.',
    activity: 'Read source, tests, and CLI docs', status: 'Read-only plan',
    lines: [{ text: '1. Register the command in src/flask/cli.py.' }, { text: '2. Mask sensitive config values and emit JSON.' }, { text: '3. Add a CLI test and document the command.' }],
  },
  {
    id: 'build', title: 'Build', prompt: 'Treat off as a false debug flag.',
    activity: 'Staged src/flask/helpers.py', status: 'Review required',
    lines: [
      { text: '-    val.lower() not in {"0", "false", "no"}', tone: 'removed' },
      { text: '+    val.lower() not in {"0", "false", "no", "off"}', tone: 'added' },
    ],
  },
] as const

export function CliShowcase() {
  return (
    <section id="cli" className="wrap cli-showcase" aria-labelledby="cli-title">
      <div className="cli-showcase-copy">
        <p className="eyebrow"><Terminal size={17} aria-hidden="true" /> Terminal CLI</p>
        <h2 id="cli-title">Little Forge in your terminal.</h2>
        <p>Ask about a repository, plan a change, or review a patch in a full-screen terminal workspace. TrueForge runs each turn.</p>
        <div className="cli-ecosystem">
          <a href="https://nodejs.org/" className="cli-ecosystem-link" target="_blank" rel="noreferrer">
            <img src="/brand/nodejs.svg" width="87" height="27" alt="Node.js®" loading="lazy" />
            <span>{project.release.node} or newer</span>
          </a>
          <a href={project.npmPackage} className="cli-ecosystem-link" target="_blank" rel="noreferrer">
            <span className="cli-registry-label"><Package size={17} aria-hidden="true" /> npm registry</span>
            <span>little-forge-cli <ArrowUpRight size={12} aria-hidden="true" /></span>
          </a>
        </div>
        <CodeBlock label="Install the CLI" value={project.cliInstall} />
        <div className="cli-showcase-actions">
          <Button asChild><a href={project.npmPackage} target="_blank" rel="noreferrer">View package on npm <ArrowUpRight /></a></Button>
          <Button asChild variant="outline"><Link to="/docs/cli"><BookOpen /> CLI guide</Link></Button>
        </div>
      </div>
      <div className="cli-showcase-preview">
        <Tabs defaultValue="build" className="cli-shell">
          <div className="cli-shell-bar">
            <span><Terminal size={15} aria-hidden="true" /> little-forge <span className="cli-shell-path">/ pallets/flask</span></span>
            <TabsList className="cli-shell-modes" aria-label="Terminal preview modes">
              {examples.map(({ id, title }) => <TabsTrigger key={id} className="cli-shell-mode" value={id}>{title}</TabsTrigger>)}
            </TabsList>
          </div>
          {examples.map(({ id, title, prompt, activity, status, lines }) => (
            <TabsContent key={id} value={id} className="cli-shell-session">
              <div className="cli-shell-entry"><span className="cli-shell-mode-label">{title}</span><p><span aria-hidden="true">›</span> {prompt}</p></div>
              <p className="cli-shell-activity"><span aria-hidden="true" />{activity}</p>
              <pre className="cli-shell-result" aria-label={`${title} example output`}><code>
                {lines.map(line => <span key={line.text} className={'tone' in line ? line.tone : undefined}>{line.text}</span>)}
              </code></pre>
              <div className="cli-shell-status"><span>{status}</span>{id === 'build' && <span>Y/N choose · Enter confirms</span>}</div>
            </TabsContent>
          ))}
          <div className="cli-shell-footer">
            <span>Example session</span>
            <span><kbd>Tab</kbd> modes <kbd>Ctrl+P</kbd> commands</span>
          </div>
        </Tabs>
      </div>
    </section>
  )
}
