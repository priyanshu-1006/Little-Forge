import { Check, Circle, FileCode2, Hammer, ListChecks, MessageCircle, Pause, Play, RotateCcw, Terminal, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

const agentModes = [
  { id: 'ask', title: 'Ask', icon: MessageCircle, prompt: 'Where are CLI commands registered?' },
  { id: 'build', title: 'Build', icon: Hammer, prompt: 'Treat off as a false debug flag.' },
  { id: 'plan', title: 'Plan', icon: ListChecks, prompt: 'Plan a CLI command for app config.' },
] as const

type AgentMode = (typeof agentModes)[number]['id']

const examples = {
  ask: {
    path: 'src/flask/cli.py', activity: ['Reading the CLI module', 'Finding the command group'],
    reply: 'FlaskGroup collects the built-in CLI commands. Commands that need the active app use with_appcontext.',
    code: ['class FlaskGroup(AppGroup):', '    def __init__(self, ...):', '        self.add_command(run_command)', '        self.add_command(shell_command)'],
    ready: 'Answer ready',
  },
  build: {
    path: 'src/flask/helpers.py', activity: ['Reading the selected function', 'Preparing a one-hunk diff'],
    reply: 'I staged an edit so FLASK_DEBUG=off returns False. Review the hunk before applying it.',
    code: ['def get_debug_flag():', '    val = os.environ.get("FLASK_DEBUG")', '-   false = {"0", "false", "no"}', '+   false = {"0", "false", "no", "off"}', '    return bool(val and val.lower() not in false)'],
    ready: 'Review ready',
  },
  plan: {
    path: 'src/flask/cli.py', activity: ['Finding related CLI commands', 'Reading tests and documentation'],
    reply: 'I found the extension points for a config command. Here’s the proposed sequence.',
    code: ['src/flask/cli.py', 'tests/test_cli.py', 'docs/cli.rst'],
    ready: 'Plan ready',
  },
} as const

const planSteps = ['Register the CLI command', 'Serialize config and mask sensitive values', 'Add a CLI test and document usage']

export function useReducedMotion() {
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)

  useEffect(() => {
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const change = (event: MediaQueryListEvent) => setReduced(event.matches)
    motion.addEventListener('change', change)
    return () => motion.removeEventListener('change', change)
  }, [])

  return reduced
}

export function HeroPrompt({ reduced }: { reduced: boolean }) {
  const [position, setPosition] = useState({ example: 0, characters: 0, deleting: false })
  const [paused, setPaused] = useState(false)
  const example = agentModes[position.example]
  const shown = reduced ? example.prompt : example.prompt.slice(0, position.characters)

  useEffect(() => {
    if (paused || reduced) return
    const isFull = position.characters >= example.prompt.length
    const delay = position.deleting ? 24 : isFull ? 1950 : 44
    const timer = window.setTimeout(() => {
      if (position.deleting && position.characters === 0) {
        setPosition({ example: (position.example + 1) % agentModes.length, characters: 0, deleting: false })
      } else if (position.deleting) {
        setPosition({ ...position, characters: position.characters - 1 })
      } else if (isFull) {
        setPosition({ ...position, deleting: true })
      } else {
        setPosition({ ...position, characters: position.characters + 1 })
      }
    }, delay)
    return () => window.clearTimeout(timer)
  }, [example, paused, position, reduced])

  return (
    <div className="hero-prompt">
      <Terminal size={17} aria-hidden="true" className="hero-prompt-icon" />
      <div className="hero-prompt-line" aria-hidden="true">
        <span>{shown}</span>{!reduced && !paused && <span className="prompt-caret" />}
      </div>
      {!reduced && <button className="hero-prompt-pause" type="button" onClick={() => setPaused(!paused)} aria-label={paused ? 'Resume prompt animation' : 'Pause prompt animation'}>
        {paused ? <Play size={14} /> : <Pause size={14} />}
      </button>}
    </div>
  )
}

const readTime = 5000

