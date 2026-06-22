/**
 * Error handling and retry utilities for LOCO protocol (B-7).
 * 
 * Features:
 * - Typed error hierarchy (LocoError)
 * - Exponential backoff retry
 * - Reconnection helpers
 * - CHANGESVR (server change) detection
 */

import type { LocoSession, LocoServerInfo } from "./auth/types.js";

// ─── Typed Error Hierarchy ────────────────────────────────────────────────

export type LocoErrorCode =
  | "TIMEOUT"
  | "CONNECTION_REFUSED"
  | "CONNECTION_RESET"
  | "HANDSHAKE_FAILED"
  | "AUTH_FAILED"
  | "SESSION_EXPIRED"
  | "SERVER_ERROR"
  | "CHANGESVR"
  | "UNKNOWN";

export class LocoError extends Error {
  constructor(
    readonly code: LocoErrorCode,
    message: string,
    readonly cause?: Error,
  ) {
    super(message);
    this.name = "LocoError";
  }
}

export function isLocoError(error: unknown): error is LocoError {
  return error instanceof LocoError;
}

export function classifyError(error: unknown): LocoError {
  if (isLocoError(error)) return error;
  const msg = error instanceof Error ? error.message : String(error);
  const lower = msg.toLowerCase();

  if (lower.includes("timed out") || lower.includes("timeout")) {
    return new LocoError("TIMEOUT", msg, error instanceof Error ? error : undefined);
  }
  if (lower.includes("connection refused") || lower.includes("econnrefused")) {
    return new LocoError("CONNECTION_REFUSED", msg, error instanceof Error ? error : undefined);
  }
  if (lower.includes("reset") || lower.includes("econnreset")) {
    return new LocoError("CONNECTION_RESET", msg, error instanceof Error ? error : undefined);
  }
  if (lower.includes("handshake") || lower.includes("rsa") || lower.includes("publicencrypt")) {
    return new LocoError("HANDSHAKE_FAILED", msg, error instanceof Error ? error : undefined);
  }
  if (lower.includes("auth") || lower.includes("login") || lower.includes("token") || lower.includes("-300") || lower.includes("-501")) {
    return new LocoError("AUTH_FAILED", msg, error instanceof Error ? error : undefined);
  }
  if (lower.includes("session") || lower.includes("-950")) {
    return new LocoError("SESSION_EXPIRED", msg, error instanceof Error ? error : undefined);
  }
  if (lower.includes("-500") || lower.includes("-979")) {
    return new LocoError("SERVER_ERROR", msg, error instanceof Error ? error : undefined);
  }
  return new LocoError("UNKNOWN", msg, error instanceof Error ? error : undefined);
}

// ─── Retry Configuration ──────────────────────────────────────────────────

export interface RetryConfig {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitterFactor: number;
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 5,
  baseDelayMs: 1000,
  maxDelayMs: 30_000,
  jitterFactor: 0.2,
};

/** Sleep for a given duration */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Calculate delay with exponential backoff + jitter */
export function calculateDelay(attempt: number, config: RetryConfig = DEFAULT_RETRY_CONFIG): number {
  const exponential = Math.min(config.baseDelayMs * Math.pow(2, attempt), config.maxDelayMs);
  const jitter = exponential * config.jitterFactor * (Math.random() * 2 - 1);
  return Math.max(0, Math.round(exponential + jitter));
}

/** Retry an async operation with exponential backoff */
export async function withRetry<T>(
  operation: (attempt: number) => Promise<T>,
  config: RetryConfig = DEFAULT_RETRY_CONFIG,
  isRetryable: (error: LocoError) => boolean = (err) =>
    err.code === "TIMEOUT" || err.code === "CONNECTION_RESET" || err.code === "CONNECTION_REFUSED" || err.code === "SERVER_ERROR",
): Promise<T> {
  let lastError: LocoError | undefined;

  for (let attempt = 0; attempt < config.maxAttempts; attempt++) {
    try {
      return await operation(attempt);
    } catch (error) {
      const locoError = classifyError(error);

      if (!isRetryable(locoError) || attempt >= config.maxAttempts - 1) {
        throw locoError;
      }

      lastError = locoError;
      const delay = calculateDelay(attempt, config);
      await sleep(delay);
    }
  }

  throw lastError ?? new LocoError("UNKNOWN", "max retry attempts exceeded");
}

// ─── CHANGESVR Detection ──────────────────────────────────────────────────

/**
 * Check if a LOCO server response contains a CHANGESVR instruction.
 * If detected, the client should reconnect to the new server.
 */
export function detectChangesvr(response: unknown): LocoServerInfo | null {
  if (!response || typeof response !== "object") return null;
  const resp = response as Record<string, unknown>;

  if (resp.status === -701 || resp.status === -702) {
    const newHost = String(resp.host ?? resp.newHost ?? "");
    const newPort = Number(resp.port ?? resp.newPort ?? 0);
    if (newHost && newPort > 0) {
      return { host: newHost, port: newPort, csport: Number(resp.csport ?? 0) };
    }
  }
  return null;
}

/**
 * Check if an error is a kickout (duplicate login) error
 */
export function isKickout(response: unknown): boolean {
  if (!response || typeof response !== "object") return false;
  return (response as Record<string, unknown>).status === -950;
}

// ─── Session Manager ───────────────────────────────────────────────────────

export interface SessionManagerConfig {
  establishSession: () => Promise<LocoSession>;
  retryConfig?: RetryConfig;
  onReconnect?: (attempt: number) => void;
}

export class SessionManager {
  private session: LocoSession | null = null;
  private config: SessionManagerConfig;
  private retryConfig: RetryConfig;

  constructor(config: SessionManagerConfig, retryConfig?: RetryConfig) {
    this.config = config;
    this.retryConfig = retryConfig ?? DEFAULT_RETRY_CONFIG;
  }

  get currentSession(): LocoSession | null {
    return this.session;
  }

  /** Ensure session is valid, reconnecting if needed */
  async ensureSession(): Promise<LocoSession> {
    if (this.session) return this.session;
    return await this.reconnect();
  }

  /** Force reconnection with retry */
  async reconnect(): Promise<LocoSession> {
    return await withRetry(
      async (attempt) => {
        this.config.onReconnect?.(attempt);
        this.session = await this.config.establishSession();
        return this.session!;
      },
      this.retryConfig,
    );
  }

  /** Check if we need to reconnect due to CHANGESVR */
  handleChangesvr(newServer: LocoServerInfo): void {
    if (this.session) {
      this.session.locoServer = newServer;
    }
  }

  /** Invalidate current session (e.g. on kickout) */
  invalidate(): void {
    if (this.session) {
      this.session.sessionKey.fill(0);
      this.session = null;
    }
  }

  /** Clean up session key on dispose */
  dispose(): void {
    this.invalidate();
  }
}