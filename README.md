# Private AI Assistant — Enterprise Suite (v4.2.0)

[![Wiki](https://img.shields.io/badge/wiki-available-brightgreen)](https://github.com/jjuhric/private_ai/wiki)

A secure, private personal AI assistant dashboard built with React (Vite) and Node.js (Express). Private AI features a ReAct multi-agent orchestration coordinator, live deep web scraping, real-time Google News summaries, persistent SQLite memory storage, task scheduling, system telemetry, and a mobile-responsive layout.

Version `4.2.0` introduces the **Multi-Device Hermes Network Architecture**, enabling a unified, local mesh network where a Windows main host coordinates and delegates hardware/control tasks to distributed Raspberry Pi and ESP32 field nodes.

---

## 🏗️ System-Wide Architecture

The Private AI Assistant splits functionality into a React frontend client, a Node.js backend supervisor, and distributed remote field nodes. The database (SQLite) holds user preferences, calendar events, messages, memories, and registered network nodes.

```mermaid
graph TB
    subgraph Client ["Client Device (Web Browser)"]
        UI["React Web UI"]
        SSE_Conn["Server-Sent Events Reader"]
    end

    subgraph MainHost ["Main Host (Windows PC)"]
        WebServer["Express HTTP Web Server (Port 5173 / 3000)"]
        Database[("SQLite database.db")]
        Coord["ReAct Coordinator (ai.js)"]
        Bridge["Agent Bridge Router"]
        LLM["Local/Online LLM Core"]
    end

    subgraph FieldNodes ["Field Nodes (Local Network)"]
        RPi["Raspberry Pi (Zero 2W / 4 / 5)"]
        ESP["ESP32 MicroPython Nodes"]
    end

    UI -->|REST API Requests| WebServer
    SSE_Conn <-->|SSE Stream /api/chat/send| WebServer
    WebServer <--> Database
    WebServer <--> Coord
    Coord -->|Delegates to Remote Node| Bridge
    Bridge -->|HTTP REST Control| RPi
    Bridge -->|MicroPython REST API| ESP
```

---

## ⚙️ Device Setup & Deployment

Private AI operates in a distributed network. Setup instructions differ based on the device role. For a comprehensive, out-of-the-box walkthrough covering setting up LM Studio, Ollama, GitHub Personal Access Tokens, Windows background tasks, and Raspberry Pi systemd configurations, see the [Installation Guide Wiki Page](https://github.com/jjuhric/private_ai/wiki/Installation).

### 🔍 Core Setup Requirements
- **Name & Zipcode**: Gained during initialization to personalize briefings and weather forecasts.
- **GitHub Personal Access Token (PAT)**: **(REQUIRED)** Required to fetch tool repository components and download code updates.
- **Local LLM (LM Studio / Ollama)**: **(REQUIRED)** The system defaults entirely to your Local LLM. Online API keys (e.g. Gemini) are optional fallbacks.

### 1. Windows Main Host (Running LLMs)
The Windows PC acts as the central brain. It runs the local LLM integration, coordinates multi-agent loops, and maintains the primary database.

> [!WARNING]  
> **Strict Approval Mode**: On Windows, all system modification tools (like running scripts, writing files, and executing commands) are locked down and require explicit Human-In-The-Loop (HITL) UAC approval before execution.

#### Setup Steps:
1. **Prerequisites**: Install Node.js (`v25.5.0` or higher), Git, and LM Studio/Ollama.
2. **Install Dependencies**:
   ```powershell
   npm run install:all
   ```
3. **Configure Environment**:
   ```powershell
   copy .env.example .env
   ```
   Follow the setup prompts to input your name, zipcode, local LLM URL, and GitHub token.
4. **Launch Development Servers**:
   ```powershell
   npm run dev
   ```
5. **Setup Wizard**: Access `http://localhost:5173` to launch the Setup Wizard. Choose **Windows** as the device type during initialization.

---

### 2. Raspberry Pi Node (Zero 2W, 3, 4, or 5)
Raspberry Pi nodes run lightweight backend endpoints to read telemetry (CPU temp, INA219 current/power draw), perform local GPIO manipulation, or run system-level shell scripts.

#### Setup Steps:
1. **Configure Environment**:
   ```bash
   cp .env.example .env
   ```
   Set `PORT=5173` and add `DEPLOY_MODE=backend-only` to disable building the React frontend assets (recommended for headless Pi Zero 2W).
2. **Automated systemd Service Registration**:
   ```bash
   chmod +x setup.sh
   ./setup.sh
   ```
   This will install backend packages, configure permissions, and setup a `private-ai` systemd background service.
3. **Service Management**:
   - Check Status: `sudo systemctl status private-ai`
   - Restart: `sudo systemctl restart private-ai`
   - Logs: `journalctl -u private-ai -f`

---

### 3. ESP32 Node (MicroPython)
ESP32 microcontrollers serve as low-power, cheap sensor nodes or relay controls communicating over WiFi.

#### Setup Steps:
1. **Prepare MicroPython**: Flash MicroPython onto your ESP32 board.
2. **Configure WiFi & Setup**:
   Open `esp32_firmware/main.py` and input your local WiFi SSID and Password inside the `main()` connection block.
3. **Deploy Firmware**:
   Copy `esp32_firmware/main.py` onto your ESP32 device as `main.py` using tools like Thonny, Adafruit-AMPY, or mpremote.
4. **REST Commands**: The ESP32 exposes:
   - `POST /api/gpio/write` (e.g. `{"pin": 2, "value": 1}`) to toggle pins.
   - Validates requests via a shared authorization `BRIDGE_SECRET` header.

---

## 🚀 How to Interact with Private AI

### 1. Setup Wizard
When launching Private AI for the first time, you are greeted by an automated setup wizard:
* **Step 1: Device Selection**: Identify the current device family (Windows, Raspberry Pi variants, ESP32 variants).
* **Step 2: Profile Settings**: Configure personal settings, system name, and location.
* **Step 3: Model Configuration**: Configure preferred online (Gemini/OpenAI/Claude) and local models.
* **Step 4: Review & Deploy**: Validates and saves configurations to the SQLite DB.

### 2. Multi-Agent Supervisor
Through the central chat pane, the **Supervisor Agent** acts as the primary scheduler. When you ask it to interact with local hardware, it checks node availability:
- To toggle an LED or read a sensor in a remote room, the supervisor invokes the `delegate_to_remote_node` tool.
- The command is sent via the backend **Agent Bridge** to the target node's IP address.
- If the action is dangerous or targeted at the Windows host, the frontend alerts the user with a UAC Modal for approval.

### 3. Network Nodes Registry Dashboard
Navigate to **System Control** -> **Field Nodes** tab to manage your smart home mesh:
* **Add Node**: Provide the node name, select the device type (RPi, ESP32, Windows), input its local IP address, and specify its bridge auth token.
* **Status Monitoring**: Live green/red online dots automatically ping remote nodes to ensure they are online.
* **Remove Node**: Cleanly delete nodes from your distributed registry.

---

## 🛠️ Auto-Update Workflow

To automatically update when changes are pushed to `main`, configure a GitHub webhook pointing to `/api/update`.
* The server verifies webhook payloads using GitHub's **HMAC-SHA256 signature** validation based on `UPDATE_WEBHOOK_SECRET`.
* Under `DEPLOY_MODE=backend-only`, updates pull commits and execute `npm install` without rebuilding the React client, preventing memory overload on weak nodes like RPi Zero 2W.
* On full hosts, it rebuilds frontend bundles and restarts the underlying system service.

---

## 🧪 Testing & Code Coverage

To run the full suite:
```bash
npm test
```
* **Unit & Integration Tests**: Covers routers, DB migrations, RAG vault tools, agent routing, and remote bridge payloads.
* **Coverage Requirements**: Strict enforcement of **90% statement and line coverage** via Jest (backend) and Vitest (frontend).
