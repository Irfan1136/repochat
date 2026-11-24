import test from 'node:test'
import assert from 'node:assert/strict'
import { parseRepo, scanFiles, starterFix, findEnvVars, deployChecks, healthScore, buildContext, analyzeRepo, redact } from '../../src/analyze.js'
import { diffLines, applyEdit, createFixPR } from '../../src/fix.js'

const FAKE = 'sk_' + 'live_' + 'a1b2c3d4e5f6g7h8i9' // built at run time so this file never looks like a leak
const file = (path, code) => ({ path, lines: code.split('\n') })
const b64 = (s) => Buffer.from(s).toString('base64')

test('parseRepo accepts owner/repo and links, rejects the rest', () => {
  assert.deepEqual(parseRepo('https://github.com/vercel/next.js'), { owner: 'vercel', repo: 'next.js' })
  assert.deepEqual(parseRepo('Irfan1136/repochat'), { owner: 'Irfan1136', repo: 'repochat' })
  for (const bad of ['../x', 'a/b/c', 'nope', '']) assert.equal(parseRepo(bad), null)
})

test('scanner hides secrets and honours repochat-ignore', () => {
  const found = scanFiles([file('a.js', `const API_KEY = "${FAKE}"\neval(x)\neval(y) // repochat-ignore`)])
  assert.equal(found.length, 2)
  assert.ok(found.every((f) => !f.text.includes(FAKE)))
})

test('starterFix repairs the risky line', () => {
  const secret = { sev: 'high', path: 'a.js' }
  assert.equal(starterFix(secret, 'const STRIPE_KEY = "••••••"'), 'const STRIPE_KEY = process.env.STRIPE_KEY') // repochat-ignore
  assert.equal(starterFix({ ...secret, path: 'a.py' }, 'api_key = "••••••"'), 'api_key = os.environ["API_KEY"]') // repochat-ignore
  assert.equal(starterFix({ sev: 'low', path: 'a.js' }, '  } catch (e) {}'), '  } catch (e) { console.error(e) }') // repochat-ignore
  assert.equal(starterFix({ sev: 'low', path: 'a.js' }, "  console.log('x')"), null) // repochat-ignore
  assert.equal(starterFix({ sev: 'medium', path: 'a.js' }, 'el.innerHTML = x'), 'el.textContent = x') // repochat-ignore
  assert.equal(starterFix({ sev: 'low', path: 'a.js' }, '// TODO later'), '// TODO later') // repochat-ignore
})

test('environment variables are found, with the public ones flagged', () => {
  const env = findEnvVars([file('a.js', 'const a = process.env.DB_URL + import.meta.env.VITE_API_KEY + process.env.NODE_ENV'), file('b.py', 'x = os.environ["TOKEN_X"]\ny = os.getenv("REGION")')]) // repochat-ignore
  assert.deepEqual(env.map((v) => v.name), ['DB_URL', 'REGION', 'TOKEN_X', 'VITE_API_KEY'])
  assert.equal(env.find((v) => v.name === 'VITE_API_KEY').isPublic, true)
})

test('deployment checks catch common deploy problems', () => {
  const r = {
    allPaths: ['src/a.js', 'app.py', 'package.json', '.env'],
    pkg: { scripts: {} },
    files: [file('src/a.js', "fetch('http://localhost:3000/api')\napp.listen(3000)\nconst k = import.meta.env.VITE_SECRET_KEY"), file('app.py', 'app.run(debug=True)')], // repochat-ignore
  }
  const titles = deployChecks(r).filter((c) => c.level !== 'ok').map((c) => c.title)
  for (const t of ['An .env file is committed', 'No build or start script', 'No Python dependency list', 'Hard-coded localhost address', 'Port fixed in the code', 'Debug mode turned on', 'A secret-looking variable is public', 'No .gitignore', 'No lock file']) assert.ok(titles.includes(t), t)
  const good = deployChecks({ allPaths: ['.gitignore', 'README.md', 'LICENSE', 'package.json', 'package-lock.json', '.github/workflows/ci.yml'], pkg: { scripts: { build: 'x' }, engines: { node: '>=20' } }, files: [] })
  assert.ok(good.every((c) => c.level === 'ok'))
})

