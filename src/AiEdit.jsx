import { useState } from 'react'
import { editContext, explain, parseEdits } from './analyze.js'
import { diffLines } from './fix.js'
import Diff from './Diff.jsx'
import PRBox from './PRBox.jsx'

const IDEAS = ['Change the main color to green', 'Make all buttons fully rounded', 'Make the page background darker']

// Describe a change in plain words. The AI proposes it, you review the preview, then send it as a pull request.
export default function AiEdit({ r }) {
  const [text, setText] = useState('')
  const [st, setSt] = useState({ phase: 'idle' })
  const [edits, setEdits] = useState([])
  const [use, setUse] = useState([])

  async function propose(instruction) {
    const t = instruction.trim().slice(0, 200)
    if (!t) return
    setText(t)
    setSt({ phase: 'busy' })
    const wins = editContext(r, t)
    if (!wins.length) return setSt({ phase: 'error', msg: 'I could not find code to change for that. Try naming a file or a feature.' })
    try {
      const answer = await explain(t, wins.map((w, i) => ({ path: `snippet ${i}: ${w.path}:${w.start + 1}-${w.start + w.shown.length}`, text: w.shown.join('\n') })), 'edit')
      const out = parseEdits(answer, wins)
      if (!out.edits.length) return setSt({ phase: 'error', msg: 'The AI did not suggest any change. Try describing it differently.' })
      setEdits(out.edits)
      setUse(out.edits.map(() => true))
      setSt({ phase: 'done', summary: out.summary })
    } catch (e) {
      setSt(e.message === 'offline' ? { phase: 'offline' } : { phase: 'error', msg: e.message })
    }
  }

  const chosen = edits.filter((_, i) => use[i])
  const changed = chosen.some((e) => diffLines(e.shown, e.edited).some((o) => o.t !== 'eq'))

  return (
    <div className="aiedit">
      <p className="muted">Describe a change in plain words, for example a colour. You review the red and green preview, then send it to GitHub as a pull request. Your main code is not changed until you merge.</p>
      <form className="ask" onSubmit={(e) => { e.preventDefault(); propose(text) }}>
        <input value={text} onChange={(e) => setText(e.target.value)} maxLength={200} placeholder="For example: change the main color to green" aria-label="Describe the change" />
        <button className="btn" type="submit" disabled={st.phase === 'busy'}>{st.phase === 'busy' ? 'Thinking…' : 'Propose change'}</button>
      </form>
      <div className="chips">{IDEAS.map((s) => <button key={s} className="chip" type="button" onClick={() => propose(s)}>{s}</button>)}</div>
      {st.phase === 'offline' && <p className="note">The AI server is not connected here. Deploy with a Gemini key (see the README) to use this.</p>}
      {st.phase === 'error' && <p className="err" role="alert">{st.msg}</p>}
      {st.phase === 'done' && (
        <div className="answer">
          <h4>Proposed change</h4>
          {st.summary && <p>{st.summary}</p>}
          {edits.map((e, i) => (
            <div key={e.path + e.start} className="edit-item">
              <label className="usebox"><input type="checkbox" checked={use[i]} onChange={() => setUse(use.map((u, k) => (k === i ? !u : u)))} /> <code>{e.path}</code> from line {e.start + 1}</label>
              <Diff ops={diffLines(e.shown, e.edited)} start={e.start} />
              <details>
                <summary>Edit this change by hand</summary>
                <textarea className="editor" rows={Math.min(14, e.edited.length + 1)} value={e.edited.join('\n')} maxLength={4000} spellCheck="false"
                  onChange={(ev) => setEdits(edits.map((x, k) => (k === i ? { ...x, edited: ev.target.value === '' ? [] : ev.target.value.split('\n') } : x)))} />
              </details>
            </div>
          ))}
          <PRBox
            r={r} id="aiedit-token" canSend={changed} edits={chosen}
            title={('RepoChat: ' + text).slice(0, 120)}
            body={`Requested change: ${text}\n\nSuggested by RepoChat. Please review before merging. Nothing on the default branch changes until you merge this pull request.`}
          />
        </div>
      )}
    </div>
  )
}
