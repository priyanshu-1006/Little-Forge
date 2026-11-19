import { BookOpen, ChevronDown, CircleHelp, Download, Search } from 'lucide-react'
import { useEffect, type ReactNode } from 'react'
import { Link, NavLink, useNavigate, useParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { DocsSearch } from '@/components/docs-search'
import { CodeBlock } from '@/components/code-block'
import { docs, docPath, type DocBlock } from '@/data/documentation'

const groups = [...new Set(docs.map(({ group }) => group))]

function Inline({ text }: { text: string }) {
  return text.split(/(`[^`\n]+`)/).map((part, index) => part.startsWith('`') && part.endsWith('`')
    ? <code key={index}>{part.slice(1, -1)}</code> : part)
}

function DocLink({ href, children }: { href: string; children: ReactNode }) {
  return href.startsWith('/') ? <Link to={href}>{children}</Link> : <a href={href} target="_blank" rel="noreferrer">{children}</a>
}

function Block({ block }: { block: DocBlock }) {
  switch (block.type) {
    case 'text': return <p><Inline text={block.value} /></p>
    case 'list': return <ul>{block.items.map((item) => <li key={item}><Inline text={item} /></li>)}</ul>
    case 'code': return <CodeBlock label={block.label} value={block.value} />
    case 'note': return <aside className="doc-note"><CircleHelp aria-hidden="true" size={19} /><div><strong>{block.title}</strong><p><Inline text={block.value} /></p></div></aside>
    case 'links': return <div className="doc-links">{block.items.map(({ label, href }) => <DocLink href={href} key={href}>{label}</DocLink>)}</div>
  }
}

function DocsNav({ slug }: { slug: string }) {
  const navigate = useNavigate()
  return (
    <>
      <div className="mobile-doc-picker">
        <label htmlFor="doc-page-select">Documentation page</label>
        <div><select id="doc-page-select" value={slug} onChange={(event) => navigate(docPath(event.currentTarget.value))}>
          {docs.map((page) => <option key={page.slug} value={page.slug}>{page.title}</option>)}
        </select><ChevronDown size={16} aria-hidden="true" /></div>
      </div>
      <nav className="docs-nav" aria-label="Documentation navigation">
        <DocsSearch trigger={<Button variant="outline" className="sidebar-search"><Search /> Search docs<kbd>Ctrl K</kbd></Button>} />
        {groups.map((group) => (
          <div key={group} className="docs-nav-group">
            <p>{group}</p>
            {docs.filter((page) => page.group === group).map((page) => <NavLink end key={page.slug} to={docPath(page.slug)}>{page.title}</NavLink>)}
          </div>
        ))}
      </nav>
    </>
  )
}

export function DocsPage() {
  const { slug = '' } = useParams()
  const page = docs.find((candidate) => candidate.slug === slug)
  useEffect(() => { document.title = `${page?.title ?? 'Page not found'} · Little Forge Docs` }, [page])
  if (!page) return <NotFound />
  const position = docs.indexOf(page)
  const older = docs[position - 1]
  const newer = docs[position + 1]

  return (
    <main id="main-content" className="wrap docs-shell">
      <DocsNav slug={slug} />
      <article className="doc-article">
        <div className="doc-header">
          <nav aria-label="Breadcrumb"><Link to="/docs">Documentation</Link><span>/</span><span>{page.group}</span></nav>
          <h1>{page.title}</h1><p>{page.description}</p>
        </div>
        {slug === '' && <div className="docs-start-links">
          <Link to="/docs/installation"><Download size={22} /><span><strong>Install the extension</strong><small>Download the VSIX and start TrueForge.</small></span></Link>
          <Link to="/docs/workflows"><BookOpen size={22} /><span><strong>Run your first task</strong><small>Choose an inline edit or a repository workflow.</small></span></Link>
        </div>}
        {page.sections.map((section) => (
          <section key={section.id} className="doc-section" id={section.id} aria-labelledby={`${section.id}-title`}>
            <h2 id={`${section.id}-title`}>{section.title}</h2>
            {section.blocks.map((block, index) => <Block block={block} key={index} />)}
          </section>
        ))}
        <nav aria-label="Adjacent documentation pages" className="doc-pagination">
          {older && <Link to={docPath(older.slug)}><small>Previous</small>{older.title}</Link>}
          {newer && <Link to={docPath(newer.slug)} className="doc-next"><small>Next</small>{newer.title}</Link>}
        </nav>
      </article>
      <aside className="docs-toc"><p>On this page</p><nav aria-label="On this page">
        {page.sections.map(({ title, id }) => <Link key={id} to={`${docPath(slug)}#${id}`}>{title}</Link>)}
      </nav></aside>
    </main>
  )
}

export function NotFound() {
  return (
    <main id="main-content" className="wrap empty-page">
      <p className="eyebrow">Page not found</p><h1>That page is missing.</h1>
      <Button asChild><Link to="/">Back to Little Forge</Link></Button>
    </main>
  )
}
