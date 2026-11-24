import { useMemo, useState } from 'react'
import { explain, redact, starterFix } from './analyze.js'
import { diffLines } from './fix.js'
import Diff from './Diff.jsx'
import PRBox from './PRBox.jsx'

const SIZES = [[1, '3 lines'], [2, '5 lines'], [4, '9 lines']]

function Block({ f, r, half }) {
  const file = r.files.find((x) => x.path === f.path)
  const win = useMemo(() => {
    const lines = file.lines.map((l) => l.replace(/\r$/, ''))
    const start = Math.max(0, f.line - 1 - half)
    const end = Math.min(lines.length, f.line + half)
    const shown = lines.slice(start, end).map(redact)
    const hot = f.line - 1 - start
    const fixed = starterFix(f, shown[hot])
    const auto = shown.flatMap((l, i) => (i === hot ? (fixed === null ? [] : [fixed]) : [l]))
    return { start, end, shown, hot, auto }
  }, [file, f, half])

  const [text, setText] = useState(win.auto.join('\n'))
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [copied, setCopied] = useState(false)

  const edited = text === '' ? [] : text.split('\n')
  const ops = diffLines(win.shown, edited)
  const changed = ops.some((o) => o.t !== 'eq')
  const id = 'fix-' + f.path + f.line + half

  async function aiFix() {
    setBusy(true)
    setMsg('')
    try {
      const out = await explain(
        `Rewrite these ${win.shown.length} lines with this problem fixed: ${f.tip} The risky line is number ${win.hot + 1} of the block.`,
        [{ path: `${f.path}:${win.start + 1}-${win.end}`, text: win.shown.join('\n') }],
        'fix'
      )
      setText(out)
    } catch (e) {
      setMsg(e.message === 'offline' ? 'The AI server is not connected here. The suggested fix above was made without AI, and you can edit it by hand.' : e.message)
    }
    setBusy(false)
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      setMsg('Copy did not work. Select the text and copy it yourself.')
    }
  }

  return (
    <>
      <p className="small">Lines {win.start + 1} to {win.end} of <code>{f.path}</code>. The risky line has the coloured bar, and a fix is already filled in.</p>
      <Diff ops={ops} start={win.start} hot={win.hot} sev={f.sev} />
      {!changed && <p className="note">No change yet. Edit the lines below and the preview updates.</p>}
      <label className="small" htmlFor={id}>Edit the fixed lines</label>
      <textarea id={id} className="editor" rows={Math.min(14, edited.length + 1)} value={text} onChange={(e) => setText(e.target.value)} maxLength={4000} spellCheck="false" />
      <div className="fixbar">
        <button className="btn ghost sm" type="button" onClick={aiFix} disabled={busy}>{busy ? 'Thinking…' : 'Ask AI for a fix'}</button>
        <button className="btn ghost sm" type="button" onClick={() => { setText(win.auto.join('\n')); setMsg('') }}>Reset</button>
        <button className="btn ghost sm" type="button" onClick={copy}>{copied ? 'Copied' : 'Copy fixed lines'}</button>
      </div>
      {msg && <p className="note">{msg}</p>}
      <PRBox
        r={r} id={id + '-t'} canSend={changed}
        edits={[{ path: f.path, start: win.start, shown: win.shown, edited }]}
        title={('Fix: ' + f.tip.split('. ')[0]).slice(0, 120)}
        body={`Suggested by RepoChat for \`${f.path}:${f.line}\`.\n\nProblem: ${f.tip}\n\nPlease review before merging. Nothing on the default branch changes until you merge this pull request.`}
      />
    </>
  )
}

export default function FixEditor({ f, r, onClose }) {
  const [half, setHalf] = useState(2)
  return (
    <div className="fixer">
      <div className="fixhead">
        <div className="sizes" role="group" aria-label="How many lines to show">
          {SIZES.map(([n, label]) => <button key={n} type="button" aria-pressed={half === n} onClick={() => setHalf(n)}>{label}</button>)}
        </div>
        <button className="link" type="button" onClick={onClose}>Close</button>
      </div>
      <Block key={half} f={f} r={r} half={half} />
    </div>
  )
}
