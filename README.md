# Spectra

Spectra is a comprehensive platform for orchestrating AI-powered agents to perform complex tasks involving web browsing, UI automation, data manipulation, and penetration testing. It leverages a modular, Dockerized architecture with specialized services for each function, all interconnected through the Model Context Protocol (MCP).

## ✨ Features

*   **AI-Powered Orchestration:** Utilizes LLM-based agents (Planner, Clicker, CyberChef, Pentest) for intelligent task breakdown and execution.
*   **Modular Microservices Architecture:** Composed of several Dockerized services, each handling a specific capability.
*   **Remote Browser Automation:** Provides an isolated, remote-controlled Chrome browser environment accessible via noVNC and automated through Playwright and PyAutoGUI via MCP.
*   **Integrated Pentesting Toolkit:** Offers a suite of common Kali Linux penetration testing tools (Nmap, SQLMap, GoBuster, etc.) accessible via a Flask API and MCP.
*   **CyberChef Integration:** Includes a built-in CyberChef instance for versatile data manipulation, accessible via its web UI and an MCP interface.
*   **Session Recording & Streaming:** Optional RTMP-based recording of browser sessions, with capabilities to upload recordings to Google Cloud Storage.
*   **MCP-Driven Tooling:** Employs the Model Context Protocol (MCP) for standardized, real-time communication between agents and various toolsets.
*   **Extensible Agent Framework:** Built upon Google's Agent Development Kit (ADK), allowing for easy development and deployment of new agents and capabilities.

## 🏗️ Architecture Overview

Spectra consists of several interconnected Docker containers:

*   **Agent Service (`spectra-agent`):** The central brain, hosting LLM-based agents that plan and delegate tasks. It communicates with other services using MCP.
*   **Browser Service (`spectra-browser`):** A headless Chrome browser instance with noVNC access. It exposes Playwright and PyAutoGUI functionalities via MCP servers for UI automation.
*   **RTMP Server (`spectra-rtmp-server`):** An Nginx-based server for streaming and recording browser sessions. Recordings can be automatically uploaded to Google Cloud Storage.
*   **Pentesting Tools Service (`spectra-pentools`):** A Kali Linux environment providing various penetration testing tools through a Flask API and an MCP server.
*   **CyberChef Service (`spectra-cyberchef-server` & `spectra-cyberchef-mcp`):** Hosts a CyberChef instance and an MCP server to expose its data manipulation capabilities to agents.

All services are orchestrated using `docker-compose.yaml`.

## 🧩 Components

### 1. Agents (`spectra-agent`)

*   **Role:** Orchestrates tasks, makes decisions, and interacts with tools.
*   **Technology:** Python, FastAPI, Google ADK, Google Gemini.
*   **Core Agents:**
    *   `Planner Agent`: Analyzes tasks, creates plans, and delegates to other agents or tools.
    *   `Clicker Agent`: Performs precise UI interactions using PyAutoGUI.
    *   `CyberChef Agent`: Utilizes CyberChef for data transformation and analysis.
    *   `Pentest Agent`: Executes penetration testing tools.
*   **Interface:** Exposes an API and potentially a web UI on port `8000`.

### 2. Browser (`spectra-browser`)

*   **Role:** Provides a remote-controlled, sandboxed browser environment.
*   **Technology:** Selenium/Standalone-Chrome base, Playwright, PyAutoGUI, noVNC, FFmpeg.
*   **MCP Servers:**
    *   Playwright MCP on port `8921`.
    *   PyAutoGUI MCP on port `8922`.
*   **Interface:** Remote desktop access via noVNC on port `7900`.
*   **Recording:** If `ENABLE_RECORDING=true`, sessions are streamed to the RTMP server.

### 3. RTMP Server (`spectra-rtmp-server`)

*   **Role:** Receives video streams from the browser service for live viewing and recording.
*   **Technology:** Nginx-RTMP, Node.js (for GCS upload).
*   **Ports:**
    *   RTMP input on port `1935`.
    *   Web interface (e.g., for HLS playback) on port `8080`.
*   **Storage:** Automatically uploads finished recordings (FLV files) to a configured Google Cloud Storage bucket.

### 4. Pentesting Tools (`spectra-pentools`)

*   **Role:** Provides access to a suite of penetration testing tools.
*   **Technology:** Kali Linux base, Python, Flask, FastMCP.
*   **Tools Include:** Nmap, SQLMap, Nikto, GoBuster, Dirb, Hydra, John the Ripper, WPScan, Enum4linux, Metasploit Framework (via resource scripts).
*   **Interfaces:**
    *   Flask API server on port `5000` for direct tool interaction.
    *   MCP server on port `5001` for agent-based interaction.

