import { redact } from './analyze.js'

// Line-by-line difference between two small blocks of text (longest common subsequence).
export function diffLines(a, b) {
  const n = a.length
  const m = b.length
  const L = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1])
  const ops = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) ops.push({ t: 'eq', text: a[i], ai: i++, bi: j++ })
    else if (L[i + 1][j] >= L[i][j + 1]) ops.push({ t: 'del', text: a[i], ai: i++ })
    else ops.push({ t: 'add', text: b[j], bi: j++ })
  }
  while (i < n) ops.push({ t: 'del', text: a[i], ai: i++ })
  while (j < m) ops.push({ t: 'add', text: b[j], bi: j++ })
  return ops
}

// Builds the new file. Unchanged lines are copied from the REAL file (never from the redacted preview),
// so a secret on a neighbouring line can never be overwritten with bullets.
export function applyEdit(fileLines, start, shown, edited) {
  const strip = (l) => (l || '').replace(/\r$/, '')
  shown.forEach((s, k) => {
    if (redact(strip(fileLines[start + k])) !== s) throw new Error('This file changed on GitHub since the scan. Analyze the repo again, then retry.')
  })
  const ops = diffLines(shown, edited)
  // Only NEW lines are checked: an unchanged hidden secret on a neighbouring line is copied from the real file.
  if (ops.some((o) => o.t === 'add' && o.text.includes('••••'))) throw new Error('Replace the •••• placeholder with an environment variable name first.')
  const eol = fileLines.some((l) => l.endsWith('\r')) ? '\r' : ''
  const out = fileLines.slice(0, start)
  for (const op of ops) {
    if (op.t === 'eq') out.push(fileLines[start + op.ai])
    else if (op.t === 'add') out.push(op.text + eol)
  }
  return out.concat(fileLines.slice(start + shown.length))
}

const dec = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, '')), (c) => c.charCodeAt(0)))
const enc = (s) => {
  let bin = ''
  new TextEncoder().encode(s).forEach((b) => { bin += String.fromCharCode(b) })
  return btoa(bin)
}
const githubError = (status, j) =>
  status === 401 ? 'GitHub did not accept that token. Check it was copied fully and has not expired.'
  : status === 403 || status === 404 ? 'This token cannot write to that repository. It needs Contents and Pull requests set to Read and write, for this repo only.'
  : status === 422 ? 'GitHub refused the change (' + (j.message || 'validation failed') + ').'
  : 'GitHub returned an error (' + status + ').'

// Sends changes as a NEW branch plus a pull request. The default branch is never written to,
// so the main code stays exactly as it is until someone merges the pull request.
// Everything is checked first, and nothing is written if any file has changed since the scan.
export async function createPR({ token, owner, repo, base, edits, title, body }) {
  if (!/^[\w-]{20,}$/.test(token)) throw new Error('Paste the full GitHub token. It starts with github_pat_ or ghp_.')
  if (!edits || !edits.length || edits.length > 8) throw new Error('There is nothing to send, or too many changes at once.')
  const call = async (method, url, payload) => {
    let res
    try {
      res = await fetch('https://api.github.com' + url, {
        method,
        headers: { Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', 'X-GitHub-Api-Version': '2022-11-28' },
        body: payload ? JSON.stringify(payload) : undefined,
      })
    } catch {
      throw new Error('Could not reach GitHub. Check your internet connection.')
    }
    const j = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(githubError(res.status, j))
    return j
  }
  const root = `/repos/${owner}/${repo}`
  const byPath = new Map()
  for (const e of edits) byPath.set(e.path, [...(byPath.get(e.path) || []), e])
  if (byPath.size > 5) throw new Error('That change touches too many files. Try a smaller request.')

  const staged = []
  for (const [path, list] of byPath) {
    const sorted = [...list].sort((a, b) => a.start - b.start)
    sorted.forEach((e, i) => { if (i && sorted[i - 1].start + sorted[i - 1].shown.length > e.start) throw new Error('Two changes overlap. Send them one at a time.') })
    const p = path.split('/').map(encodeURIComponent).join('/')
    const file = await call('GET', `${root}/contents/${p}?ref=${encodeURIComponent(base)}`)
    const original = dec(file.content)
    let lines = original.split('\n')
    for (const e of sorted.reverse()) lines = applyEdit(lines, e.start, e.shown, e.edited) // bottom first keeps line numbers valid
    const text = lines.join('\n')
    if (text !== original) staged.push({ path, p, sha: file.sha, text })
  }
  if (!staged.length) throw new Error('Nothing changed, so there is nothing to send.')

  const ref = await call('GET', `${root}/git/ref/heads/${encodeURIComponent(base)}`)
  const branch = `repochat/fix-${Date.now().toString(36)}`
  if (branch === base) throw new Error('Refusing to write to the default branch.')
  await call('POST', `${root}/git/refs`, { ref: `refs/heads/${branch}`, sha: ref.object.sha })
  for (const f of staged) await call('PUT', `${root}/contents/${f.p}`, { message: title, content: enc(f.text), sha: f.sha, branch })
  const pull = await call('POST', `${root}/pulls`, { title, head: branch, base, body })
  return { url: pull.html_url, branch, files: staged.map((f) => f.path) }
}

// One-file version, kept for simple callers.
export const createFixPR = ({ path, start, shown, edited, ...rest }) => createPR({ ...rest, edits: [{ path, start, shown, edited }] })
