import { useEffect, useRef, useState } from 'react'
import { parseRepo, analyzeRepo, scanFiles, buildContext, explain, buildIndex, semanticSearch, deployChecks, findEnvVars, healthScore } from './analyze.js'
import FixEditor from './FixEditor.jsx'
import AiEdit from './AiEdit.jsx'
import { SAMPLE_FILES, SAMPLE_ANSWERS, SUGGESTIONS, STEPS, SAFETY, LEARN } from './data.js'
import { DEVELOPER, PORTFOLIO_URL, LOGO_URL } from './config.js'

const COLORS = ['#3B82F6', '#6366F1', '#10B981', '#F59E0B', '#EC4899']
const SEV = { high: 'High', medium: 'Medium', low: 'Low' }

const DEMO = {
  repo: 'acme/shop-api',
  finds: [['high', 'src/payments/charge.js:1', 'Live Stripe key written in the code'], ['medium', 'src/auth/session.js:8', 'An error is ignored silently'], ['low', 'src/payments/charge.js:5', 'Leftover console.log']],
  q: 'Where is login handled?',
  a: 'Login starts at src/routes/index.js:1. Then src/auth/session.js:3 checks the token and loads the user.',
}
const reduced = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

// A looping, decorative example of what RepoChat does. Static when the visitor prefers less motion.
function Preview() {
  const [t, setT] = useState(0)
  const still = reduced()
  useEffect(() => {
    if (still) return undefined
    const id = setInterval(() => setT((x) => (x + 1) % 96), 250)
    return () => clearInterval(id)
  }, [still])
  const T = still ? 999 : t
  const part = (text, n) => text.slice(0, Math.max(0, Math.min(text.length, n)))
  return (
    <div className="preview" aria-hidden="true">
      <div className="pv-bar"><i /><i /><i /><span>Example of what you will see</span></div>
      <div className="pv-body">
        <p className="pv-line">github.com/{part(DEMO.repo, T - 1)}{T < 14 && <b className="caret" />}</p>
        {T >= 14 && T < 18 && <div className="indet" />}
        {DEMO.finds.map(([sev, loc, text], i) => T >= 18 + i * 3 && <p key={loc} className="pv-find"><span className={'sev ' + sev}>{SEV[sev]}</span><code>{loc}</code>{text}</p>)}
        {T >= 30 && <p className="pv-q">{part(DEMO.q, (T - 30) * 2)}</p>}
        {T >= 44 && <p className="pv-a">{part(DEMO.a, (T - 44) * 4)}</p>}
      </div>
    </div>
  )
}

