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
pip install -r requirements-dev.txt
python -m pytest
```

**Check the Python function after deploying:** open `https://YOUR-SITE/api/embed` in a browser. You should see `{"error": "Use POST."}`. That means the function is running.

## Security checklist

- The key lives only in Vercel's environment variables. It is never in the browser or in Git.
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
