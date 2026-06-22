/**
 * Auth module shared types for Kakao Account authentication and LOCO session.
 */

export interface AuthCredentials {
  email: string;
  password: string;
  deviceUuid: string;
  deviceName?: string;
}

export interface AuthResult {
  userId: bigint;
  accessToken: string;
  refreshToken: string;
  tokenType: string;
}

export interface AndroidAuthCredentials {
  email: string;
  password: string;
  deviceUuid: string;
  deviceName?: string;
}

export interface LocoServerInfo {
  host: string;
  port: number;
  csport: number;
}

export interface LocoSession {
  userId: bigint;
  auth: AuthResult;
  sessionKey: Buffer;
  locoServer: LocoServerInfo;
}

export class AuthApiError extends Error {
  constructor(readonly status: number) {
    super(`Kakao authentication failed with API status ${status}`);
    this.name = "AuthApiError";
  }
}