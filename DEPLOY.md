# OMENA Autonomous Agentic IDE & Workbench - Production Deployment Guide

This guide details the deterministic, production-grade deployment of the **OMENA Autonomous Agentic IDE & Mobile Workbench** on any dedicated Linux server (Ubuntu/Debian, VPS, or Cloud VM).

---

## 1. System Prerequisites

* **Operating System:** Ubuntu 22.04 LTS, Ubuntu 24.04 LTS, or Debian 12 (Bookworm)
* **Hardware:** Minimum 2 vCPU, 4GB RAM, 20GB SSD (Recommended: 4 vCPU, 8GB RAM for concurrent browser automation)
* **Software:** Docker Engine 24.0+ and Docker Compose v2.20+
* **Networking:** Open ports 80/443 (Reverse Proxy) and 8080 (Internal container port)

### Install Docker Engine & Compose on Ubuntu/Debian:
```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
```

---

## 2. Server Directory Contract

The application strictly adheres to the standardized production directory layout:

```text
/opt/omena/
├── app/                  # Cloned Git repository root
│   ├── Dockerfile
│   ├── docker-compose.yml
│   ├── server.js
│   ├── agent_engine.js
│   ├── agent_orchestrator.js
│   ├── workbench_engine.js
│   ├── db.js
│   ├── security.js
│   ├── providers/
│   └── public/
├── storage/              # Persistent application storage (survives container recreation)
│   ├── workbench.db      # Authoritative SQLite WAL database
│   ├── memory/           # Persistent agent memory & execution state
│   ├── artifacts/        # Captured screenshots, reports & documents
│   └── workbench_uploads/
├── workspace/            # Authoritative project workspace inspected & modified by the agent
├── backups/              # Automated database and workspace snapshots
└── .env                  # Environment configuration and secrets (chmod 600)
```

### Create Base Directories:
```bash
sudo mkdir -p /opt/omena/storage /opt/omena/workspace /opt/omena/backups
sudo chown -R 1000:1000 /opt/omena/storage /opt/omena/workspace
sudo chmod 750 /opt/omena/storage /opt/omena/workspace
```

---

## 3. Clone & Configure Application

```bash
cd /opt/omena
git clone <REPOSITORY_URL> app
cd /opt/omena/app

# Copy production environment configuration template
cp .env.example .env
chmod 600 .env
```

### Environment Configuration (`.env`):
Edit `/opt/omena/app/.env` with your secure credentials:
```env
# Application Settings
NODE_ENV=production
PORT=8080
HOST=0.0.0.0
ADMIN_PASSWORD=SetAStrongRandomAdminPasswordHere!

# Execution Security & Profile
EXECUTION_MODE=container
EXECUTION_PRIVILEGE=standard

# Storage Paths
WORKSPACE_ROOT=/app/workspace
STORAGE_DIR=/app/storage
DATABASE_PATH=/app/storage/workbench.db

# Optional AI Provider API Keys (Leave blank to use local offline planner)
GEMINI_API_KEY=
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
LOCAL_AI_URL=http://host.docker.internal:11434/v1
```

---

## 4. Launch Stack via Docker Compose

```bash
cd /opt/omena/app
docker compose up -d --build
```

### Verify Container Status:
```bash
docker compose ps
docker compose logs -f
```

### Health & Readiness Checks:
```bash
# Check service health and database connection
curl -sf http://localhost:8080/health | jq

# Check readiness and execution profile
curl -sf http://localhost:8080/ready | jq
```

---

## 5. Production Nginx Reverse Proxy & HTTPS (with Unbuffered SSE)

SSE (Server-Sent Events) and real-time terminal streaming require reverse proxy buffering to be explicitly disabled.

Install Nginx and Certbot:
```bash
sudo apt-get install -y nginx certbot python3-certbot-nginx
```

Configure `/etc/nginx/sites-available/omena.conf`:
```nginx
server {
    listen 80;
    server_name agent.yourdomain.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name agent.yourdomain.com;

    # SSL Certificates (managed via Certbot)
    ssl_certificate /etc/letsencrypt/live/agent.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/agent.yourdomain.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    client_max_body_size 50M;

    # Standard Reverse Proxy
    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # CRITICAL: SSE Event Stream & Real-Time Terminal Unbuffered Proxying
    location ~* ^/api/(stream|chat) {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Disable all buffering for instant streaming
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
        chunked_transfer_encoding on;
    }
}
```

Enable configuration and issue certificate:
```bash
sudo ln -s /etc/nginx/sites-available/omena.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d agent.yourdomain.com
```

---

## 6. Operational Controls

### Emergency Stop Mechanism:
If an autonomous task needs immediate termination, invoke the emergency stop endpoint:
```bash
curl -X POST https://agent.yourdomain.com/api/agent/emergency-stop \
  -H "Cookie: omena_session=<YOUR_SESSION_COOKIE>"
```

### Backup Database & Workspace:
```bash
# SQLite Online Backup (Safe during writes)
docker exec omena-agent-workbench sqlite3 /app/storage/workbench.db ".backup '/app/storage/backup-$(date +%F).db'"
sudo tar -czf /opt/omena/backups/omena-backup-$(date +%F).tar.gz /opt/omena/storage /opt/omena/workspace
```

### Application Updates (v4.0.1 Stabilization):
```bash
cd /opt/omena/app
git fetch origin main
git checkout v4.0.1
docker compose up -d --build
```
The persistent database at `/opt/omena/storage/workbench.db` and files in `/opt/omena/workspace` remain 100% intact across updates.

---

## 7. Cloud Security Group & Firewall Hardening

* **Ingress Boundary:** In AWS / Cloud Security Groups, do **NOT** leave port `8080` open to `0.0.0.0/0`.
* **Recommended Architecture:**
  1. Bind port 8080 to localhost inside `docker-compose.yml` (`127.0.0.1:8080:8080`).
  2. Route public HTTPS traffic through Nginx reverse proxy (port 443) or an authenticated Cloudflare Tunnel.
  3. If accessing port 8080 directly during initial deployment, restrict the AWS Security Group inbound rule to your specific administrator IP CIDR (`<YOUR_IP>/32`).
* **Credential Protection:** Never check `.env` files into source control. Provider API keys are persisted safely inside the internal SQLite WAL database via encrypted server-authoritative endpoints.
