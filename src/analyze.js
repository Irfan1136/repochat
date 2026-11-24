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
  { sev: 'medium', re: /\beval\s*\(/, tip: 'eval() runs text as code, which attackers can abuse. Use JSON.parse or a safer approach.' }, // repochat-ignore
  { sev: 'medium', re: /\.innerHTML\s*=|dangerouslySetInnerHTML/, tip: 'Inserting raw HTML can allow XSS attacks. Use textContent, or clean the HTML first.' }, // repochat-ignore
  { sev: 'low', re: /catch\s*(\([^)]*\))?\s*\{\s*\}|except\s*:\s*pass/, tip: 'The error is ignored silently, which hides bugs. Log it or handle it.' }, // repochat-ignore
  { sev: 'low', re: /\b(TODO|FIXME|HACK)\b/, tip: 'Unfinished work. Finish it or track it as an issue.' }, // repochat-ignore
  { sev: 'low', re: /console\.(log|debug)\(/, tip: 'Debug output left in the code. Remove it before release.' }, // repochat-ignore
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

export const redact = (s) => s.replace(/(['"])[A-Za-z0-9_\-/+=]{16,}\1/g, '"••••••"').replace(/sk_live_\w+|AKIA[0-9A-Z]{16}/g, '••••••')

export function scanFiles(files) {
  const out = []
  for (const f of files) {
    f.lines.forEach((line, i) => {
      if (line.length > 400 || line.includes('repochat-ignore')) return
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
  let pkg = null
  if (blobs.some((t) => t.path === 'package.json')) {
    try {
      const pr = await fetch(`https://raw.githubusercontent.com/${owner}/${repo}/${br}/package.json`, { signal: AbortSignal.timeout(10000) })
      if (pr.ok) pkg = JSON.parse(await pr.text())
    } catch { /* package.json is optional */ }
  }
  let readme = ''
  try {
    const rr = await fetch(`https://raw.githubusercontent.com/${owner}/${repo}/${br}/README.md`, { signal: AbortSignal.timeout(10000) })
    if (rr.ok) readme = (await rr.text()).split('\n').slice(0, 60).join('\n')
  } catch { /* README is optional */ }
  return { info, langs, total: blobs.length, files, findings, readme, paths: blobs.map((t) => t.path).slice(0, 80), allPaths: blobs.map((t) => t.path).slice(0, 5000), pkg }
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

// An instant fix for one risky line. Returns the new line, or null when the line should be deleted.
export function starterFix(f, line = f.text) {
  const py = f.path.endsWith('.py')
  if (f.sev === 'high' && line.includes('••••••')) {
    const name = ((line.match(/(\w+)\s*[:=]/) || [])[1] || 'MY_SECRET').toUpperCase()
    return line.replace(/(['"])••••••\1|••••••/, py ? `os.environ["${name}"]` : `process.env.${name}`)
  }
  if (/catch\s*(\(\s*\w+\s*\))?\s*\{\s*\}/.test(line)) return line.replace(/\{\s*\}(\s*)$/, `{ console.error(${(line.match(/catch\s*\(\s*(\w+)/) || [])[1] || 'err'}) }$1`)
  if (/^\s*console\.(log|debug)\(.*\)\s*;?\s*$/.test(line)) return null
  if (/\.innerHTML\s*=/.test(line)) return line.replace('.innerHTML =', '.textContent =') // repochat-ignore
  return line
}

// ---- Deployment readiness, environment variables and a health score ----
const PUBLIC_ENV = /^(VITE_|NEXT_PUBLIC_|REACT_APP_|PUBLIC_|EXPO_PUBLIC_)/
const ENV_SKIP = new Set(['NODE_ENV', 'MODE', 'BASE_URL', 'PROD', 'DEV', 'SSR', 'PATH', 'HOME', 'CI', 'PORT'])
const ENV_RES = [
  /process\.env\.([A-Z][A-Z0-9_]*)/g,
  /process\.env\[\s*['"]([A-Z][A-Z0-9_]*)['"]\s*\]/g,
  /import\.meta\.env\??\.([A-Z][A-Z0-9_]*)/g,
  /os\.environ(?:\.get)?\(\s*['"]([A-Z][A-Z0-9_]*)['"]/g,
  /os\.environ\[\s*['"]([A-Z][A-Z0-9_]*)['"]\s*\]/g,
  /os\.getenv\(\s*['"]([A-Z][A-Z0-9_]*)['"]/g,
]

export function findEnvVars(files) {
  const found = new Map()
  for (const f of files) {
    for (const line of f.lines) {
      if (line.includes('repochat-ignore')) continue
      for (const re of ENV_RES) {
        re.lastIndex = 0
        let m
        while ((m = re.exec(line))) {
          if (ENV_SKIP.has(m[1])) continue
          found.set(m[1], (found.get(m[1]) || new Set()).add(f.path))
        }
      }
    }
  }
  return [...found].map(([name, set]) => ({ name, files: [...set].slice(0, 3), isPublic: PUBLIC_ENV.test(name) })).sort((a, b) => a.name.localeCompare(b.name))
}

export function deployChecks(r) {
  const paths = r.allPaths || r.paths || r.files.map((f) => f.path)
  const has = (re) => paths.some((p) => re.test(p))
  const out = []
  const add = (level, title, tip, where) => out.push({ level, title, tip, where })
  const ok = (title) => add('ok', title)
  const where = (re, limit = 3) => {
    const w = []
    for (const f of r.files) f.lines.forEach((l, i) => { if (w.length < limit && !l.includes('repochat-ignore') && re.test(l)) w.push(`${f.path}:${i + 1}`) })
    return w
  }

  if (paths.some((p) => ENVF.test(p) && !ENV_OK.test(p))) add('bad', 'An .env file is committed', 'Remove it from Git, add .env to .gitignore, and replace every key inside it.')
  else ok('No .env file committed')
  if (has(/^\.gitignore$/)) ok('.gitignore present'); else add('warn', 'No .gitignore', 'Add one so node_modules, .env and build folders never reach GitHub.')
  if (has(/^readme(\.\w+)?$/i)) ok('README present'); else add('warn', 'No README', 'Say what the project does and how to run it. Whoever deploys it needs this.')
  if (has(/^licen[sc]e/i)) ok('License present'); else add('warn', 'No license file', 'Without one, others cannot legally reuse your code. Pick one at choosealicense.com.')
  if (has(/^\.github\/workflows\//)) ok('Automatic checks (CI) present'); else add('warn', 'No automatic checks (CI)', 'Add a GitHub Actions workflow so every push is built and tested before it goes live.')

  if (r.pkg) {
    const scripts = r.pkg.scripts || {}
    if (!scripts.build && !scripts.start) add('bad', 'No build or start script', 'Hosts look for "build" (websites) or "start" (servers) in package.json to know how to run the project.')
    else ok('Build or start script present')
    if (r.pkg.engines && r.pkg.engines.node) ok('Node version is set'); else add('warn', 'Node version not set', 'Add "engines": { "node": ">=20" } so the host uses the version you tested.')
    if (has(/^(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?)$/)) ok('Lock file present'); else add('warn', 'No lock file', 'Without one, each deploy may install different package versions. Commit package-lock.json.')
  }
  if (has(/\.py$/) && !has(/(^|\/)(requirements[\w.-]*\.txt|pyproject\.toml|Pipfile|setup\.py)$/)) add('bad', 'No Python dependency list', 'Add requirements.txt (or pyproject.toml) so the host can install what the code imports.')

  const local = where(/https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/)
  if (local.length) add('warn', 'Hard-coded localhost address', 'That address only works on your own computer. Read it from an environment variable instead.', local)
  const dbg = where(/\bdebug\s*=\s*True\b/)
  if (dbg.length) add('warn', 'Debug mode turned on', 'Debug mode can expose secrets and let visitors run code. Turn it off in production.', dbg)
  const port = where(/\.listen\(\s*\d{3,5}\s*[,)]/)
  if (port.length) add('warn', 'Port fixed in the code', 'Hosts choose the port. Use process.env.PORT (or os.environ["PORT"]).', port)

  const env = findEnvVars(r.files)
  const leaked = env.filter((v) => v.isPublic && /(KEY|SECRET|TOKEN|PASSWORD)/.test(v.name))
  if (leaked.length) add('bad', 'A secret-looking variable is public', `${leaked.map((v) => v.name).join(', ')} starts with a prefix that ships to every visitor's browser. Keep real secrets on a server.`)
  if (env.length && !has(/(^|\/)\.env\.(example|sample|template)$/i)) add('warn', 'Environment variables are not documented', 'Add a .env.example listing the names (not the values) so whoever deploys knows what to set.')
  else if (env.length) ok('.env.example documents the variables')
  const rank = { bad: 0, warn: 1, ok: 2 }
  return out.sort((a, b) => rank[a.level] - rank[b.level])
}

export function healthScore(findings, checks) {
  const n = (list, key, val) => list.filter((x) => x[key] === val).length
  const score = Math.max(0, Math.round(100
    - Math.min(45, n(findings, 'sev', 'high') * 15) - Math.min(20, n(findings, 'sev', 'medium') * 4) - Math.min(10, n(findings, 'sev', 'low'))
    - Math.min(20, n(checks, 'level', 'bad') * 10) - Math.min(15, n(checks, 'level', 'warn') * 3)))
  return { score, label: score >= 85 ? 'Healthy' : score >= 65 ? 'Needs attention' : 'Risky' }
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

// ---- "Change code with AI": pick the code a request is about, and read the AI's answer safely ----
const COLOR_WORDS = /\b(colou?rs?|theme|dark|light|background|accent|palette|blue|green|red|purple|orange|pink|yellow|teal|violet|indigo)\b/i
const COLOR_LINE = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|^\s*--[\w-]+\s*:|:root/
// Everyday words people use, and the code that usually means the same thing.
const STYLE_HINTS = [
  [/round|corner|pill|curve/i, /border-radius|rounded/],
  [/shadow|glow/i, /box-shadow|text-shadow|shadow/],
  [/font|text size|bigger text|larger text|smaller text|typeface/i, /font-size|font-family|font:/],
  [/spac|padding|margin|gap|tight|roomy|cramped/i, /padding|margin|gap:/],
  [/bold|weight|thin/i, /font-weight/],
  [/animat|motion|transition|speed|slow|fast/i, /animation|transition|@keyframes/],
]
const SYNONYMS = { button: 'btn', buttons: 'btn', navbar: 'nav', menu: 'nav', heading: 'h1', title: 'h1' }

export function editContext(r, instruction, maxWindows = 8) {
  const picks = []
  const rank = (p) => (/\.(css|scss|sass|less)$/i.test(p) ? 0 : /\.(html|svg|jsx|tsx|vue)$/i.test(p) ? 1 : 2)
  const order = r.files.map((f, i) => [i, rank(f.path)]).sort((a, b) => a[1] - b[1])
  const collect = (re) => {
    for (const [fi] of order) {
      let n = 0
      r.files[fi].lines.forEach((l, li) => { if (n < 10 && l.length < 1400 && re.test(l)) { picks.push([fi, li]); n++ } })
      if (picks.length > 40) break
    }
  }
  if (COLOR_WORDS.test(instruction)) collect(COLOR_LINE)
  for (const [when, re] of STYLE_HINTS) if (when.test(instruction)) collect(re)
  const extra = (instruction.toLowerCase().match(/[a-z]+/g) || []).map((w) => SYNONYMS[w]).filter(Boolean).join(' ')
  for (const h of search(r.files, instruction + ' ' + extra).slice(0, 6)) picks.push([r.files.findIndex((f) => f.path === h.path), h.line - 1])
  const wins = []
  for (const [fi, li] of picks) {
    if (fi < 0 || wins.length >= maxWindows) continue
    const f = r.files[fi]
    const start = Math.max(0, li - 2)
    if (wins.some((w) => w.fi === fi && start < w.start + w.shown.length && w.start < start + 12)) continue
    const shown = []
    let chars = 0
    for (let k = start; k < Math.min(f.lines.length, start + 12); k++) {
      const line = redact(f.lines[k].replace(/\r$/, ''))
      if (chars + line.length > 1400) break // each snippet must fit the server limit exactly, so what we show is what is sent
      chars += line.length + 1
      shown.push(line)
    }
    if (shown.length) wins.push({ fi, path: f.path, start, shown })
  }
  return wins
}

// The AI answers in JSON. Anything that does not match what we sent is dropped.
export function parseEdits(text, wins) {
  let j
  try { j = JSON.parse(text.trim().replace(/^```\w*\n?|\n?```$/g, '')) } catch { throw new Error('The AI answer was not in the expected format. Try describing the change differently.') }
  const edits = []
  for (const e of Array.isArray(j && j.edits) ? j.edits.slice(0, 8) : []) {
    const w = wins[e && e.snippet]
    if (!w || typeof e.text !== 'string' || e.text.length > 4000) continue
    const edited = e.text === '' ? [] : e.text.replace(/\r/g, '').split('\n')
    if (edited.join('\n') === w.shown.join('\n')) continue
    edits.push({ path: w.path, start: w.start, shown: w.shown, edited })
  }
  return { edits, summary: j && typeof j.summary === 'string' ? j.summary.slice(0, 300) : '' }
}
