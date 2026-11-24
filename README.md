# RepoChat

Paste a public GitHub repo. RepoChat shows risky code with fixes, finds the lines that match your question, and an AI explains them in plain words.

## Why this project exists

Reading someone else's code is slow and scary. RepoChat lets anyone paste a public repo, see risky code with a fix, and ask questions in plain words, with proof of where each answer came from. It is also a learning project: a complete, secure, free-to-run Gen AI app from idea to live website.

**Gen AI skills it shows (good for a fresher CV):** calling an LLM through a secure server, RAG (retrieve the right code, then explain), prompt-injection defence, rate limiting and secret hiding, a React front end, and free deployment. Today retrieval is keyword search. Upgrading to embeddings plus a vector database (Supabase pgvector) is the natural next step and makes the RAG claim stronger.

**Roles it points to:** Generative AI Developer, Python AI Developer, AI Engineer, LLM Application Developer, AI Solutions Engineer.

Built with React (JavaScript), HTML, CSS, Vite and one Vercel serverless function. No TypeScript.

## Folder map

| Path | What it does |
|---|---|
| `src/App.jsx` | The pages and buttons (React) |
| `src/analyze.js` | Reads the repo from GitHub, checks for risky code, searches, calls the AI |
| `src/config.js` | Your name, portfolio link and logo path. Edit this |
| `src/data.js` | Text for the "How it works" and "Learn" sections, and sample project |
| `src/styles.css` | All the styling |
| `api/explain.js` | The server part. Holds the Gemini key and talks to the AI |
| `public/logo.svg` | Your logo. Replace this file with yours (keep the name) |
| `src/AiEdit.jsx`, `src/PRBox.jsx`, `src/Diff.jsx` | "Change code with AI", the pull request box, and the red and green preview |
| `src/fix.js`, `src/FixEditor.jsx` | The fix editor: continuous lines, diff preview, and the safe pull request |
| `mcp_server/` | Python MCP server so an AI assistant can scan, search and propose fixes as pull requests |
| `tests/js/` | JavaScript tests (`npm test`) |
| `api/embed.py` | Python server part. Turns text into vectors (embeddings) for meaning search |
| `scanner/repochat_scan.py` | Python command-line tool that finds risky code. Also runs in GitHub Actions |
| `tests/` | Python tests (`pytest`) for the server part and the scanner |
| `push-to-github.bat` / `.sh` | Double-click helper that pushes this folder to GitHub (first push and updates) |
| `vercel.json` | Security headers for the live site |
| `.github/workflows/pages.yml` | Publishes the site to GitHub Pages (github.io) on every push to `main` |
| `.github/workflows/ci.yml` | Builds the site on pull requests to catch mistakes |
| `.github/workflows/python.yml` | Runs the Python tests and scans the repo for leaked secrets on every push |
| `.env.example` | Shows which secrets are needed. The real `.env` is never committed |

## 1. Set it up on your computer

```bash
npm install
npm run dev
```

Open the address it prints. Repo analysis works. The AI answer needs the server part, see step 4.

Before you push, open `src/config.js` and set `PORTFOLIO_URL` to your portfolio link.

## 2. Put it on GitHub

Install Git and make a free account at github.com first.

**Easiest (website):**
1. On github.com click **New repository**. Name it `repochat`. Keep it **Public**. Do not tick "Add a README".
2. In the project folder run:

```bash
git init
git add .
git commit -m "First version of RepoChat"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/repochat.git
git push -u origin main
```

**Or with GitHub CLI (`gh`)**, one command after `gh auth login`:

```bash
git init && git add . && git commit -m "First version of RepoChat"
gh repo create repochat --public --source=. --push
```

Check that `.env` is NOT listed on GitHub. It is already in `.gitignore`.

### All the ways to push to GitHub (pick one)

**A. The helper script.** Windows: double-click `push-to-github.bat`. Mac or Linux: `bash push-to-github.sh`. It works for the first push and for later updates.

**B. Git commands.** First push of a new folder:
```bash
git init
git add .
git commit -m "First version of RepoChat"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/repochat.git
git push -u origin main
```
Later updates, after you change files:
```bash
git add .
git commit -m "Describe what you changed"
git push
```
**C. The website.** Open your repo, click **Add file > Upload files**, drag the files in (not the outer folder), and click **Commit changes**. Show hidden files first, so `.github`, `.gitignore` and `.env.example` are included.

**D. GitHub Desktop** (no terminal). File > Add local repository, choose the folder, write a summary, **Commit to main**, then **Push origin**.

**E. As a pull request**, so main stays untouched until you approve. This is what RepoChat's own "Send this to GitHub as a pull request" button does. By hand:
```bash
git checkout -b my-change
git add . && git commit -m "My change"
git push -u origin my-change
```
then open the link GitHub prints and click **Create pull request**.

Never push a file named `.env`. If one was pushed by mistake, delete the key at its provider first, then remove the file.

## 3. Make the website live (free) with automatic updates