### 5. CyberChef (`spectra-cyberchef-server` & `spectra-cyberchef-mcp`)

*   **Role:** Provides the CyberChef "Cyber Swiss Army Knife" for data manipulation.
*   **Technology:** CyberChef, Node.js (for MCP server).
*   **Interfaces:**
    *   CyberChef Web UI on port `3000` (via `cyberchef-server`).
    *   MCP server on port `3001` (via `cyberchef-mcp`) to expose CyberChef operations to agents.

## 🚀 Getting Started

### Prerequisites

*   Docker: [Install Docker](https://docs.docker.com/get-docker/)
*   Docker Compose: [Install Docker Compose](https://docs.docker.com/compose/install/)
*   Git (for cloning the repository)

### Configuration

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/nishithp2004/spectra.git
    cd spectra
    ```

2.  **Set up Agent Environment Variables:**
    Copy the sample environment file for the agent service and customize it:
    ```bash
    cp agents/.env.sample agents/.env
    ```
    Edit `agents/.env` and fill in the required values, especially `GOOGLE_API_KEY` for the Gemini model. The other `MCP_TOOLS_URL_*` variables are typically correctly pre-configured for Docker Compose networking.

3.  **Set up RTMP Server Credentials (Optional):**
    If you plan to use the recording feature and upload to Google Cloud Storage:
    *   Ensure you have a GCS bucket.
    *   Ensure you have a Google Cloud service account JSON keyfile with permissions to write to the bucket.
    *   Place the keyfile at `./rtmp-server/credentials.json`.
    *   You might need to update `GCS_BUCKET_NAME` in `rtmp-server/upload_to_gcs.js` or set it as an environment variable if the script is modified to read it from there.
    *   Set `ENABLE_RECORDING=true` in `docker-compose.yaml` for the `browser` service.

### Running the Project

1.  **Build and run all services using Docker Compose:**
    ```bash
    docker-compose up -d --build
    ```
    The `--build` flag ensures images are built fresh. The `-d` flag runs containers in detached mode.

2.  **To view logs:**
    ```bash
    docker-compose logs -f
    ```
    Or for a specific service:
    ```bash
    docker-compose logs -f agent
    ```

3.  **To stop the services:**
    ```bash
    docker-compose down
    ```
    To stop and remove volumes (e.g., database data for agents if persistent):
    ```bash
    docker-compose down -v
    ```

## 🌐 Accessing Services

Once the services are running, you can access them via your browser:

*   **Spectra Agent UI (if enabled):** `http://localhost:8000`
    *   *Note: `SERVE_WEB_INTERFACE` must be `true` in `agents/.env`.*
*   **Browser (noVNC):** `http://localhost:7900` (for remote desktop view of the automated browser)
*   **RTMP Server Web Interface (HLS Player):** `http://localhost:8080`
*   **CyberChef UI:** `http://localhost:3000`
*   **Pentools API (e.g., health check):** `http://localhost:5000/health`

**MCP Server Endpoints (primarily for agent consumption):**
*   Browser Playwright MCP: `http://localhost:8921/sse`
*   Browser PyAutoGUI MCP: `http://localhost:8922/sse`
*   Pentools MCP: `http://localhost:5001/sse`
*   CyberChef MCP: `http://localhost:3001/sse` (Note: `cyberchef-mcp` service listens on internal port 3000 but is exposed as 3001 by Docker Compose)

## ⚙️ Environment Variables

Key environment variables are defined in:

*   `docker-compose.yaml`: For service-level configurations like port mappings, recording enablement, and inter-service URLs.
*   `agents/.env`: For agent-specific settings, particularly API keys and URLs for MCP tool servers.
*   `rtmp-server/upload_to_gcs.js` (and potentially its environment): For GCS bucket name and credentials path.

Refer to `agents/.env.sample` for a template of agent-specific variables.

## 🛠️ Development

*   Each component (agents, browser, rtmp-server, tools/*) is a self-contained Dockerized application.
*   You can work on individual services by building and running them specifically. For example, to rebuild and restart only the `agent` service:
    ```bash
    docker-compose up -d --build agent
    ```
*   Python dependencies for the `agents` service are managed by Poetry (`agents/pyproject.toml`, `agents/poetry.lock`).
*   Python dependencies for `tools/pentools` are managed by `pip` (`tools/pentools/requirements.txt`).
*   Node.js dependencies for `rtmp-server` and `browser/playwright-mcp` are managed by `npm` (`package.json`, `package-lock.json`).
