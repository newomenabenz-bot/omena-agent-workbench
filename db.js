/**
 * OMENA Production Embedded SQLite Database Engine
 * Zero-dependency native SQLite via Node.js built-in `node:sqlite` (DatabaseSync).
 * Supports WAL mode, atomic transactions, session history, and auth tokens.
 */

import { DatabaseSync } from 'node:sqlite';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WORKSPACE_ROOT = path.resolve(__dirname, '..', '..');
const STORAGE_DIR = path.join(WORKSPACE_ROOT, 'storage');
const DB_PATH = process.env.DATABASE_PATH || path.join(STORAGE_DIR, 'workbench.db');

export class WorkbenchDatabase {
  constructor(dbPath = DB_PATH) {
    if (!fs.existsSync(path.dirname(dbPath))) {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    }
    
    this.db = new DatabaseSync(dbPath);
    this.init();
  }

  init() {
    // Enable WAL mode for high concurrency
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA foreign_keys = ON;

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

    this.migrateFromJson();
  }

  migrateFromJson() {
    try {
      const jsonFile = path.join(STORAGE_DIR, 'workbench_sessions.json');
      if (!fs.existsSync(jsonFile)) return;

      const count = this.db.prepare('SELECT count(*) as cnt FROM sessions').get();
      if (count && count.cnt > 0) return; // already populated

      const content = fs.readFileSync(jsonFile, 'utf8');
      const sessions = JSON.parse(content || '[]');
      for (const s of sessions) {
        if (!s.id) continue;
        const now = s.updatedAt ? new Date(s.updatedAt).getTime() : Date.now();
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

  pruneExpiredAuth() {
    const stmt = this.db.prepare(`DELETE FROM auth_sessions WHERE expires_at <= ?`);
    stmt.run(Date.now());
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

  updateSessionTitle(id, title) {
    const stmt = this.db.prepare(`UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?`);
    stmt.run(title, Date.now(), id);
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

    // Ensure session exists to satisfy foreign key constraint
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

    // Update session timestamp
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

  // --- Provider Credentials & Status Methods ---
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

    this.setSetting('provider_credentials', merged);
    return merged;
  }

  getProviderCredentials(includeEnv = true) {
    const stored = this.getSetting('provider_credentials', null);
    let creds = {};
    if (stored) {
      try {
        creds = typeof stored === 'string' ? JSON.parse(stored) : stored;
      } catch {
        creds = {};
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
    } catch (e) {
      // Ignored on teardown
    }
  }
}