1. Go to vercel.com and sign up with your GitHub account.
2. Click **Add New > Project**, choose your `repochat` repo, then **Import**.
3. Settings (Vercel usually fills these in): Framework **Vite**, Build Command `npm run build`, Output Directory `dist`.
4. Before clicking Deploy, open **Environment Variables** and add the two values from step 4.
5. Click **Deploy**. You get a link like `repochat.vercel.app`.

Why not GitHub Pages (github.io)? Pages hosts only static files, so it cannot hold the secret key or run `api/explain.js`. Your portfolio is a good fit for Pages. RepoChat needs Vercel.

From now on, every `git push` to `main` updates the live site automatically. A push to any other branch creates a preview link.

### Also publish on GitHub Pages (github.io)

The site works on `https://YOUR-USERNAME.github.io/repochat/` too. One-time setup:
1. On GitHub open **Settings > Pages**, and under **Source** choose **GitHub Actions**.
2. Open the **Actions** tab, pick **Deploy to GitHub Pages**, and click **Run workflow** (or push any change).
3. For AI answers on Pages, deploy to Vercel as above, then in GitHub go to **Settings > Secrets and variables > Actions > Variables** and add `VITE_API_URL` = your Vercel address (for example `https://repochat.vercel.app`). In Vercel add `ALLOWED_ORIGINS` = `https://YOUR-USERNAME.github.io`. Without this, Pages still analyzes repos and lets you edit fixes, but AI answers say the server is not connected.

Note: `package-lock.json` is not in the repo. The first `npm install` creates it, and you can commit it.

## 4. Turn on the AI (free)

1. Go to aistudio.google.com, sign in, and choose **Get API key**. Create a key.
2. In Vercel, add: `GEMINI_API_KEY` = your key.
3. Add `GEMINI_MODEL` = a current free Flash model name shown in AI Studio. The default is `gemini-2.5-flash`. If you see "The AI service had a problem", the model name is probably old, so change this value and redeploy.
4. For local testing with the AI, copy `.env.example` to `.env`, fill it in, then run `npx vercel dev` instead of `npm run dev`.

Good to know:
- Free limits are per project and are shown in AI Studio. When they run out, users see a friendly message.
- On Google's free tier, the text you send can be used to improve their products. RepoChat sends only a few matching lines of public repos. Do not use it on private code.

## 5. The Python parts

**Meaning search (`api/embed.py`)** is the real "retrieve" step of RAG. When a visitor clicks **Turn on meaning search**, the browser cuts the code into chunks and sends them, in batches of 50, to `/api/embed`. That Python function asks Gemini for embeddings (a list of numbers describing what each chunk is about), and returns them. Questions are embedded the same way, and the browser picks the chunks whose numbers are closest. So "how do users sign in?" can find login code even when the word "login" never appears. The closest chunks then go to the AI to explain.

It needs the same `GEMINI_API_KEY`. Optional settings: `GEMINI_EMBED_MODEL` (default `gemini-embedding-001`, check the current free model in AI Studio) and `EMBED_DIM` (default `768`, set `0` if the model rejects it).

**Scanner (`scanner/repochat_scan.py`)** needs only Python 3.9 or newer:

```bash
python scanner/repochat_scan.py .              # scan this folder
python scanner/repochat_scan.py . --json       # machine-readable output
python scanner/repochat_scan.py . --fail-on medium
```

Add the comment `repochat-ignore` to a line you want it to skip. Exit code 1 means it found something at or above the `--fail-on` level, which is how the GitHub workflow turns red when a key is leaked.

**Run the Python tests:**

```bash
pip install -r tests/requirements-dev.txt
python -m pytest
```

**Check the Python function after deploying:** open `https://YOUR-SITE/api/embed` in a browser. You should see `{"error": "Use POST."}`. That means the function is running.

## 6. Fixes, deployment checks and pull requests

**Edit a fix.** Each risky line opens a block of continuous lines (3, 5 or 9). The risky line carries a coloured bar, a fix is already filled in, and a red and green preview updates as you type.

**Deployment check and health score.** RepoChat also looks for the things that most often break a first deploy: a committed `.env`, no build or start script, no lock file, no Node version, no Python package list, hard-coded `localhost`, a fixed port, debug mode, and undocumented environment variables. It lists every environment variable the code reads, and warns when a secret-looking name starts with `VITE_`, `NEXT_PUBLIC_` or `REACT_APP_` (those ship to every visitor). The 0 to 100 score is a rough guide only.

**Send a fix to GitHub, safely.** Under the editor, "Send this to GitHub as a pull request" creates a NEW branch and a pull request. It never writes to your main branch, so your main code stays as it is until you merge, and closing the pull request discards the change. Before sending, it checks the file has not changed since the scan, and it copies unchanged lines from the real file, so a hidden secret on a neighbouring line is never overwritten.

You paste a fine-grained token: GitHub, Settings, Developer settings, Fine-grained tokens. Expiration 1 day, only the one repository, with **Contents** and **Pull requests** set to Read and write. The token lives only in the page, is used once, and is sent only to github.com. You need write access to the repo, so for someone else's repo fork it first.

