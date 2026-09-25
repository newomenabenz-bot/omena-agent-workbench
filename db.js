/**
 * OMENA Production Embedded SQLite Database Engine v4.1.0
 * Zero-dependency native SQLite via Node.js built-in `node:sqlite` (DatabaseSync).
 * Supports WAL mode, atomic transactions, AES-256-GCM encrypted secret persistence,
 * schema migration engine (`schema_version`), and telemetry tables.
 */

import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || path.resolve(__dirname, '..', '..');
const STORAGE_DIR = path.join(WORKSPACE_ROOT, 'storage');
const DB_PATH = process.env.DATABASE_PATH || path.join(STORAGE_DIR, 'workbench.db');
const KEY_PATH = path.join(STORAGE_DIR, 'master.key');

export class WorkbenchDatabase {
  constructor(dbPath = DB_PATH) {
    if (!fs.existsSync(path.dirname(dbPath))) {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    }
    
    this.masterKey = this.initMasterKey();
    this.db = new DatabaseSync(dbPath);
    this.init();
  }

  initMasterKey() {
    if (process.env.MASTER_KEY) {
      return crypto.createHash('sha256').update(process.env.MASTER_KEY).digest();
    }
    try {
      if (fs.existsSync(KEY_PATH)) {
        const raw = fs.readFileSync(KEY_PATH);
        if (raw.length === 32) return raw;
      }
      const newKey = crypto.randomBytes(32);
      fs.writeFileSync(KEY_PATH, newKey, { mode: 0o600 });
      return newKey;
    } catch {
      return crypto.createHash('sha256').update('omena_workbench_fallback_secret_key_v4').digest();
    }
  }

