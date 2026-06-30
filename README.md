# Private AI — V1.0.0

A secure, private personal AI assistant dashboard built with React (Vite) and Node.js (Express). Features multi-agent orchestration, live deep internet scraping, real-time Google News summaries, local database storage, calendar task management, and GitHub client integrations.

## Features
- **Dual AI Core (Local & Online)**: Connects to local LLMs (LM Studio, Ollama, etc.) and online providers (Gemini, Anthropic, OpenAI) with a visual model selector.
- **Smart Router & Tools**: The coordinator routing agent dynamically triggers tools:
  - **Google Live Search with Deep Scraper**: Scrapes the top Google search result pages and extracts raw text context for the AI to summarize findings.
  - **Google NewsRSS Scraper**: Resolves and parses news.google.com top articles using internal protobuf decoder APIs to deep-scrape real-time article text.
  - **SQLite Calendar**: Add, list, and delete tasks and meetings.
  - **GitHub Client**: Retrieve repos, branches, and issue details.
- **Secure Password View**: Toggle password inputs to eye/eye-closed status for sensitive API keys.
- **Raspberry Pi 5 Deployable**: Single-port Express production engine serving built React static pages.

---

## Installation & Setup

### Prerequisites
- **Node.js**: Version 18.0.0 or higher (required for native `fetch` support).

### 1. Install Dependencies
Run the install script from the root directory to automatically resolve all backend and frontend NPM packages:
```bash
npm run install:all
```

### 2. Configure Environment Variables
Copy the `.env.example` file to `.env`:
```bash
cp .env.example .env
```
Open `.env` and configure your credentials:
```env
PORT=5173
JWT_SECRET=some_long_random_secret_phrase_for_private_ai_assistant
DB_PATH=backend/database.db
```

---

## Deployment on Raspberry Pi 5 (Port 5173)

To deploy the app in production on a Raspberry Pi 5 using a single port (5173) for maximum performance:

1. **Build the Frontend**:
   Compile the optimized frontend React files into static HTML/CSS/JS assets:
   ```bash
   npm run build
   ```
2. **Start the Production Server**:
   Ensure `PORT=5173` is set in your `.env` file, then boot the server:
   ```bash
   npm start
   ```
The Express backend will start on port `5173` and automatically serve the built frontend assets from `frontend/dist`. You can now open a browser on your Raspberry Pi (or access it over the network) at:
`http://localhost:5173` (or `http://<rpi-ip-address>:5173`)

---

## Development Mode

If you want to run the frontend and backend servers as separate hot-reloading development processes:

1. Start both servers concurrently:
   ```bash
   npm run dev
   ```
2. The frontend Vite server runs on `http://localhost:5173` (proxying `/api` requests to the Express server running on `http://localhost:3000`).