export function AgentShowcase({ reduced }: { reduced: boolean }) {
  const frame = useRef<HTMLDivElement>(null)
  const [modeIndex, setModeIndex] = useState(0)
  const [visible, setVisible] = useState(false)
  const [started, setStarted] = useState(false)
  const [playing, setPlaying] = useState(true)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!frame.current) return
    const observer = new IntersectionObserver(([entry]) => {
      const inView = entry.intersectionRatio >= .35
      setVisible(inView)
      if (inView) setStarted(true)
    }, { threshold: .35 })
    observer.observe(frame.current)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!visible || !playing || !ready || reduced) return
    const timer = window.setTimeout(() => {
      setReady(false)
      setModeIndex((index) => (index + 1) % agentModes.length)
    }, readTime)
    return () => window.clearTimeout(timer)
  }, [visible, playing, ready, reduced])

  function selectMode(value: string) {
    setPlaying(false)
    setStarted(true)
    const index = agentModes.findIndex(({ id }) => id === value)
    if (index !== modeIndex) {
      setReady(false)
      setModeIndex(index)
    }
  }

  return (
    <section id="agent-modes" className="wrap agent-showcase" aria-labelledby="agent-modes-title">
      <div className="agent-showcase-copy">
        <h2 id="agent-modes-title">See the agent work.</h2>
        <p>Ask about the code, build a patch you can review, or plan a change across files.</p>
        <span className="agent-example-label"><Terminal size={15} /> Interactive Flask examples</span>
      </div>
      <div ref={frame} className="agent-showcase-frame">
        <Tabs value={agentModes[modeIndex].id} onValueChange={selectMode} activationMode="manual">
          <div className="agent-showcase-toolbar">
            <TabsList className="agent-mode-list" aria-label="Little Forge agent modes">
              {agentModes.map(({ id, title, icon: Icon }) => (
                <TabsTrigger className="agent-mode-tab" value={id} key={id}><Icon size={16} aria-hidden="true" />{title}</TabsTrigger>
              ))}
            </TabsList>
            {!reduced && <button className="agent-autoplay" type="button" onClick={() => setPlaying(!playing)} aria-label={playing ? 'Pause demo rotation' : 'Resume demo rotation'}>
              {playing ? <Pause size={15} /> : <Play size={15} />}<span>Autoplay {playing ? 'on' : 'off'}</span>
            </button>}
          </div>
          {agentModes.map(({ id }) => (
            <TabsContent key={id} value={id} className="agent-stage" onFocusCapture={() => setPlaying(false)}>
              <AgentConsole mode={id} reduced={reduced} started={started} announce={!playing || reduced} onReady={setReady} />
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </section>
  )
}

function AgentConsole({ mode, reduced, started, announce, onReady }: {
  mode: AgentMode
  reduced: boolean
  started: boolean
  announce: boolean
  onReady: (ready: boolean) => void
}) {
  const example = examples[mode]
  const modeInfo = agentModes.find((candidate) => candidate.id === mode)!
  const ModeIcon = modeInfo.icon
  const [revision, setRevision] = useState(0)
  const [phase, setPhase] = useState(0)
  const [characters, setCharacters] = useState(0)
  const [decision, setDecision] = useState<'accepted' | 'skipped' | null>(null)
  const status = useRef<HTMLDivElement>(null)
  const visiblePhase = reduced ? 3 : phase
  const done = visiblePhase === 3

  useEffect(() => {
    if (reduced || !started) return
    let typing: ReturnType<typeof setInterval> | undefined
    const read = window.setTimeout(() => setPhase(1), 270)
    const prepare = window.setTimeout(() => setPhase(2), 640)
    const stream = window.setTimeout(() => {
      let cursor = 0
      typing = setInterval(() => {
        cursor = Math.min(example.reply.length, cursor + 3)
        setCharacters(cursor)
        if (cursor === example.reply.length) {
          clearInterval(typing)
          setPhase(3)
        }
      }, 27)
    }, 830)
    return () => {
      window.clearTimeout(read)
      window.clearTimeout(prepare)
      window.clearTimeout(stream)
      clearInterval(typing)
    }
  }, [example, reduced, revision, started])

  useEffect(() => onReady(done), [done, onReady])

  function replay() {
    setPhase(0)
    setCharacters(0)
    setDecision(null)
    setRevision((value) => value + 1)
  }

  function choose(value: 'accepted' | 'skipped') {
    setDecision(value)
    status.current?.focus({ preventScroll: true })
  }

  const renderLine = (line: string) => (
    <code key={line} className={line.startsWith('+') ? 'addition' : line.startsWith('-') ? 'deletion' : ''}>{line}</code>
  )

  return (
    <div className="agent-console" data-mode={mode}>
      <div className="agent-editor">
        <div className="agent-file"><FileCode2 size={13} /> <span>{example.path}</span></div>
        <div className="agent-code">
          {example.code.filter((line) => visiblePhase >= 2 || !line.startsWith('+')).map(renderLine)}
        </div>
      </div>
      <div className="agent-pane">
        <div className="agent-pane-header"><span><ModeIcon size={14} /> {modeInfo.title} <small>Simulation</small></span>
          <button type="button" className="agent-replay" onClick={replay} aria-label={`Replay ${modeInfo.title} example`} title="Replay example"><RotateCcw size={14} /></button></div>
        <div className="agent-content">
          <p className="agent-user-prompt">{modeInfo.prompt}</p>
          <ul className="agent-activity">
            {example.activity.slice(0, Math.min(visiblePhase, 2)).map((line, index) => (
              <li key={line}>{visiblePhase > index + 1 ? <Check size={12} /> : <Circle size={10} className="activity-pulse" />}{line}</li>
            ))}
          </ul>
          {(characters > 0 || reduced) && <p className="agent-answer" aria-hidden="true">{reduced ? example.reply : example.reply.slice(0, characters)}{!done && <span className="agent-text-caret" />}</p>}
          <p className="sr-only" aria-live={announce ? 'polite' : 'off'}>{done ? example.reply : ''}</p>
          {mode === 'plan' && done && <ol className="agent-plan">{planSteps.map((item) => <li key={item}>{item}</li>)}</ol>}
          {mode === 'build' && visiblePhase >= 2 && <div className="agent-code agent-mobile-diff">{example.code.filter((line) => /^[+-]/.test(line)).map(renderLine)}</div>}
          {mode === 'build' && done && !decision && <div className="agent-actions">
            <button type="button" onClick={() => choose('accepted')}><Check size={14} /> Accept hunk</button>
            <button type="button" onClick={() => choose('skipped')}><X size={14} /> Reject</button>
          </div>}
        </div>
        <div className="agent-status" ref={status} role="status" aria-live={announce ? 'polite' : 'off'} tabIndex={-1}>
          <span className={done ? 'status-done' : started ? 'activity-pulse' : ''} />
          {decision ? `Example hunk ${decision}` : done ? example.ready : started ? 'Working on the example' : 'Waiting to start'}
        </div>
      </div>
    </div>
  )
}
