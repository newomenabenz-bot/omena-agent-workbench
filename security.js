/**
 * OMENA Enterprise Security & Guardrails Engine
 * - Constant-time password validation & HttpOnly session tokens
 * - Command execution boundaries & destructive command prevention
 * - SSRF protection for browser automation (blocks private IPs, loopback, metadata services)
 */

import crypto from 'crypto';
import { URL } from 'url';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'omena2026';

// Dangerous command patterns that must be blocked
const BLOCKED_COMMAND_PATTERNS = [
  /\brm\s+-(?:r[fF]|fr)\s+[\/\\]/i,
  /\brm\s+-(?:r[fF]|fr)\s+\*\b/i,
  /\brmdir\s+\/[sS]\s+\/[qQ]\s+[a-zA-Z]:\\/i,
  /\bdel\s+\/[fF]\s+\/[sS]\s+\/[qQ]\s+[a-zA-Z]:\\/i,
  /\bformat\s+[a-zA-Z]:/i,
  /\bdiskpart\b/i,
  /\bmkfs\b/i,
  /\bdd\s+if=/i,
  /\bshutdown\s+[\/\-][sr]/i,
  /\breboot\b/i,
  /\b:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/, // Fork bomb
  /\bdrop\s+database\b/i
];

export class SecurityGuard {
  /**
   * Constant-time password verification via SHA-256 digest comparison
   */
  static verifyPassword(providedPassword) {
    if (typeof providedPassword !== 'string') return false;
    const hashProvided = crypto.createHash('sha256').update(providedPassword).digest();
    const hashExpected = crypto.createHash('sha256').update(ADMIN_PASSWORD).digest();
    return crypto.timingSafeEqual(hashProvided, hashExpected);
  }

  /**
   * Generate cryptographically secure random session token
   */
  static generateSessionToken() {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Parse Cookie header into object
   */
  static parseCookies(cookieHeader = '') {
    const list = {};
    if (!cookieHeader) return list;
    cookieHeader.split(';').forEach(cookie => {
      const parts = cookie.split('=');
      const name = parts.shift().trim();
      const val = decodeURIComponent(parts.join('=')).trim();
      if (name) list[name] = val;
    });
    return list;
  }

  /**
   * Command safety guardrail
   */
  static validateCommand(command) {
    if (!command || typeof command !== 'string') {
      return { allowed: false, reason: 'Empty command' };
    }

    const trimmed = command.trim();
    for (const pattern of BLOCKED_COMMAND_PATTERNS) {
      if (pattern.test(trimmed)) {
        return {
          allowed: false,
          reason: `Dangerous operation detected matching restricted pattern [${pattern.toString()}]. Execution denied by Security Guardrail.`
        };
      }
    }

    return { allowed: true };
  }

  /**
   * SSRF Protection: Validate target URL to prevent loopback/internal subnet traversal
   */
  static validateUrlForSSRF(rawUrl) {
    let parsed;
    try {
      parsed = new URL(rawUrl);
    } catch {
      throw new Error(`Invalid URL format: "${rawUrl}"`);
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`Invalid protocol "${parsed.protocol}". Only HTTP and HTTPS are permitted.`);
    }

    const hostname = parsed.hostname.toLowerCase();

    // Loopback names
    if (
      hostname === 'localhost' ||
      hostname.endsWith('.localhost') ||
      hostname.endsWith('.local') ||
      hostname.endsWith('.internal') ||
      hostname.endsWith('.lan') ||
      hostname === 'host.docker.internal' ||
      hostname === 'metadata.google.internal'
    ) {
      throw new Error(`SSRF Guardrail: Access to internal host "${hostname}" is prohibited.`);
    }

    // IP address checks
    if (this.isPrivateOrLoopbackIp(hostname)) {
      throw new Error(`SSRF Guardrail: Access to private/loopback IP "${hostname}" is prohibited.`);
    }

    return parsed.toString();
  }

  /**
   * Check if an IP address falls into private, loopback, or cloud metadata ranges
   */
  static isPrivateOrLoopbackIp(ip) {
    // IPv6 loopback
    if (ip === '::1' || ip === '0:0:0:0:0:0:0:1' || ip === '::') return true;

    // IPv4 check
    const ipv4Match = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (!ipv4Match) return false;

    const [_, o1, o2, o3, o4] = ipv4Match.map(Number);
    if ([o1, o2, o3, o4].some(n => n < 0 || n > 255)) return true;

    // Loopback (127.0.0.0/8, 0.0.0.0/8)
    if (o1 === 127 || o1 === 0) return true;

    // RFC 1918 Private ranges:
    // 10.0.0.0 - 10.255.255.255 (10/8)
    if (o1 === 10) return true;

    // 172.16.0.0 - 172.31.255.255 (172.16/12)
    if (o1 === 172 && o2 >= 16 && o2 <= 31) return true;

    // 192.168.0.0 - 192.168.255.255 (192.168/16)
    if (o1 === 192 && o2 === 168) return true;

    // Link-local & Cloud Metadata (169.254.0.0/16, including 169.254.169.254)
    if (o1 === 169 && o2 === 254) return true;

    // Carrier-grade NAT (100.64.0.0/10)
    if (o1 === 100 && o2 >= 64 && o2 <= 127) return true;

    // Broadcast
    if (o1 === 255 && o2 === 255 && o3 === 255 && o4 === 255) return true;

    return false;
  }
}
