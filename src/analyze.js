import { API_URL } from './config.js'

// All analysis runs in the visitor's browser. No server, no API key, no AI.
const NAME = /^([A-Za-z0-9_.-]{1,39})\/([A-Za-z0-9_.-]{1,100})$/
const CODE = /\.(js|jsx|mjs|ts|tsx|py|java|go|rb|php|c|cc|cpp|cs|rs|swift|kt|html|css|sql|sh)$/i
const SKIP = /(^|\/)(node_modules|dist|build|vendor|\.git|coverage)\/|\.min\.|lock\./i
const ENVF = /(^|\/)\.env(\.[\w-]+)?$/i
const ENV_OK = /example|sample|template/i
const STOP = new Set(['the', 'where', 'what', 'how', 'does', 'and', 'for', 'are', 'this', 'that', 'with', 'which', 'file', 'code', 'handled', 'work', 'works'])

const RULES = [
  { sev: 'high', re: /\w*(key|secret|token|passw(or)?d)\w*\s*[:=]\s*['"][A-Za-z0-9_\-/+=]{16,}['"]/i, tip: 'This looks like a secret written into the code. Move it to an environment variable and replace (rotate) the key.' },
  { sev: 'high', re: /sk_live_[0-9A-Za-z]{10,}|AKIA[0-9A-Z]{16}/, tip: 'This looks like a live payment or cloud key. Revoke it now, then use an environment variable.' },
  { sev: 'medium', re: /\beval\s*\(/, tip: 'eval() runs text as code, which attackers can abuse. Use JSON.parse or a safer approach.' },
  { sev: 'medium', re: /\.innerHTML\s*=|dangerouslySetInnerHTML/, tip: 'Inserting raw HTML can allow XSS attacks. Use textContent, or clean the HTML first.' },
  { sev: 'low', re: /catch\s*(\([^)]*\))?\s*\{\s*\}|except\s*:\s*pass/, tip: 'The error is ignored silently, which hides bugs. Log it or handle it.' },
  { sev: 'low', re: /\b(TODO|FIXME|HACK)\b/, tip: 'Unfinished work. Finish it or track it as an issue.' },
  { sev: 'low', re: /console\.(log|debug)\(/, tip: 'Debug output left in the code. Remove it before release.' },
]

export function parseRepo(input) {
  const v = input.trim().replace(/^https:\/\/github\.com\//, '').replace(/\/+$/, '').replace(/\.git$/, '')
  const m = NAME.exec(v)
  if (!m || /^\.+$/.test(m[1]) || /^\.+$/.test(m[2])) return null
  return { owner: m[1], repo: m[2] }
}

async function gh(path) {
  let r
  try {
    r = await fetch('https://api.github.com' + path, { headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(15000) })
  } catch {
    throw new Error('Could not reach GitHub. Check your internet connection and try again.')
  }
  if (r.status === 404) throw new Error('Repository not found. It may be private, or the name may be wrong.')
  if (r.status === 403 || r.status === 429) throw new Error('GitHub’s free limit was reached. Wait a few minutes and try again.')
  if (!r.ok) throw new Error('GitHub returned an error (' + r.status + ').')
  return r.json()
}

const redact = (s) => s.replace(/(['"])[A-Za-z0-9_\-/+=]{16,}\1/g, '"••••••"').replace(/sk_live_\w+|AKIA[0-9A-Z]{16}/g, '••••••')

export function scanFiles(files) {
  const out = []
  for (const f of files) {
    f.lines.forEach((line, i) => {
      if (line.length > 400) return
      const rule = RULES.find((r) => r.re.test(line))
      if (rule) out.push({ path: f.path, line: i + 1, sev: rule.sev, tip: rule.tip, text: redact(line.trim()).slice(0, 140) })
    })
  }
  const rank = { high: 0, medium: 1, low: 2 }
  return out.sort((a, b) => rank[a.sev] - rank[b.sev])
}

export async function analyzeRepo(owner, repo, say) {
  say('Reading repository details')
  const info = await gh(`/repos/${owner}/${repo}`)
  say('Listing files and languages')
  const br = encodeURIComponent(info.default_branch)
  const [langs, tree] = await Promise.all([gh(`/repos/${owner}/${repo}/languages`), gh(`/repos/${owner}/${repo}/git/trees/${br}?recursive=1`)])
  const blobs = tree.tree.filter((t) => t.type === 'blob')
  const envFiles = blobs.filter((t) => ENVF.test(t.path) && !ENV_OK.test(t.path)).map((t) => t.path)
  const picks = blobs
    .filter((t) => CODE.test(t.path) && !SKIP.test(t.path) && t.size < 60000)
    .sort((a, b) => a.path.split('/').length - b.path.split('/').length || a.size - b.size)
    .slice(0, 40)
  say(`Reading ${picks.length} code files`)
  const got = await Promise.allSettled(
    picks.map(async (t) => {
      const url = `https://raw.githubusercontent.com/${owner}/${repo}/${br}/${t.path.split('/').map(encodeURIComponent).join('/')}`
      const r = await fetch(url, { signal: AbortSignal.timeout(15000) })
      if (!r.ok) throw new Error('skip')
      return { path: t.path, lines: (await r.text()).split('\n') }
    })
  )
  const files = got.filter((g) => g.status === 'fulfilled').map((g) => g.value)
  say('Checking for risky code')
  const findings = scanFiles(files)
  envFiles.forEach((p) => findings.unshift({ path: p, line: 1, sev: 'high', text: '(contents hidden)', tip: 'An environment file is committed to the repository. Remove it from Git, add it to .gitignore, and replace every key inside it.' }))
  let readme = ''
  try {
    const rr = await fetch(`https://raw.githubusercontent.com/${owner}/${repo}/${br}/README.md`, { signal: AbortSignal.timeout(10000) })
    if (rr.ok) readme = (await rr.text()).split('\n').slice(0, 60).join('\n')
  } catch { /* README is optional */ }
  return { info, langs, total: blobs.length, files, findings, readme, paths: blobs.map((t) => t.path).slice(0, 80) }
}

// Simple keyword search. This is the "retrieve" half of RAG; an AI model will explain the lines later.
export function search(files, question) {
  const words = (question.toLowerCase().match(/[a-z0-9_]{3,}/g) || []).filter((w) => !STOP.has(w))
  if (!words.length) return []
  const hits = []
  for (const f of files) {
    const pathScore = words.filter((w) => f.path.toLowerCase().includes(w)).length * 0.5
    f.lines.forEach((line, i) => {
      const low = line.toLowerCase()
      const s = words.filter((w) => low.includes(w)).length
      if (s && line.trim() && line.length < 400) hits.push({ path: f.path, line: i + 1, text: redact(line.trim()).slice(0, 160), score: s + pathScore })
    })
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, 8)
}

// ---- Question handling: pick the code the AI should read ----
export const isProblemQuestion = (q) => /\b(error|errors|bug|bugs|issue|issues|problem|problems|risk|risky|secret|secrets|security|vulnerab\w*|unsafe|fix)\b/i.test(q)
export const isOverviewQuestion = (q) => /\b(overview|summary|summarize|what is this|what does this|about this (repo|project)|purpose|structure|architecture)\b/i.test(q)

function overviewParts(r) {
  const paths = r.paths || r.files.map((f) => f.path)
  const parts = [{ path: 'REPO INFO', text: `${r.info.full_name}: ${r.info.description || 'no description'}\nLanguages: ${Object.keys(r.langs).join(', ')}\nFiles:\n${paths.slice(0, 60).join('\n')}` }]
  if (r.readme) parts.push({ path: 'README.md', text: r.readme })
  return parts
}

const windowOf = (f, line, before = 4, after = 6) => {
  const a = Math.max(0, line - 1 - before)
  const b = Math.min(f.lines.length, line + after)
  return { path: `${f.path}:${a + 1}-${b}`, text: f.lines.slice(a, b).map((l) => redact(l)).join('\n') }
}

export function buildContext(r, question, extra = []) {
  const parts = extra.map((c) => ({ path: `${c.path}:${c.start}-${c.end}`, text: c.text }))
  const hits = search(r.files, question)
  if (isOverviewQuestion(question)) parts.push(...overviewParts(r))
  if (isProblemQuestion(question)) {
    r.findings.slice(0, 8).forEach((f) => parts.push({ path: `${f.path}:${f.line}`, text: `${f.text}\n(automatic check: ${f.tip})` }))
    // Let the AI also look for bugs the simple checks cannot see.
    r.files.slice(0, 4).forEach((f) => parts.push({ path: `${f.path}:1-30`, text: f.lines.slice(0, 30).map((l) => redact(l)).join('\n') }))
  }
  for (const h of hits.slice(0, 5)) {
    const f = r.files.find((x) => x.path === h.path)
    if (f) parts.push(windowOf(f, h.line))
  }
  // Any other question (for example "how do I run this?") still gets an answer from the repo overview.
  if (!parts.length) parts.push(...overviewParts(r))
  return { parts: parts.slice(0, 12), hits }
}

// The code around one finding, so the AI can write a fix.
export function fixContext(r, finding) {
  const f = r.files.find((x) => x.path === finding.path)
  if (!f) return [{ path: finding.path, text: `${finding.text}\n(problem: ${finding.tip})` }]
  const w = windowOf(f, finding.line, 6, 6)
  return [{ path: w.path, text: `${w.text}\n(problem on line ${finding.line}: ${finding.tip})` }]
}

// An instant starting point for the editor, no AI needed.
export function starterFix(f) {
  const t = f.text
  if (f.sev === 'high' && /["']••••••["']|••••••/.test(t)) {
    const name = ((t.match(/(\w+)\s*[:=]/) || [])[1] || 'MY_SECRET').toUpperCase()
    return t.replace(/(['"])••••••\1|••••••/, `process.env.${name}`)
  }
  if (/catch\s*(\(\s*(\w+)\s*\))?\s*\{\s*\}/.test(t)) return t.replace(/\{\s*\}\s*$/, (m) => '{ console.error(' + ((t.match(/catch\s*\(\s*(\w+)/) || [])[1] || 'err') + ') }')
  if (f.sev === 'low' && /console\./.test(t)) return '// (line removed)'
  return t
}

// Calls our own server (api/explain.js). The AI key never reaches the browser.
export async function explain(question, parts, mode = 'explain') {
  let r
  try {
    r = await fetch(API_URL + '/api/explain', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode, question, snippets: parts.map((p) => ({ path: p.path, text: p.text.slice(0, 1500) })) }),
      signal: AbortSignal.timeout(30000),
    })
  } catch {
    throw new Error('offline')
  }
  if (r.status === 404 || r.status === 405) throw new Error('offline')
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || 'The AI could not answer right now. Please try again.')
  return j.answer
}

// ---- Meaning search: the Python server makes vectors, the browser compares them ----
export function chunkFiles(files, size = 14, limit = 350) {
  const chunks = []
  for (const f of files) {
    for (let i = 0; i < f.lines.length && chunks.length < limit; i += size) {
      const text = f.lines.slice(i, i + size).map((l) => redact(l.slice(0, 200))).join('\n')
      if (text.trim()) chunks.push({ path: f.path, start: i + 1, end: Math.min(i + size, f.lines.length), text })
    }
  }
  return chunks
}

async function embed(texts, kind) {
  let r
  try {
    r = await fetch(API_URL + '/api/embed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texts, kind }),
      signal: AbortSignal.timeout(30000),
    })
  } catch {
    throw new Error('offline')
  }
  if (r.status === 404 || r.status === 405) throw new Error('offline')
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || 'Meaning search could not run right now.')
  return j.vectors
}

export async function buildIndex(files, onProgress) {
  const chunks = chunkFiles(files)
  const vectors = []
  for (let i = 0; i < chunks.length; i += 50) {
    const batch = chunks.slice(i, i + 50)
    vectors.push(...(await embed(batch.map((c) => c.path + '\n' + c.text), 'document')))
    onProgress(Math.min(i + 50, chunks.length), chunks.length)
  }
  return { chunks, vectors }
}

export async function semanticSearch(index, question) {
  const [q] = await embed([question], 'query')
  return index.chunks
    .map((c, i) => ({ ...c, score: index.vectors[i].reduce((sum, x, k) => sum + x * q[k], 0) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
}
