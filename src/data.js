const f = (path, code) => ({ path, lines: code.split('\n') })

// A tiny made-up project so the demo works without internet.
export const SAMPLE_FILES = [
  f('src/auth/session.js', "import { decodeJwt } from './jwt.js'\n\nexport async function verifySession(token) {\n  const claims = await decodeJwt(token)\n  if (!claims.sub) throw new Error('missing_sub')\n  try {\n    return await db.users.find(claims.sub)\n  } catch (e) {}\n}"),
  f('src/payments/charge.js', "const STRIPE_KEY = \"sk_live_51Habcdefghijklmnop\"\n\n// TODO: handle refunds\nexport async function charge(order) {\n  console.log('charging', order.id)\n  return stripe.paymentIntents.create({ amount: order.total, currency: 'usd' })\n}"), // repochat-ignore (fake key for the demo)
  f('src/db/client.js', "import pg from 'pg'\n\nexport const db = new pg.Pool({\n  connectionString: process.env.DATABASE_URL,\n})"),
  f('src/routes/index.js', "router.post('/login', loginHandler)\nrouter.post('/checkout', requireAuth, payHandler)\nrouter.get('/orders', requireAuth, listOrders)"),
]

export const SUGGESTIONS = ['What problems are in this repo?', 'Where is login handled?', 'What does this project do?', 'Which file uses the database?']

export const STEPS = [
  ['Paste a link', 'Any public GitHub repository. The link is checked before anything is fetched.'],
  ['Read the code', 'Your browser lists the files and reads the main ones straight from GitHub.'],
  ['Check and search', 'Risky lines are flagged with a fix. Your question finds the lines that match.'],
  ['Explain with AI (next)', 'A language model will read only those lines and explain them in plain words.'],
]

export const SAFETY = [
  ['Nothing to steal', 'This version has no server and no API keys, so there is nothing secret to leak.'],
  ['Code is never run', 'Repository files are only read as text. Nothing from a repo is executed.'],
  ['Secrets are hidden', 'If a key is found in a repo, RepoChat shows •••• instead of the key.'],
  ['Strict input checks', 'Only owner/repo names are accepted, so the app cannot be tricked into visiting other sites.'],
  ['Locked-down page', 'The included vercel.json blocks scripts and connections from anywhere except GitHub.'],
]

export const LEARN = [
  ['Why was RepoChat built?', 'Reading someone else’s code is slow and scary, especially for students and new teammates. RepoChat lets anyone paste a repo, see the risky parts, and ask questions in plain words, with proof of where each answer came from.\nIt is also a learning project: a complete, safe, free-to-run Gen AI app, from idea to live website.'],
  ['Which Gen AI jobs use these skills?', 'Generative AI Developer or Engineer: builds apps on top of LLM APIs using prompts and RAG. This is the closest match.\nPython AI Developer and AI Engineer: the same work, often with more Python, data and model serving.\nLLM Application Developer and Prompt Engineer: designs prompts and checks answers for quality and safety.\nAI Solutions Engineer: connects AI to a company’s own tools and data.\nML Engineer, Data Scientist and MLOps: train, evaluate and deploy models. These need more maths and tooling than this project shows.\nRepoChat shows real examples of: calling an LLM through a secure server, retrieving the right context (RAG), defending against prompt injection, rate limiting, hiding secrets, a React front end, and free deployment.\nBe honest in interviews: today’s retrieval is keyword search. Upgrading to embeddings and a vector database makes the RAG claim stronger.'],
  ['What can RepoChat do today?', 'It reads a public GitHub repository in your browser, shows its languages and size, flags risky code such as hardcoded keys or a committed .env file, and finds the lines that match your question.\nIt uses no AI yet. That keeps it free, fast and private. Your browser talks only to GitHub.'],
  ['What is RAG?', 'RAG means retrieval-augmented generation. Instead of asking an AI to remember your code, you first retrieve the few most relevant pieces, then give only those to the AI so it can write an answer.\nThis app already does the retrieve step with keyword search. The next upgrade searches by meaning using embeddings (numbers that describe what a piece of code is about) stored in a vector database such as Supabase pgvector.'],
  ['What is an LLM?', 'A large language model is the AI that writes the answer, for example Gemini, Llama or GPT. It predicts text from what you give it, and it knows nothing about your repo by itself, so RAG supplies the code.\nNo LLM runs in this version. The plan is a free Gemini or Groq key used from a small server, so the key stays secret.'],
  ['What is an AI agent?', 'An agent is an LLM that can use tools in several steps, for example search the files, open one, then search again before answering.\nRepoChat does not need one at first. A single retrieve-then-answer step is simpler, cheaper and safer. An agent can come later for harder questions.'],
  ['What do the Python parts do?', 'api/embed.py runs on the server. It turns pieces of code into vectors (lists of numbers that capture meaning) using Gemini embeddings, without exposing the key. Your browser then compares them to find code by meaning.\nscanner/repochat_scan.py is a command-line tool that finds risky code such as leaked keys. It also runs on every push to this repo through GitHub Actions.'],
  ['What is it built with?', 'React with JavaScript (JSX), HTML and CSS. No TypeScript. Vite builds it, and GitHub’s public API provides the data. Python powers the embedding server (api/embed.py) and the scanner (scanner/repochat_scan.py).\nPlanned for the AI version: Vercel for hosting, Supabase for database and login, and Gemini or Groq for the model. All have free tiers.'],
]

// Pre-written answers so the sample project works when no AI server is connected.
export const SAMPLE_ANSWERS = [
  [/problem|error|bug|issue|risk|secret|security|fix/i, 'I found 4 things to check. The most serious is src/payments/charge.js:1, where a live Stripe key is written in the code. Anyone who can read the repository can use it.\nFix: move the key into an environment variable, then create a new key in Stripe and delete the old one.\nThe other three are small: an empty catch in src/auth/session.js:8 hides errors, a TODO about refunds, and a leftover console.log.'],
  [/login|auth|session|token/i, 'Login starts in src/routes/index.js:1, which sends POST /login to loginHandler. After that, src/auth/session.js:3 checks the token: it decodes it, rejects it if there is no user id, and loads the user from the database.\nOne thing to improve: line 8 has an empty catch, so a database error disappears silently. Log it instead.'],
  [/what does|about|overview|project|summary/i, 'This is a small online-shop API. It has login and session checks (src/auth), payments with Stripe (src/payments), a Postgres database connection (src/db) and the web routes (src/routes).'],
  [/database|db|sql|postgres/i, 'The database is set up in src/db/client.js:3 as a shared connection pool. The address comes from the DATABASE_URL environment variable, which is the safe way to do it because no password sits in the code.'],
]