### Change code with AI (colours and more)

Under the chat, **Change code with AI** takes a plain-words request such as "change the main color to green" or "make all buttons fully rounded". RepoChat picks the code the request is about (colour lines, `border-radius`, `font-size` and so on), the AI proposes new text, and you see a red and green preview. You can untick a file, edit the text by hand, then send it as one pull request. It uses the same safe pull request box, so main is never changed directly.

### MCP server (for Claude Desktop, Claude Code and other assistants)

MCP is the Model Context Protocol, a standard way for an AI assistant to use tools. `mcp_server/repochat_mcp.py` offers three: `scan_repo` and `find_code` (read-only) and `propose_fix_pr` (opens a pull request, never changes main).

```bash
pip install -r mcp_server/requirements.txt
```

Claude Desktop: add this to its MCP settings file, using your real path and a fine-grained token (the token is only needed for `propose_fix_pr`):

```json
{ "mcpServers": { "repochat": { "command": "python", "args": ["C:/full/path/to/repochat/mcp_server/repochat_mcp.py"], "env": { "GITHUB_TOKEN": "paste-token-here" } } } }
```

Claude Code: `claude mcp add repochat -e GITHUB_TOKEN=paste-token-here -- python /full/path/to/repochat/mcp_server/repochat_mcp.py`

Your assistant asks before it runs a tool. Keep that approval on for `propose_fix_pr`. Tests: `python -m pytest` (Python) and `npm test` (JavaScript).

## 7. API rules (so the API cannot be abused)

Both server parts (`api/explain.js` and `api/embed.py`) follow the same rules. Change any number with an environment variable in Vercel. No code edits needed.

| Rule | Default | Change with |
|---|---|---|
| Only your own site and the sites you list can call the API | your site only | `ALLOWED_ORIGINS` |
| Questions per visitor per minute | 8 (embed: 20) | `RATE_PER_MINUTE` |
| Total AI requests per day for the whole site | 300 (embed: 600) | `DAILY_LIMIT` |
| Request size, snippet count and snippet length | fixed in code | edit the constants at the top |
| Secrets found in code are hidden before anything is sent to the AI | always on | |
| Text inside a repo cannot give the AI new instructions | always on | |
| The Gemini key exists only in Vercel | always on | |

By default the counters live in memory, so a server restart resets them. For limits that cannot be reset, add a free Upstash Redis database (upstash.com), copy its REST address and token into `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`, and the counters move there automatically. If Upstash is ever unreachable, the memory counters take over, so the API never opens up.

Also set a limit on the Google side: in Google AI Studio or Cloud Console, restrict the key to the Generative Language API and set a quota. That is your last line of defence if everything else fails. Address restrictions don't work well with Vercel, because its addresses change.

## 8. Use cases and drawbacks

**Use cases.** Understand a new project fast. Check a project before you deploy it (missing build script, committed `.env`, undocumented variables, a secret that ships to the browser). Catch leaked keys. Fix a risky line, or describe a change in plain words and send it as a pull request. Scan your own portfolio before you share it. Learn how real projects are put together.

**Drawbacks, honestly.**
- The checks are pattern-based. Some results are false alarms (add `repochat-ignore` to skip a line) and some real problems are missed. It is not a full security audit.
- It reads about 40 small code files per repo, public repos only, and GitHub allows roughly 60 anonymous requests an hour per network.
- The AI can be wrong. Always read the preview and the cited lines before you trust or merge anything.
- The free Gemini tier has limits, and Google may use free-tier text to improve its products. Use public code only.
- Pull requests need a token you paste into the page. Use a fine-grained, one-repo, one-day token.
- The per-minute limit is best-effort until you add Upstash. There are no user accounts yet.
- The Python function has been tested locally, but not on Vercel.

## Security checklist

- The key lives only in Vercel's environment variables. It is never in the browser or in Git.
- The pull request button never sends your token anywhere except api.github.com, never stores it, and only ever writes to a new branch.
- `api/explain.js` limits request size, allows only your own site, limits each visitor to 8 questions a minute, hides secrets found in code, and tells the AI to treat repo text as data, not instructions.
- The per-minute limit is best-effort because free servers restart. For stronger protection later, add Upstash Redis (free) or set a quota in Google AI Studio.
- If a key is ever pushed by accident: delete it in AI Studio at once and create a new one. Removing the file from Git is not enough.
- Turn on GitHub **Settings > Code security > Secret scanning** for your repo.
- `api/embed.py` has the same protections as the other function: size limits, same-site or allow-listed origins only, 20 requests a minute per visitor (best-effort), and secrets hidden before text leaves your server.

## Troubleshooting

- **"The AI is not set up yet"**: `GEMINI_API_KEY` is missing in Vercel. Add it, then redeploy.
- **"GitHub's free limit was reached"**: wait a few minutes. GitHub allows limited anonymous requests.
- **Repository not found**: it is private or the name is wrong.
- **Changed an environment variable but nothing happened**: Vercel needs a redeploy for new values.
