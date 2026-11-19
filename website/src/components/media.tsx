import { Pause, Play } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { chapters } from '@/data/product'
import { Button } from '@/components/ui/button'

export function MotionClip({ media, label }: { media: string; label: string }) {
  const wrapper = useRef<HTMLDivElement>(null)
  const video = useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = useState(false)
  const preference = useRef<'auto' | 'play' | 'pause'>('auto')
  const visible = useRef(false)
  const motion = useRef<MediaQueryList | null>(null)

  function update() {
    const player = video.current
    if (!player) return
    if (visible.current && !document.hidden && (preference.current === 'play' || (preference.current === 'auto' && !motion.current?.matches))) {
      void player.play().catch(() => setPlaying(false))
    } else {
      player.pause()
    }
  }

  useEffect(() => {
    const target = wrapper.current
    if (!target) return
    motion.current = window.matchMedia('(prefers-reduced-motion: reduce)')
    const observer = new IntersectionObserver(([entry]) => {
      visible.current = entry.isIntersecting
      update()
    }, { threshold: 0.35 })
    observer.observe(target)
    document.addEventListener('visibilitychange', update)
    motion.current.addEventListener('change', update)
    return () => {
      observer.disconnect()
      document.removeEventListener('visibilitychange', update)
      motion.current?.removeEventListener('change', update)
    }
  }, [])

  function toggle() {
    const player = video.current
    if (!player) return
    if (player.paused) {
      preference.current = 'play'
      void player.play().catch(() => setPlaying(false))
    } else {
      preference.current = 'pause'
      player.pause()
    }
  }

  return (
    <div ref={wrapper} className="motion-clip">
      <video ref={video} src={`/media/${media}.mp4`} poster={`/media/${media}.webp`} loop muted playsInline preload="none"
        aria-label={label} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} />
      <Button className="clip-toggle" size="icon" variant="light" onClick={toggle} aria-label={playing ? 'Pause feature preview' : 'Play feature preview'}>
        {playing ? <Pause /> : <Play />}
      </Button>
    </div>
  )
}

export function NarratedDemo() {
  const player = useRef<HTMLVideoElement>(null)
  const [active, setActive] = useState(0)
  const [started, setStarted] = useState(false)
  const pendingTime = useRef<number | null>(null)

  function playAt(index: number) {
    const video = player.current
    if (!video) return
    const time = chapters[index].time
    setActive(index)
    if (video.readyState === 0) pendingTime.current = time
    else video.currentTime = time
    void video.play().catch(() => undefined)
  }

  return (
    <div className="demo-player">
      <div className="demo-screen">
        <video ref={player} src="/media/little-forge-demo.mp4" poster="/media/demo-poster.webp" controls playsInline preload="metadata"
          aria-label="Little Forge narrated demo" onPlay={() => setStarted(true)}
          onLoadedMetadata={() => {
            if (pendingTime.current !== null && player.current) {
              player.current.currentTime = pendingTime.current
              pendingTime.current = null
            }
          }}
          onTimeUpdate={(event) => {
            const time = event.currentTarget.currentTime
            setActive(chapters.reduce((result, chapter, index) => time + 0.04 >= chapter.time ? index : result, 0))
          }}>
          <track kind="captions" label="English" srcLang="en" src="/media/little-forge-demo.en.vtt" />
        </video>
        {!started && <button className="demo-play" type="button" aria-label="Play narrated demo" onClick={() => playAt(active)}><Play size={29} fill="currentColor" /></button>}
      </div>
      <div className="demo-chapters" role="group" aria-label="Demo chapters">
        {chapters.map(({ stamp, label }, index) => (
          <button type="button" key={stamp} aria-label={`${label} at ${stamp}`} aria-pressed={active === index} onClick={() => playAt(index)}>
            <span>{stamp}</span><strong>{label}</strong>
          </button>
        ))}
      </div>
    </div>
  )
}
