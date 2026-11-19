import { Check, Copy } from 'lucide-react'
import { useEffect, useState } from 'react'

export function CodeBlock({ label, value }: { label: string; value: string }) {
  const [status, setStatus] = useState<'idle' | 'copied' | 'unavailable'>('idle')

  useEffect(() => {
    if (status === 'idle') return
    const timer = setTimeout(() => setStatus('idle'), 2400)
    return () => clearTimeout(timer)
  }, [status])

  return (
    <div className="code-block">
      <div className="code-header"><span>{label}</span><button type="button" onClick={async () => {
        try { await navigator.clipboard.writeText(value); setStatus('copied') } catch { setStatus('unavailable') }
      }} aria-label={`Copy ${label}`}>
        {status === 'copied' ? <Check size={16} /> : <Copy size={16} />}
        <span role="status">{status === 'copied' ? 'Copied' : status === 'unavailable' ? 'Select text to copy' : 'Copy'}</span>
      </button></div>
      <pre tabIndex={0}><code>{value}</code></pre>
    </div>
  )
}
