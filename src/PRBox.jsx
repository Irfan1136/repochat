import { useState } from 'react'
import { createPR } from './fix.js'

// "Send to GitHub as a pull request". Always a NEW branch, never the default branch.
export default function PRBox({ r, edits, title, body, canSend, id }) {
  const [token, setToken] = useState('')
  const [pr, setPr] = useState({ phase: 'idle' })

  async function send() {
    setPr({ phase: 'busy' })
    try {
      const [owner, repo] = r.info.full_name.split('/')
      const out = await createPR({ token: token.trim(), owner, repo, base: r.info.default_branch, edits, title, body })
      setToken('')
      setPr({ phase: 'done', url: out.url })
    } catch (e) {
      setPr({ phase: 'error', msg: e.message })
    }
  }

  return (
    <details className="pr">
      <summary>Send this to GitHub as a pull request</summary>
      <p className="note">This creates a new branch and a pull request. Your main code is not changed until you merge it, and you can close the pull request to throw the change away.</p>
      {r.sample ? <p className="note">Not available for the sample project.</p> : (
        <>
          <label className="small" htmlFor={id}>GitHub token. It stays in this page, is used once, and is only sent to github.com.</label>
          <input id={id} type="password" autoComplete="off" spellCheck="false" value={token} onChange={(e) => setToken(e.target.value)} placeholder="github_pat_…" />
          <div className="fixbar">
            <button className="btn sm" type="button" onClick={send} disabled={pr.phase === 'busy' || !canSend || token.trim().length < 20}>{pr.phase === 'busy' ? 'Creating…' : 'Create pull request'}</button>
          </div>
          {pr.phase === 'done' && pr.url?.startsWith('https://github.com/') && <p className="ok">Done. <a href={pr.url} target="_blank" rel="noopener noreferrer">Open the pull request</a>. Your main code is unchanged.</p>}
          {pr.phase === 'error' && <p className="err" role="alert">{pr.msg}</p>}
          <details>
            <summary>How to make a safe token</summary>
            <ol className="small">
              <li>On GitHub open Settings, Developer settings, Personal access tokens, <b>Fine-grained tokens</b>, then Generate new token.</li>
              <li>Expiration: 1 day. Repository access: <b>Only select repositories</b>, and pick just this one.</li>
              <li>Permissions: <b>Contents</b> and <b>Pull requests</b>, both set to Read and write.</li>
              <li>You need write access to the repo. For someone else’s repo, fork it first and analyze your fork.</li>
            </ol>
          </details>
        </>
      )}
    </details>
  )
}
