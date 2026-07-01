# Private AI Assistant — V2.3.0

A secure, private personal AI assistant dashboard built with React (Vite) and Node.js (Express). Features multi-agent orchestration, live deep internet scraping, real-time Google News summaries, local database storage, calendar task management, and GitHub client integrations.

## Features
- **Dual AI Core (Local & Online)**: Connects to local LLMs (LM Studio, Ollama, etc.) and online providers (Gemini, Anthropic, OpenAI) with a visual model selector.
- **Responsive & Mobile Friendly**: A fully adaptive layout with collapsible sidebar menus (hamburger menu enabled on mobile viewports, hidden on desktop), opaque side overlays, optimized text inputs, and vertically stackable panels (such as the Schedule Manager) tailored for mobile and tablet sizes.
- **Smart Router & Tools**: The coordinator routing agent dynamically triggers tools:
  - **Google Live Search with Deep Scraper**: Scrapes the top Google search result pages and extracts raw text context for the AI to summarize findings.
  - **Google NewsRSS Scraper**: Resolves and parses news.google.com top articles using internal protobuf decoder APIs to deep-scrape real-time article text.
  - **SQLite Calendar**: Add, list, and delete tasks and meetings.
  - **GitHub Client**: Retrieve repos, branches, and issue details.
- **Secure Password View**: Toggle password inputs to eye/eye-closed status for sensitive API keys.
- **Raspberry Pi 5 Deployable**: Single-port Express production engine serving built React static pages.
- **Strict Quality Gate**: Integrated GitHub Actions CI testing suite that enforces a minimum **95% code coverage** threshold (statements and lines) on both backend routes/tools and frontend React components.

---

## Installation & Setup

### Prerequisites
- **Node.js**: Version 25.5.0 or higher (required for full compatibility).

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

We provide an automated setup and update script that manages dependencies, builds the application, and configures a systemd background service.

### Automated Setup & Update

You can run the unified `setup.sh` script to perform a clean installation or update an existing deployment. It automatically handles pulling the latest code, installing dependencies, building the application, and configuring a systemd background service:

```bash
# Run the setup/update script (prompts for sudo for system package/service installation)
./setup.sh
```

Once running, the background service will start automatically on boot. You can manage it using standard systemd commands:
- **Check Status**: `sudo systemctl status private-ai`
- **View Logs**: `journalctl -u private-ai -f`
- **Restart**: `sudo systemctl restart private-ai`

---

### Manual Deployment

To deploy the app manually in production on a Raspberry Pi 5 using a single port (5173):

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

---

## Project Structure

The codebase is organized into a clean, modular, and professional design layout:

```text
private_ai/
├── backend/
│   ├── middleware/
│   │   └── auth.js         # JWT Authentication Middleware
│   ├── routes/
│   │   ├── auth.js         # Authentication endpoints (/api/auth)
│   │   ├── profile.js      # User profile endpoints (/api/profile)
│   │   ├── settings.js     # User settings endpoints (/api/settings)
│   │   ├── calendar.js     # Calendar event CRUD endpoints (/api/calendar)
│   │   └── chat.js         # Chat sessions and SSE streaming coordinator
│   ├── tools/
│   │   ├── calendar_tool.js# SQLite calendar operations
│   │   ├── github_tool.js  # Github API operations
│   │   ├── google_news_tool.js # NewsRSS scraping operations
│   │   ├── weather_tool.js # OpenWeatherMap weather actions (current, hourly, daily)
│   │   └── web_search_tool.js # DuckDuckGo / Google / Wiki deep scraper
│   ├── db.js               # SQLite database client & migration runner
│   ├── ai.js               # Sequential ReAct agent coordinator loop
│   ├── schema.sql          # SQLite table schemas
│   └── server.js           # Express App initialization and server startup
├── frontend/
│   ├── src/
│   │   ├── components/     # UI Modals, Sidebars, and Components
│   │   ├── App.jsx         # State orchestrator & layout template
│   │   └── main.jsx        # App entrypoint
│   └── vite.config.js      # Vite build & development proxy config
└── setup.sh                # Automated deploy/update script
```

