/**
 * D-5: Safety Layer — Rate Limiter + Audit Log
 * 
 * Safety features for KakaoTalk MCP server:
 * - Rate Limiter: Prevents excessive requests (token bucket)
 * - Audit Log: Records all tool calls and message access
 * - Message Prefixer: Adds 🤖 prefix to AI-sent messages (v0.2)
 */

import { appendFile, mkdir } from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

// ─── Rate Limiter ─────────────────────────────────────────────────────────

export class RateLimiter {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private readonly maxTokens: number,
    private readonly refillPerSecond: number,
  ) {
    this.tokens = maxTokens;
    this.lastRefill = Date.now();
  }

  /** Refill tokens based on elapsed time */
  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillPerSecond);
    this.lastRefill = now;
  }

  /**
   * Try to consume tokens. Returns remaining tokens.
   * Throws if rate limit exceeded.
   */
  consume(count = 1): number {
    this.refill();
    if (this.tokens < count) {
      throw new RateLimitError(
        `Rate limit exceeded. Try again in ${Math.ceil((count - this.tokens) / this.refillPerSecond)}s.`
      );
    }
    this.tokens -= count;
    return this.tokens;
  }

  /** Check if a request would be allowed without consuming */
  wouldExceed(count = 1): boolean {
    this.refill();
    return this.tokens < count;
  }
}

export class RateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RateLimitError";
  }
}

// ─── Audit Log ────────────────────────────────────────────────────────────

export interface AuditEntry {
  timestamp: string;
  tool: string;
  userId?: string;
  chatId?: string;
  params: Record<string, unknown>;
  result: "success" | "error";
  errorMessage?: string;
  durationMs: number;
}

export class AuditLogger {
  private logPath: string;
  private mode: "development" | "production";

  constructor(basePath?: string, mode?: string) {
    this.mode = (mode ?? process.env.KAKAO_ENV ?? "production") === "development" ? "development" : "production";
    const dir = basePath ?? path.join(os.homedir(), ".kakao-mcp", "audit");
    this.logPath = path.join(dir, this.mode === "development" ? "audit-dev.log" : "audit-prod.log");
  }

  /** Record a tool call in the audit log */
  async record(entry: AuditEntry): Promise<void> {
    try {
      await mkdir(path.dirname(this.logPath), { recursive: true });

      if (this.mode === "development") {
        // Dev mode: full detail
        const line = JSON.stringify(entry) + "\n";
        await appendFile(this.logPath, line);
      } else {
        // Prod mode: hash-only for message content
        const safeEntry = {
          ...entry,
          params: this.hashParams(entry.params),
        };
        const line = JSON.stringify(safeEntry) + "\n";
        await appendFile(this.logPath, line);
      }
    } catch {
      // Audit log failure should not crash the server
      console.error("Audit log write failed");
    }
  }

  /** Hash sensitive parameters in production mode */
  private hashParams(params: Record<string, unknown>): Record<string, unknown> {
    const hashed: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(params)) {
      if (key === "message" || key === "text" || key === "content" || key === "password" || key === "token") {
        hashed[key] = `hash:${this.simpleHash(String(value))}`;
      } else {
        hashed[key] = value;
      }
    }
    return hashed;
  }

  private simpleHash(value: string): string {
    let hash = 0;
    for (let i = 0; i < value.length; i++) {
      const char = value.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash |= 0;
    }
    return Math.abs(hash).toString(16).slice(0, 8);
  }
}

// ─── Singleton Instances ──────────────────────────────────────────────────

/** Global rate limiter: 30 requests per 10 seconds (3/sec) */
export const globalRateLimiter = new RateLimiter(30, 3);

/** Global audit logger */
export const auditLogger = new AuditLogger();