// Counts up to a number. Shows the final number straight away when motion is reduced.
function Num({ n }) {
  const anim = typeof document !== 'undefined' && document.documentElement.dataset.anim === '1'
  const [v, setV] = useState(anim ? 0 : n)
  useEffect(() => {
    if (!anim || n === 0) { setV(n); return undefined }
    let raf
    const start = performance.now()
    const tick = (now) => {
      const p = Math.min(1, (now - start) / 700)
      setV(Math.round(n * (1 - Math.pow(1 - p, 3))))
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [n, anim])
  return v
}

// Fades a section in when it scrolls into view.
function useReveal() {
  const ref = useRef(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return undefined
    if (!('IntersectionObserver' in window)) { el.classList.add('in'); return undefined }
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { el.classList.add('in'); io.disconnect() } }, { threshold: 0.05 })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  return ref
}

// The page background: light rays, slow glows and three layers of waves. Click or tap makes a ripple.
function Water() {
  const box = useRef(null)
  useEffect(() => {
    if (reduced()) return undefined
    const onDown = (e) => {
      const host = box.current
      if (!host || host.childElementCount > 18) return
      const s = document.createElement('span')
      s.className = 'ripple'
      s.style.left = e.clientX + 'px'
      s.style.top = e.clientY + 'px'
      s.addEventListener('animationend', () => s.remove())
      host.appendChild(s)
    }
    window.addEventListener('pointerdown', onDown, { passive: true })
    return () => window.removeEventListener('pointerdown', onDown)
  }, [])
  const wave = (cls, d) => <svg className={'wave ' + cls} viewBox="0 0 2880 320" preserveAspectRatio="none"><path d={d} /></svg>
  return (
    <div className="water" aria-hidden="true">
      <div className="rays" />
      <div className="glow g1" />
      <div className="glow g2" />
      {wave('w1', 'M0,170 C360,90 1080,250 1440,170 C1800,90 2520,250 2880,170 L2880,320 L0,320 Z')}
      {wave('w2', 'M0,190 C300,260 1140,120 1440,190 C1740,260 2580,120 2880,190 L2880,320 L0,320 Z')}
      {wave('w3', 'M0,210 C420,150 1020,270 1440,210 C1860,150 2460,270 2880,210 L2880,320 L0,320 Z')}
      <div className="ripples" ref={box} />
    </div>
  )
}

const RepoIcon = () => (
  <svg className="repo-icon" width="22" height="22" viewBox="0 0 32 32" aria-hidden="true">
    <path d="M10 9.5A2.5 2.5 0 0112.5 7H22v14H12.5A2.5 2.5 0 0010 23.5V9.5zM10 23.5A2.5 2.5 0 0012.5 26H22v-5" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

function Logo({ size = 28 }) {
  const [bad, setBad] = useState(false)
  if (LOGO_URL && !bad) return <img src={LOGO_URL} alt="" width={size} height={size} onError={() => setBad(true)} />
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="#3B82F6" />
      <g transform="translate(16 16) scale(.8) translate(-18 -16)" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M8.5 11.5L4.5 16l4 4.5" /><path d="M13 21l2.5-10" /><path d="M18 21V11h3.4a2.7 2.7 0 010 5.4H18m3.2 0L24 21" /><path d="M27.5 11.5l4 4.5-4 4.5" /></g>
    </svg>
  )
}

const LINKS = [
  { id: 'checks-sec', label: 'Check', tool: true },
  { id: 'ask-sec', label: 'Chat', tool: true },
  { id: 'how', label: 'How it works' },
  { id: 'safety', label: 'Security' },
  { id: 'learn', label: 'Learn' },
]

function Header() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    const onDown = (e) => { if (!e.target.closest?.('.top')) setOpen(false) }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onDown)
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('pointerdown', onDown) }
  }, [open])

  // Check and Chat jump straight to the results. Before a repo is analyzed they point at the input instead.
  const go = (l) => (e) => {
    setOpen(false)
    if (!l.tool) return
    e.preventDefault()
    const el = document.getElementById(l.id)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' })
      if (l.id === 'ask-sec') setTimeout(() => document.querySelector('.ask input')?.focus({ preventScroll: true }), 450)
    } else {
      window.dispatchEvent(new CustomEvent('repochat:need-repo'))
      const input = document.getElementById('repo')
      input?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      input?.focus({ preventScroll: true })
    }
  }
  const links = LINKS.map((l, i) => <a key={l.id} href={'#' + l.id} style={{ '--i': i }} onClick={go(l)}>{l.label}</a>)

  return (
    <header className="top">
      <div className="wrap row">
        <a className="brand" href="#top"><Logo />RepoChat</a>
        <nav className="dnav" aria-label="Main">{links}</nav>
        <button className="burger" type="button" aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open} aria-controls="mnav" onClick={() => setOpen(!open)}><span /><span /><span /></button>
      </div>
      <nav id="mnav" className={'mnav' + (open ? ' open' : '')} aria-label="Menu">{links}</nav>
    </header>
  )
}

function Finding({ f, r, loc, idx = 0 }) {
  const [open, setOpen] = useState(false)
  const editable = r.files.some((x) => x.path === f.path)
  return (
    <li style={{ '--i': Math.min(idx, 8) }}>
      <span className={'sev ' + f.sev}>{SEV[f.sev]}</span>
      <div>
        {loc}
        <pre>{f.text}</pre>
        <p><b>How to fix: </b>{f.tip}</p>
        {!editable && <p className="note">To stop tracking this file, run <code>git rm --cached {f.path}</code>, add it to <code>.gitignore</code>, and commit.</p>}
        {editable && !open && <div className="fixbar"><button className="btn ghost sm" type="button" onClick={() => setOpen(true)}>Edit a fix</button></div>}
        {editable && open && <FixEditor f={f} r={r} onClose={() => setOpen(false)} />}
      </div>
    </li>
  )
}