  encryptSecret(plaintext) {
    if (!plaintext || typeof plaintext !== 'string') return '';
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.masterKey, iv);
    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag();
    return `enc:v1:${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  }

  decryptSecret(ciphertext) {
    if (!ciphertext || typeof ciphertext !== 'string') return '';
    if (!ciphertext.startsWith('enc:v1:')) return ciphertext; // Unencrypted plain text backward compatibility

    try {
      const parts = ciphertext.split(':');
      if (parts.length !== 5) return ciphertext;
      const iv = Buffer.from(parts[2], 'hex');
      const authTag = Buffer.from(parts[3], 'hex');
      const encryptedText = parts[4];

      const decipher = crypto.createDecipheriv('aes-256-gcm', this.masterKey, iv);
      decipher.setAuthTag(authTag);
      let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    } catch {
      return '';
    }
  }

  init() {
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL,
        description TEXT NOT NULL
      );
    `);

    this.runMigrations();
    this.migrateFromJson();
  }

  runMigrations() {
    const current = this.getCurrentSchemaVersion();

    if (current < 1) {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS auth_sessions (
          token TEXT PRIMARY KEY,
          role TEXT NOT NULL DEFAULT 'admin',
          created_at INTEGER NOT NULL,
          expires_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS sessions (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          model TEXT NOT NULL DEFAULT 'gemini-2.0-flash',
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          metadata TEXT
        );

        CREATE TABLE IF NOT EXISTS messages (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          tools TEXT,
          artifacts TEXT,
          created_at INTEGER NOT NULL,
          FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_auth_expires ON auth_sessions(expires_at);
      `);

      this.setSchemaVersion(1, 'Baseline v4.0.0 schema');
    }

    if (current < 2) {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS agent_runs (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          model TEXT NOT NULL,
          provider TEXT NOT NULL,
          status TEXT NOT NULL,
          prompt TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          completed_at INTEGER,
          duration_ms INTEGER,
          error TEXT,
          metadata TEXT,
          FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS agent_events (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL,
          seq INTEGER NOT NULL,
          type TEXT NOT NULL,
          payload TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          FOREIGN KEY (run_id) REFERENCES agent_runs(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS provider_health (
          provider TEXT PRIMARY KEY,
          state TEXT NOT NULL,
          latency_ms INTEGER,
          last_checked INTEGER NOT NULL,
          last_error TEXT,
          details TEXT
        );

        CREATE TABLE IF NOT EXISTS provider_usage (
          id TEXT PRIMARY KEY,
          provider TEXT NOT NULL,
          model TEXT NOT NULL,
          prompt_tokens INTEGER DEFAULT 0,
          completion_tokens INTEGER DEFAULT 0,
          reasoning_tokens INTEGER DEFAULT 0,
          duration_ms INTEGER DEFAULT 0,
          created_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS memory_records (
          id TEXT PRIMARY KEY,
          category TEXT NOT NULL,
          key TEXT NOT NULL,
          value TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_agent_runs_session ON agent_runs(session_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_agent_events_run_seq ON agent_events(run_id, seq ASC);
        CREATE INDEX IF NOT EXISTS idx_memory_records_cat ON memory_records(category, key);
      `);

      this.setSchemaVersion(2, 'OMENA v4.1.0 runtime, sequenced events, provider telemetry, and memory store');
    }
  }

  getCurrentSchemaVersion() {
    try {
      const stmt = this.db.prepare(`SELECT MAX(version) as ver FROM schema_version`);
      const row = stmt.get();
      return row?.ver || 0;
    } catch {
      return 0;
    }
  }

  setSchemaVersion(ver, desc) {
    const stmt = this.db.prepare(`INSERT OR REPLACE INTO schema_version (version, applied_at, description) VALUES (?, ?, ?)`);
    stmt.run(ver, Date.now(), desc);
  }

  migrateFromJson() {
    try {
      const jsonFile = path.join(STORAGE_DIR, 'workbench_sessions.json');
      if (!fs.existsSync(jsonFile)) return;

      const count = this.db.prepare('SELECT count(*) as cnt FROM sessions').get();
      if (count && count.cnt > 0) return;

      const content = fs.readFileSync(jsonFile, 'utf8');
      const sessions = JSON.parse(content || '[]');
      for (const s of sessions) {
        if (!s.id) continue;
        this.createSession(s.id, s.title || 'Conversation', 'gemini-2.0-flash');
        if (Array.isArray(s.messages)) {
          for (const m of s.messages) {
            this.addMessage(s.id, {
              role: m.role || 'user',
              content: m.content || '',
              tools: m.tools || [],
              artifacts: m.artifacts || []
            });
          }
        }
      }
    } catch (e) {
      console.warn('[DB Migration Warning]', e.message);
    }
  }

  // --- Auth Session Methods ---
  createAuthSession(token, role = 'admin', ttlMs = 7 * 24 * 60 * 60 * 1000) {
    const now = Date.now();
    const expiresAt = now + ttlMs;
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO auth_sessions (token, role, created_at, expires_at)
      VALUES (?, ?, ?, ?)
    `);
    stmt.run(token, role, now, expiresAt);
    return { token, role, expiresAt };
  }

  validateAuthSession(token) {
    if (!token) return null;
    const now = Date.now();
    const stmt = this.db.prepare(`
      SELECT token, role, expires_at FROM auth_sessions
      WHERE token = ? AND expires_at > ?
    `);
    const session = stmt.get(token, now);
    return session || null;
  }

  deleteAuthSession(token) {
    const stmt = this.db.prepare(`DELETE FROM auth_sessions WHERE token = ?`);
    stmt.run(token);
  }

  // --- Chat Session Methods ---
  createSession(id, title = 'New Conversation', model = 'gemini-2.0-flash', metadata = {}) {
    const now = Date.now();
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO sessions (id, title, model, created_at, updated_at, metadata)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(id, title, model, now, now, JSON.stringify(metadata));
    return { id, title, model, createdAt: now, updatedAt: now, messages: [] };
  }

  getSession(id) {
    const sStmt = this.db.prepare(`SELECT * FROM sessions WHERE id = ?`);
    const session = sStmt.get(id);
    if (!session) return null;

    const mStmt = this.db.prepare(`SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC`);
    const messages = mStmt.all(id).map(m => ({
      id: m.id,
      role: m.role,
      content: m.content,
      tools: m.tools ? JSON.parse(m.tools) : [],
      artifacts: m.artifacts ? JSON.parse(m.artifacts) : [],
      createdAt: m.created_at
    }));

    return {
      id: session.id,
      title: session.title,
      model: session.model,
      createdAt: session.created_at,
      updatedAt: session.updated_at,
      metadata: session.metadata ? JSON.parse(session.metadata) : {},
      messages
    };
  }

  getAllSessions() {
    const stmt = this.db.prepare(`SELECT * FROM sessions ORDER BY updated_at DESC`);
    const rows = stmt.all();
    return rows.map(s => {
      const lastMsgStmt = this.db.prepare(`
        SELECT content FROM messages WHERE session_id = ? ORDER BY created_at DESC LIMIT 1
      `);
      const lastMsg = lastMsgStmt.get(s.id);
      return {
        id: s.id,
        title: s.title,
        model: s.model,
        createdAt: s.created_at,
        updatedAt: s.updated_at,
        lastMessage: lastMsg ? lastMsg.content.slice(0, 80) : ''
      };
    });
  }

  deleteSession(id) {
    const dMsg = this.db.prepare(`DELETE FROM messages WHERE session_id = ?`);
    dMsg.run(id);
    const dSess = this.db.prepare(`DELETE FROM sessions WHERE id = ?`);
    dSess.run(id);
  }

  // --- Messages Methods ---
  addMessage(sessionId, message) {
    const now = Date.now();
    const id = message.id || `msg_${now}_${Math.random().toString(36).slice(2, 7)}`;

    const checkStmt = this.db.prepare(`SELECT id FROM sessions WHERE id = ?`);
    if (!checkStmt.get(sessionId)) {
      this.createSession(sessionId, message.content ? message.content.slice(0, 30) : 'Conversation');
    }

    const stmt = this.db.prepare(`
      INSERT INTO messages (id, session_id, role, content, tools, artifacts, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      id,
      sessionId,
      message.role || 'user',
      message.content || '',
      JSON.stringify(message.tools || []),
      JSON.stringify(message.artifacts || []),
      now
    );

    const uStmt = this.db.prepare(`UPDATE sessions SET updated_at = ? WHERE id = ?`);
    uStmt.run(now, sessionId);

    return { id, ...message, createdAt: now };
  }

  // --- Settings Methods ---
  getSetting(key, defaultValue = null) {
    const stmt = this.db.prepare(`SELECT value FROM settings WHERE key = ?`);
    const row = stmt.get(key);
    return row ? row.value : defaultValue;
  }

  setSetting(key, value) {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO settings (key, value, updated_at)
      VALUES (?, ?, ?)
    `);
    stmt.run(key, typeof value === 'object' ? JSON.stringify(value) : String(value), Date.now());
  }

  // --- Encrypted Provider Credentials Persistence ---
  saveProviderCredentials(newCreds = {}) {
    const existing = this.getProviderCredentials(false);
    const merged = { ...existing };

    for (const [k, v] of Object.entries(newCreds)) {
      if (typeof v === 'string') {
        const trimmed = v.trim();
        if (trimmed.length > 0) {
          merged[k] = trimmed;
        } else if (v === '') {
          delete merged[k];
        }
      }
    }

    // Encrypt individual credential values
    const encryptedObject = {};
    for (const [k, v] of Object.entries(merged)) {
      encryptedObject[k] = this.encryptSecret(v);
    }

    this.setSetting('provider_credentials_encrypted', encryptedObject);
    return merged;
  }

  getProviderCredentials(includeEnv = true) {
    const stored = this.getSetting('provider_credentials_encrypted', null);
    let creds = {};

    if (stored) {
      try {
        const parsed = typeof stored === 'string' ? JSON.parse(stored) : stored;
        for (const [k, v] of Object.entries(parsed)) {
          creds[k] = this.decryptSecret(v);
        }
      } catch {
        creds = {};
      }
    } else {
      // Fallback: check legacy unencrypted setting
      const legacy = this.getSetting('provider_credentials', null);
      if (legacy) {
        try {
          creds = typeof legacy === 'string' ? JSON.parse(legacy) : legacy;
        } catch {}
      }
    }

    if (includeEnv) {
      if (!creds.gemini && process.env.GEMINI_API_KEY) creds.gemini = process.env.GEMINI_API_KEY;
      if (!creds.openai && process.env.OPENAI_API_KEY) creds.openai = process.env.OPENAI_API_KEY;
      if (!creds.anthropic && process.env.ANTHROPIC_API_KEY) creds.anthropic = process.env.ANTHROPIC_API_KEY;
      if (!creds.deepseek && process.env.DEEPSEEK_API_KEY) creds.deepseek = process.env.DEEPSEEK_API_KEY;
      if (!creds.local && process.env.LOCAL_AI_URL) creds.local = process.env.LOCAL_AI_URL;
    }

    return creds;
  }

  getMaskedProviderStatus() {
    const creds = this.getProviderCredentials(true);
    const providers = ['gemini', 'openai', 'anthropic', 'deepseek', 'local'];
    const status = {};

    for (const p of providers) {
      const val = creds[p] || creds[`${p}Key`];
      if (val && typeof val === 'string' && val.trim().length > 0) {
        const clean = val.trim();
        const masked = clean.length > 8 
          ? `${clean.slice(0, 4)}...${clean.slice(-4)}` 
          : '••••••••';
        status[p] = {
          configured: true,
          maskedKey: p === 'local' ? clean : masked,
          source: (this.getProviderCredentials(false)[p] ? 'database' : 'environment')
        };
      } else {
        status[p] = {
          configured: false,
          maskedKey: null,
          source: null
        };
      }
    }
    return status;
  }

  // --- Agent Runs & Sequenced Events Persistence ---
  createAgentRun({ id, sessionId, model, provider, prompt, metadata = {} }) {
    const now = Date.now();
    const checkStmt = this.db.prepare(`SELECT id FROM sessions WHERE id = ?`);
    if (!checkStmt.get(sessionId)) {
      this.createSession(sessionId, prompt ? prompt.slice(0, 30) : 'Conversation', model || 'gemini-2.0-flash');
    }
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO agent_runs (id, session_id, model, provider, status, prompt, created_at, updated_at, metadata)
      VALUES (?, ?, ?, ?, 'RUNNING', ?, ?, ?, ?)
    `);
    stmt.run(id, sessionId, model, provider, prompt, now, now, JSON.stringify(metadata));
    return { id, sessionId, model, provider, status: 'RUNNING', prompt, createdAt: now };
  }

  updateAgentRun(id, updates = {}) {
    const now = Date.now();
    const fields = [];
    const values = [];

    if (updates.status) { fields.push('status = ?'); values.push(updates.status); }
    if (updates.completedAt) { fields.push('completed_at = ?'); values.push(updates.completedAt); }
    if (updates.durationMs) { fields.push('duration_ms = ?'); values.push(updates.durationMs); }
    if (updates.error) { fields.push('error = ?'); values.push(updates.error); }
    if (updates.metadata) { fields.push('metadata = ?'); values.push(JSON.stringify(updates.metadata)); }

    fields.push('updated_at = ?');
    values.push(now);
    values.push(id);

    const stmt = this.db.prepare(`UPDATE agent_runs SET ${fields.join(', ')} WHERE id = ?`);
    stmt.run(...values);
  }

  recordAgentEvent({ runId, seq, type, payload }) {
    const id = `ev_${Date.now()}_${seq}_${Math.random().toString(36).slice(2, 6)}`;
    const now = Date.now();
    const stmt = this.db.prepare(`
      INSERT INTO agent_events (id, run_id, seq, type, payload, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(id, runId, seq, type, typeof payload === 'string' ? payload : JSON.stringify(payload), now);
    return { id, runId, seq, type, createdAt: now };
  }

  getAgentEventsSince(runId, sinceSeq = 0) {
    const stmt = this.db.prepare(`
      SELECT seq, type, payload, created_at FROM agent_events
      WHERE run_id = ? AND seq > ?
      ORDER BY seq ASC
    `);
    return stmt.all(runId, sinceSeq).map(row => {
      let parsed = row.payload;
      try { parsed = JSON.parse(row.payload); } catch {}
      return {
        seq: row.seq,
        type: row.type,
        payload: parsed,
        createdAt: row.created_at
      };
    });
  }

  // --- Provider Health & Usage ---
  recordProviderHealth(provider, { state, latencyMs, error = null, details = {} }) {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO provider_health (provider, state, latency_ms, last_checked, last_error, details)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(provider, state, latencyMs || 0, Date.now(), error, JSON.stringify(details));
  }

  getProviderHealth() {
    const stmt = this.db.prepare(`SELECT * FROM provider_health`);
    const rows = stmt.all();
    const map = {};
    for (const r of rows) {
      map[r.provider] = {
        state: r.state,
        latencyMs: r.latency_ms,
        lastChecked: r.last_checked,
        lastError: r.last_error,
        details: r.details ? JSON.parse(r.details) : {}
      };
    }
    return map;
  }

  recordProviderUsage({ provider, model, promptTokens = 0, completionTokens = 0, reasoningTokens = 0, durationMs = 0 }) {
    const id = `use_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const stmt = this.db.prepare(`
      INSERT INTO provider_usage (id, provider, model, prompt_tokens, completion_tokens, reasoning_tokens, duration_ms, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(id, provider, model, promptTokens, completionTokens, reasoningTokens, durationMs, Date.now());
  }

  // --- Health Check ---
  healthCheck() {
    try {
      const stmt = this.db.prepare(`SELECT 1 AS alive`);
      const res = stmt.get();
      return res && res.alive === 1;
    } catch {
      return false;
    }
  }

  close() {
    try {
      this.db.close();
    } catch {}
  }
}