test('health score is 100 when clean and falls with problems', () => {
  assert.deepEqual(healthScore([], []), { score: 100, label: 'Healthy' })
  const bad = healthScore([{ sev: 'high' }, { sev: 'high' }, { sev: 'high' }], [{ level: 'bad' }, { level: 'bad' }])
  assert.equal(bad.label, 'Risky')
  assert.ok(bad.score >= 0 && bad.score < 40)
})

test('diff and applyEdit never overwrite real lines with the redacted preview', () => {
  const lines = ['a', `const A_KEY = "${FAKE}"`, `const B_KEY = "${FAKE}"`, 'z'] // repochat-ignore
  const shown = lines.slice(1, 3).map(redact)
  const edited = [shown[0].replace('"••••••"', 'process.env.A_KEY'), shown[1]] // fix line 2, leave line 3 alone // repochat-ignore
  assert.deepEqual(diffLines(shown, edited).map((o) => o.t), ['del', 'add', 'eq'])
  const out = applyEdit(lines, 1, shown, edited)
  assert.equal(out[1], 'const A_KEY = process.env.A_KEY') // repochat-ignore
  assert.equal(out[2], lines[2]) // the real neighbouring secret is untouched
  assert.equal(out.length, 4)
})

test('applyEdit keeps CRLF, refuses stale files and placeholders', () => {
  const lines = ['a\r', 'b\r', 'c\r']
  assert.deepEqual(applyEdit(lines, 1, ['b'], ['x', 'y']), ['a\r', 'x\r', 'y\r', 'c\r'])
  assert.throws(() => applyEdit(['a', 'changed'], 1, ['b'], ['x']), /changed on GitHub/)
  assert.throws(() => applyEdit(['a', 'b'], 1, ['b'], ['k = "••••••"']), /placeholder/)
  assert.deepEqual(applyEdit(['a', 'b', 'c'], 1, ['b'], []), ['a', 'c']) // deleting a line works
})

test('createFixPR opens a branch and a pull request and never touches the default branch', async () => {
  const TOKEN = 'github_pat_' + 'x'.repeat(30)
  const calls = []
  globalThis.fetch = async (url, init) => {
    const body = init.body ? JSON.parse(init.body) : null
    calls.push({ method: init.method, url, body, auth: init.headers.Authorization })
    const ok = (j) => ({ ok: true, status: 200, json: async () => j })
    if (init.method === 'GET' && url.includes('/contents/')) return ok({ content: b64('keep\nold\nkeep'), sha: 'filesha' })
    if (init.method === 'GET') return ok({ object: { sha: 'basesha' } })
    if (url.endsWith('/pulls')) return ok({ html_url: 'https://github.com/o/r/pull/7' })
    return ok({})
  }
  const res = await createFixPR({ token: TOKEN, owner: 'o', repo: 'r', base: 'main', path: 'src/a b.js', start: 1, shown: ['old'], edited: ['new'], title: 'Fix', body: 'b' })
  assert.equal(res.url, 'https://github.com/o/r/pull/7')
  assert.deepEqual(calls.map((c) => c.method), ['GET', 'GET', 'POST', 'PUT', 'POST'])
  const put = calls.find((c) => c.method === 'PUT')
  assert.ok(put.body.branch.startsWith('repochat/fix-') && put.body.branch !== 'main')
  assert.equal(Buffer.from(put.body.content, 'base64').toString(), 'keep\nnew\nkeep')
  assert.ok(put.url.includes('src/a%20b.js'))
  assert.equal(calls.find((c) => c.url.endsWith('/git/refs')).body.sha, 'basesha')
  assert.equal(calls.find((c) => c.url.endsWith('/pulls')).body.base, 'main')
  assert.ok(calls.every((c) => c.url.startsWith('https://api.github.com/') && c.auth === 'Bearer ' + TOKEN))
})

