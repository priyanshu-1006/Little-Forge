import { BookOpen, Search } from 'lucide-react'
import { useEffect, useId, useState, type KeyboardEvent, type ReactElement } from 'react'
import { useNavigate } from 'react-router-dom'
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { docs, docPath } from '@/data/documentation'

const entries = docs.flatMap((page) => [
  { title: page.title, description: page.description, path: docPath(page.slug), searchText: `${page.title} ${page.description}`, heading: true },
  ...page.sections.map((section) => ({
    title: section.title,
    description: page.title,
    path: `${docPath(page.slug)}#${section.id}`,
    searchText: `${page.title} ${section.title} ${section.blocks.flatMap((block) => block.type === 'list'
      ? block.items : block.type === 'links' ? block.items.map((item) => item.label) : [block.value]).join(' ')}`,
    heading: false,
  })),
])

export function DocsSearch({ trigger, keyboardShortcut = false }: { trigger: ReactElement; keyboardShortcut?: boolean }) {
  const navigate = useNavigate()
  const id = useId()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(-1)
  const phrase = query.trim().toLowerCase()
  const words = phrase.split(/\s+/).filter(Boolean)
  const results = words.length
    ? entries.filter(({ searchText }) => words.every((word) => searchText.toLowerCase().includes(word)))
      .map((entry) => ({ entry, score: entry.title.toLowerCase().includes(phrase) ? words.length + 1 : words.filter((word) => entry.title.toLowerCase().includes(word)).length }))
      .sort((a, b) => b.score - a.score).slice(0, 9).map(({ entry }) => entry)
    : entries.filter(({ heading }) => heading)

  function openSearch(next: boolean) {
    setOpen(next)
    if (next) { setQuery(''); setActive(-1) }
  }

  useEffect(() => {
    if (!keyboardShortcut) return
    function shortcut(event: globalThis.KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setQuery(''); setActive(-1); setOpen((value) => !value)
      }
    }
    document.addEventListener('keydown', shortcut)
    return () => document.removeEventListener('keydown', shortcut)
  }, [keyboardShortcut])

  function choose(path: string) {
    setOpen(false)
    navigate(path)
  }

  function move(event: KeyboardEvent<HTMLInputElement>) {
    if (!results.length) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const direction = event.key === 'ArrowDown' ? 1 : -1
      const chosen = active < 0 ? (direction > 0 ? 0 : results.length - 1) : (active + direction + results.length) % results.length
      setActive(chosen)
      document.getElementById(`${id}-${chosen}`)?.scrollIntoView({ block: 'nearest' })
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      choose(results[Math.max(0, active)].path)
    }
  }

  return (
    <Dialog open={open} onOpenChange={openSearch}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="search-dialog">
        <DialogTitle>Search documentation</DialogTitle>
        <DialogDescription className="sr-only">Search by feature, command, or error message.</DialogDescription>
        <div className="search-field">
          <Search size={19} aria-hidden="true" />
          <input autoFocus value={query} onChange={(event) => { setQuery(event.currentTarget.value); setActive(-1) }} onKeyDown={move}
            placeholder="Search commands, providers, and more" aria-label="Search documentation" role="combobox" aria-expanded="true"
            aria-controls={`${id}-results`} aria-autocomplete="list" aria-activedescendant={active >= 0 ? `${id}-${active}` : undefined} />
        </div>
        <div id={`${id}-results`} className="search-results" role="listbox" aria-label="Documentation results">
          {results.map(({ title, description, path }, index) => (
            <button type="button" role="option" aria-selected={index === active} id={`${id}-${index}`} key={path} onClick={() => choose(path)}>
              <BookOpen size={17} aria-hidden="true" /><span><strong>{title}</strong><small>{description}</small></span>
            </button>
          ))}
        </div>
        {!results.length && <p className="search-empty" role="status">No matches. Try a command name or a shorter search.</p>}
        <div className="search-help"><span><kbd>↑</kbd><kbd>↓</kbd> Select</span><span><kbd>Enter</kbd> Open</span><span><kbd>Esc</kbd> Close</span></div>
      </DialogContent>
    </Dialog>
  )
}