function Results({ r }) {
  const [q, setQ] = useState('')
  const [hits, setHits] = useState(null)
  const [ai, setAi] = useState({ phase: 'idle' })
  const [idx, setIdx] = useState({ phase: 'off' })
  const [all, setAll] = useState(false)
  const count = (s) => r.findings.filter((f) => f.sev === s).length
  const checks = deployChecks(r)
  const env = findEnvVars(r.files)
  const health = healthScore(r.findings, checks)
  const shown = all ? r.findings : r.findings.slice(0, 8)
  const sum = Object.values(r.langs).reduce((a, b) => a + b, 0) || 1
  const top = Object.entries(r.langs).sort((a, b) => b[1] - a[1]).slice(0, 5)
  const href = (p, l) =>
    r.sample ? null : `https://github.com/${r.info.full_name}/blob/${encodeURIComponent(r.info.default_branch)}/${p.split('/').map(encodeURIComponent).join('/')}#L${l}`
  async function enableMeaning() {
    setIdx({ phase: 'building', done: 0, total: 0 })
    try {
      const index = await buildIndex(r.files, (done, total) => setIdx({ phase: 'building', done, total }))
      setIdx({ phase: 'ready', index })
    } catch (e) {
      setIdx({ phase: 'error', msg: e.message === 'offline' ? 'The Python server is not connected here. See the README to deploy it.' : e.message })
    }
  }
  const ask = async (text) => {
    const t = text.trim()
    if (!t) return
    setQ(t)
    let extra = []
    if (idx.phase === 'ready') {
      try { extra = await semanticSearch(idx.index, t) } catch { /* fall back to keyword search */ }
    }
    const { parts, hits: keywordHits } = buildContext(r, t, extra)
    const h = extra.length ? extra.map((c) => ({ path: c.path, line: c.start, text: c.text.split('\n').find((l) => l.trim()) || '' })) : keywordHits
    setHits(h)
    if (!parts.length) return setAi({ phase: 'none' })
    setAi({ phase: 'loading' })
    try {
      setAi({ phase: 'done', text: await explain(t, parts) })
    } catch (e) {
      const demo = r.sample && SAMPLE_ANSWERS.find(([re]) => re.test(t))
      if (e.message === 'offline') setAi(demo ? { phase: 'demo', text: demo[1] } : { phase: 'offline' })
      else setAi({ phase: 'error', msg: e.message })
    }
  }
  const Loc = ({ p, l }) => {
    const u = href(p, l)
    return u ? <a className="loc" href={u} target="_blank" rel="noopener noreferrer">{p}:{l}</a> : <span className="loc">{p}:{l}</span>
  }

  return (
    <div className="results">
      <div className="head">
        <h2 className="repo-title"><RepoIcon />{r.info.full_name}</h2>
        <p>{r.info.description || 'No description.'}{r.sample && ' This is a sample project built into RepoChat.'}</p>
      </div>
      <dl className="stats">
        <div><dt>Files in repo</dt><dd><Num n={r.total} /></dd></div>
        <div><dt>Files read</dt><dd><Num n={r.files.length} /></dd></div>
        <div><dt>High risk</dt><dd className={count('high') ? 'bad' : 'good'}><Num n={count('high')} /></dd></div>
        <div><dt>Other tips</dt><dd><Num n={count('medium') + count('low')} /></dd></div>
        <div><dt>Health score</dt><dd className={health.score >= 85 ? 'good' : health.score < 65 ? 'bad' : 'warn'}><Num n={health.score} /></dd><small>{health.label}</small></div>
      </dl>
      <div className="langs" role="img" aria-label="Language share">
        {top.map(([n, b], i) => <span key={n} style={{ width: (b / sum) * 100 + '%', background: COLORS[i] }} />)}
      </div>
      <ul className="legend">
        {top.map(([n, b], i) => <li key={n}><i style={{ background: COLORS[i] }} />{n} {Math.round((b / sum) * 100)}%</li>)}
      </ul>

      <h3 id="checks-sec">Things to check</h3>
      <button className="btn ghost sm" type="button" style={{ marginTop: 0, marginBottom: 16 }} onClick={() => { ask('What bugs and mistakes are in this code?'); document.getElementById('ask-sec')?.scrollIntoView({ behavior: 'smooth' }) }}>Ask AI to look for more bugs</button>
      <p className="note" style={{ marginTop: 0 }}>These are quick pattern checks, so some can be false alarms. Add the comment <code>repochat-ignore</code> to a line to skip it next time.</p>
      {r.findings.length === 0 ? (
        <p className="muted">No obvious problems in the files we read. This is a quick scan, not a full security review.</p>
      ) : (
        <ul className="finds">
          {shown.map((f, i) => <Finding key={i} idx={i} f={f} r={r} loc={<Loc p={f.path} l={f.line} />} />)}
        </ul>
      )}
      {r.findings.length > 8 && <button className="btn ghost" onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show all ${r.findings.length}`}</button>}

      <h3>Deployment check</h3>
      <p className="muted">{checks.filter((c) => c.level === 'ok').length} of {checks.length} checks passed. Fix the red and amber items before you deploy.</p>
      <ul className="checks">
        {checks.map((c, i) => (
          <li key={i} className={'chk ' + c.level}>
            <span className="mark" aria-hidden="true">{c.level === 'ok' ? '✓' : '!'}</span>
            <div><b>{c.title}</b>{c.tip && <p>{c.tip}</p>}{c.where && <p className="small"><code>{c.where.join(', ')}</code></p>}</div>
          </li>
        ))}
      </ul>

      <h3>Environment variables</h3>
      {env.length === 0 ? <p className="muted">No environment variables found in the files we read.</p> : (
        <>
          <ul className="envs">{env.map((v) => <li key={v.name}><code>{v.name}</code>{v.isPublic && <span className="pubtag">visible to every visitor</span>}<span className="where">{v.files.join(', ')}</span></li>)}</ul>
          <p className="note">Set these in your host (for example Vercel) before you deploy. Never commit their values.</p>
        </>
      )}

      <h3 id="ask-sec">Ask about this code</h3>
      <div className="meaning">
        {(idx.phase === 'off' || idx.phase === 'error') && <button className="btn ghost sm" type="button" onClick={enableMeaning}>Turn on meaning search</button>}
        {idx.phase === 'building' && <p className="note">Reading the code by meaning… {idx.done}/{idx.total}</p>}
        {idx.phase === 'ready' && <p className="note">Meaning search is on. Questions like “how do users sign in?” can find login code even when the word “login” is missing.</p>}
        {idx.phase === 'error' && <p className="err" role="alert">{idx.msg}</p>}
      </div>
      <form className="ask" onSubmit={(e) => { e.preventDefault(); ask(q) }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} maxLength={200} placeholder="For example: what problems are in this repo?" aria-label="Your question" />
        <button className="btn" type="submit" disabled={ai.phase === 'loading'}>{ai.phase === 'loading' ? 'Thinking…' : 'Ask'}</button>
      </form>
      <div className="chips">
        {SUGGESTIONS.map((s) => <button key={s} className="chip" type="button" onClick={() => ask(s)}>{s}</button>)}
      </div>
      <p className="note">Only the few matching lines are sent to the AI, never the whole repo. Use public repositories only.</p>
      {ai.phase !== 'idle' && (
        <div className="answer" aria-live="polite">
          {ai.phase === 'loading' && <p className="muted">Reading the matching code…</p>}
          {(ai.phase === 'done' || ai.phase === 'demo') && (
            <>
              <h4>{ai.phase === 'demo' ? 'Example answer' : 'Answer in plain words'}</h4>
              {ai.text.split('\n').filter(Boolean).map((p, i) => <p key={i}>{p}</p>)}
              {ai.phase === 'demo' && <p className="note">The AI server is not connected in this preview, so this is a pre-written example for the sample project.</p>}
            </>
          )}
          {ai.phase === 'offline' && <p className="note">The AI server is not connected here. Deploy with a Gemini key (see README) to get explanations. The matching lines are below.</p>}
          {ai.phase === 'error' && <p className="err" role="alert">{ai.msg}</p>}
          {ai.phase === 'none' && <p className="muted">No matching code found. Try a feature name such as “payment” or “session”, or ask “what problems are in this repo?”.</p>}
        </div>
      )}
      {hits && hits.length > 0 && (
        <div className="hits">
          <h4>Matching lines</h4>
          <ul>{hits.map((h, i) => <li key={i}><Loc p={h.path} l={h.line} /><pre>{h.text}</pre></li>)}</ul>
        </div>
      )}

      <h3>Change code with AI</h3>
      <AiEdit r={r} />
    </div>
  )
}

function Analyzer() {
  const [url, setUrl] = useState('')
  const [st, setSt] = useState({ phase: 'idle' })
  const [steps, setSteps] = useState([])
  const [hint, setHint] = useState(false)
  useEffect(() => {
    const on = () => setHint(true)
    window.addEventListener('repochat:need-repo', on)
    return () => window.removeEventListener('repochat:need-repo', on)
  }, [])

  async function run(e) {
    e.preventDefault()
    const p = parseRepo(url)
    if (!p) return setSt({ phase: 'error', msg: 'Enter a public repository like owner/repo, or a full github.com link.' })
    setSt({ phase: 'loading' })
    setSteps([])
    try {
      const r = await analyzeRepo(p.owner, p.repo, (s) => setSteps((x) => [...x, s]))
      setSt({ phase: 'done', r })
    } catch (err) {
      setSt({ phase: 'error', msg: err.message })
    }
  }
  function sample() {
    setSt({ phase: 'done', r: { sample: true, info: { full_name: 'sample/shop-api', description: 'A small online-shop API.', default_branch: 'main' }, langs: { JavaScript: 1 }, total: SAMPLE_FILES.length, files: SAMPLE_FILES, findings: scanFiles(SAMPLE_FILES) } })
  }

  return (
    <section className="hero" id="top">
      <div className="wrap">
        <h1>Paste a GitHub repo. See what is risky, then find where things are.</h1>
        <p className="sub">Free, runs in your browser, no sign-up and no API key.</p>
        <form className="panel" onSubmit={run}>
          <label htmlFor="repo">Public GitHub repository</label>
          <div className="inline">
            <input id="repo" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="owner/repo or https://github.com/owner/repo" maxLength={140} inputMode="url" autoCapitalize="off" spellCheck="false" />
            <button className="btn" type="submit" disabled={st.phase === 'loading'}>{st.phase === 'loading' ? 'Analyzing…' : 'Analyze'}</button>
          </div>
          <p className="try">No repo handy? <button type="button" className="link" onClick={sample}>Try the sample project</button></p>
          {hint && st.phase !== 'done' && <p className="note" role="status">Analyze a repository first. Then Check and Chat take you straight to its results.</p>}
          {st.phase === 'error' && <p className="err" role="alert">{st.msg}</p>}
          {st.phase === 'loading' && <div className="indet" />}
          {st.phase === 'loading' && <ul className="steps" aria-live="polite">{steps.map((s, i) => <li key={i} className={i === steps.length - 1 ? 'now' : ''}>{s}</li>)}</ul>}
        </form>
        {st.phase !== 'done' && st.phase !== 'loading' && <Preview />}
        {st.phase === 'done' && <Results key={st.r.info.full_name} r={st.r} />}
      </div>
    </section>
  )
}

function How() {
  const ref = useReveal()
  return (
    <section id="how"><div className="wrap reveal" ref={ref}>
      <h2>How it works</h2>
      <ol className="how">{STEPS.map(([t, d], i) => <li key={t} style={{ '--i': i }}><h3>{t}</h3><p>{d}</p></li>)}</ol>
    </div></section>
  )
}

function Safety() {
  const ref = useReveal()
  return (
    <section id="safety" className="alt"><div className="wrap reveal" ref={ref}>
      <h2>Built to be safe</h2>
      <div className="cards">{SAFETY.map(([t, d], i) => <div key={t} className="card" style={{ '--i': i }}><h3>{t}</h3><p>{d}</p></div>)}</div>
    </div></section>
  )
}

function Learn() {
  const ref = useReveal()
  return (
    <section id="learn"><div className="wrap narrow reveal" ref={ref}>
      <h2>New to this? Start here</h2>
      {LEARN.map(([q, a]) => <details key={q}><summary>{q}</summary>{a.split('\n').map((p, i) => <p key={i}>{p}</p>)}</details>)}
    </div></section>
  )
}

const Footer = () => (
  <footer><div className="wrap row">
    <span className="brand sm"><Logo size={22} />RepoChat</span>
    <span>Developed by {PORTFOLIO_URL ? <a href={PORTFOLIO_URL} target="_blank" rel="noopener noreferrer">{DEVELOPER}</a> : DEVELOPER}</span>
  </div></footer>
)

export default function App() {
  return (<><Water /><Header /><main><Analyzer /><How /><Safety /><Learn /></main><Footer /></>)
}