test('createFixPR writes nothing when the file changed or the token is bad', async () => {
  const TOKEN = 'github_pat_' + 'y'.repeat(30)
  const calls = []
  globalThis.fetch = async (url, init) => { calls.push(init.method); return { ok: true, status: 200, json: async () => ({ content: b64('a\nsomething else\nc'), sha: 's', object: { sha: 'b' } }) } }
  await assert.rejects(createFixPR({ token: TOKEN, owner: 'o', repo: 'r', base: 'main', path: 'a.js', start: 1, shown: ['old'], edited: ['new'], title: 't', body: '' }), /changed on GitHub/)
  assert.deepEqual(calls, ['GET']) // nothing was written
  await assert.rejects(createFixPR({ token: 'short', owner: 'o', repo: 'r', base: 'main', path: 'a.js', start: 0, shown: [], edited: [], title: 't', body: '' }), /full GitHub token/)
  globalThis.fetch = async () => ({ ok: false, status: 403, json: async () => ({}) })
  await assert.rejects(createFixPR({ token: TOKEN, owner: 'o', repo: 'r', base: 'main', path: 'a.js', start: 0, shown: ['a'], edited: ['b'], title: 't', body: '' }), /cannot write/)
})

test('analyzeRepo reads a repo and returns paths, package.json and README', async () => {
  const files = { 'README.md': '# Demo', 'package.json': '{"scripts":{"build":"x"}}', 'src/app.js': `const API_KEY = "${FAKE}"\n`, '.env': 'X=1' } // repochat-ignore
  globalThis.fetch = async (url) => {
    const json = (b) => ({ ok: true, status: 200, json: async () => b })
    if (url.endsWith('/repos/o/r')) return json({ full_name: 'o/r', description: 'd', default_branch: 'main' })
    if (url.endsWith('/languages')) return json({ JavaScript: 10 })
    if (url.includes('/git/trees/')) return json({ tree: Object.keys(files).map((p) => ({ type: 'blob', path: p, size: files[p].length })) })
    const p = decodeURIComponent(url.split('/main/')[1])
    return files[p] != null ? { ok: true, status: 200, text: async () => files[p] } : { ok: false, status: 404 }
  }
  const r = await analyzeRepo('o', 'r', () => {})
  assert.equal(r.files.length, 1)
  assert.deepEqual(r.pkg, { scripts: { build: 'x' } })
  assert.ok(r.readme.includes('Demo') && r.allPaths.includes('.env'))
  assert.ok(r.findings.some((f) => f.path === '.env') && r.findings.every((f) => !f.text.includes(FAKE)))
  assert.ok(deployChecks(r).some((c) => c.title === 'An .env file is committed'))
  for (const q of ['how do i run this', 'what bugs are here', 'where is the api key']) assert.ok(buildContext(r, q).parts.length > 0)
})

// ---- AI change editor ----
import { editContext, parseEdits } from '../../src/analyze.js'
import { createPR } from '../../src/fix.js'

const SITE = {
  files: [
    file('src/styles.css', ':root{--blue:#3B82F6;--btn:#2563EB}\nbody{margin:0}\n.btn{background:var(--btn);border-radius:8px}\n.card{color:#fff}'),
    file('src/App.jsx', "export default () => <button className=\"btn\">Hi</button>"),
  ],
}

test('editContext finds the colour lines for a colour request and keeps snippets small', () => {
  const wins = editContext(SITE, 'change the main color to green')
  assert.ok(wins.length >= 1 && wins[0].path === 'src/styles.css')
  assert.ok(wins[0].shown.join('\n').includes('--blue:#3B82F6'))
  for (const w of wins) assert.ok(w.shown.join('\n').length <= 1500)
  const other = editContext(SITE, 'make the button rounded')
  assert.ok(other.some((w) => w.shown.join('\n').includes('border-radius')))
  assert.deepEqual(editContext(SITE, 'zzzz qqqq'), [])
})

test('parseEdits keeps only valid edits that match what was sent', () => {
  const wins = editContext(SITE, 'change the main color to green')
  const good = JSON.stringify({ summary: 'Made it green.', edits: [{ snippet: 0, text: wins[0].shown.join('\n').replace('#3B82F6', '#22C55E') }] })
  const out = parseEdits('```json\n' + good + '\n```', wins)
  assert.equal(out.summary, 'Made it green.')
  assert.equal(out.edits.length, 1)
  assert.ok(out.edits[0].edited.join('\n').includes('#22C55E') && out.edits[0].start === wins[0].start)
  assert.equal(parseEdits(JSON.stringify({ edits: [{ snippet: 9, text: 'x' }] }), wins).edits.length, 0) // unknown snippet
  assert.equal(parseEdits(JSON.stringify({ edits: [{ snippet: 0, text: wins[0].shown.join('\n') }] }), wins).edits.length, 0) // no change
  assert.throws(() => parseEdits('not json', wins), /expected format/)
})

test('createPR sends several files on one new branch, and writes nothing if any file is stale', async () => {
  const TOKEN = 'github_pat_' + 'z'.repeat(30)
  const files = { 'a.css': 'one\ntwo\nthree', 'b.css': 'red\nblue' }
  const calls = []
  globalThis.fetch = async (url, init) => {
    const body = init.body ? JSON.parse(init.body) : null
    calls.push({ method: init.method, url, body })
    const ok = (j) => ({ ok: true, status: 200, json: async () => j })
    const m = url.match(/contents\/([^?]+)/)
    if (init.method === 'GET' && m) return ok({ content: b64(files[decodeURIComponent(m[1])]), sha: 'sha-' + m[1] })
    if (init.method === 'GET') return ok({ object: { sha: 'basesha' } })
    if (url.endsWith('/pulls')) return ok({ html_url: 'https://github.com/o/r/pull/2' })
    return ok({})
  }
  const edits = [
    { path: 'a.css', start: 0, shown: ['one'], edited: ['ONE'] },
    { path: 'a.css', start: 2, shown: ['three'], edited: ['THREE'] }, // two edits in one file
    { path: 'b.css', start: 1, shown: ['blue'], edited: ['green'] },
  ]
  const out = await createPR({ token: TOKEN, owner: 'o', repo: 'r', base: 'main', edits, title: 't', body: 'b' })
  assert.deepEqual(out.files.sort(), ['a.css', 'b.css'])
  const puts = calls.filter((c) => c.method === 'PUT')
  assert.equal(puts.length, 2)
  assert.ok(puts.every((p) => p.body.branch.startsWith('repochat/fix-') && p.body.branch !== 'main'))
  assert.equal(Buffer.from(puts.find((p) => p.url.includes('a.css')).body.content, 'base64').toString(), 'ONE\ntwo\nTHREE')
  assert.equal(Buffer.from(puts.find((p) => p.url.includes('b.css')).body.content, 'base64').toString(), 'red\ngreen')

  calls.length = 0
  edits[2].shown = ['stale line'] // b.css no longer matches the scan
  await assert.rejects(createPR({ token: TOKEN, owner: 'o', repo: 'r', base: 'main', edits, title: 't', body: 'b' }), /changed on GitHub/)
  assert.ok(calls.every((c) => c.method === 'GET')) // nothing was written anywhere
  await assert.rejects(createPR({ token: TOKEN, owner: 'o', repo: 'r', base: 'main', edits: [edits[0], { path: 'a.css', start: 0, shown: ['one'], edited: ['x'] }], title: 't', body: 'b' }), /overlap/)
})
