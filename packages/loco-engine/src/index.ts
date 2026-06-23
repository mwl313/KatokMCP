/**
 * @katok-mcp/loco-engine — LOCO Protocol Client Engine
 * 
 * Entry point exporting all public modules.
 */

// Protocol Layer
export {
  encodeHeader,
  decodeHeader,
  LOCO_HEADER_SIZE,
  LOCO_METHOD_SIZE,
} from "./protocol/header.js";
export type { DecodedPacket } from "./protocol/header.js";

// Crypto Layer
export {
  encryptLocoFrame,
  decryptLocoFrame,
  SESSION_KEY_SIZE,
  SECURE_FRAME_IV_SIZE,
  SECURE_FRAME_HEADER_SIZE,
  MAX_SECURE_PLAINTEXT_SIZE,
} from "./crypto/aes.js";
export {
  createHandshake,
  RSA_ENCRYPTED_KEY_SIZE,
  HANDSHAKE_SIZE,
  KEY_ENCRYPT_TYPE,
  ENCRYPT_TYPE,
} from "./crypto/handshake.js";

// Transport Layer
export {
  connectSocket,
  readSecureFrame,
  sendAndReceive,
  DEFAULT_TIMEOUT_MS,
  MAX_FRAME_SIZE,
} from "./transport/socket.js";
export type { SocketConfig } from "./transport/socket.js";

// Auth Module (B-4)
export {
  authenticateWindows,
  buildUserAgent,
  computeXvc,
  parseLoginResponse,
  readWindowsCredentialsFromEnvironment,
} from "./auth/windows.js";
export type { AuthOptions } from "./auth/windows.js";
export {
  authenticateAndroid,
  loginAndroid,
  isAndroidDeviceAllowed,
  generateAndroidPasscode,
  waitForAndroidRegistration,
  computeAndroidXvc,
  readAndroidCredentialsFromEnvironment,
  refreshAccessToken,
} from "./auth/android.js";
export type { AndroidAuthOptions, AndroidPasscodeChallenge, RefreshResult } from "./auth/android.js";
export {
  AuthApiError,
} from "./auth/types.js";
export {
  AndroidAuthApiError,
} from "./auth/android.js";
export type {
  AuthCredentials,
  AuthResult,
  AndroidAuthCredentials,
  LocoServerInfo,
  LocoSession,
} from "./auth/types.js";

// Session (B-4) — LocoClient with persistent connection
export {
  checkin,
  LocoClient,
} from "./session.js";
export type { SessionConfig } from "./session.js";

// Persistent Connection
export {
  LocoConnection,
} from "./connection.js";

// Command Modules (B-5 + B-6 + C-1 + C-2 + C-3)
export {
  sendLchatListOn,
  sendSyncMsgOn,
  sendWrite,
  sendDeleteMsg,
  sendGetMem,
  sendMember,
  sendPing,
  getChatId,
  getMessageText,
} from "./commands.js";
export type {
  LchatListRequest,
  SyncMsgRequest,
  WriteRequest,
  DeleteMsgRequest,
} from "./commands.js";

// Error Handling + Retry (B-7)
export {
  LocoError,
  classifyError,
  isLocoError,
  withRetry,
  SessionManager,
  detectChangesvr,
  isKickout,
  calculateDelay,
  sleep,
  DEFAULT_RETRY_CONFIG,
} from "./error.js";
export type { LocoErrorCode, RetryConfig, SessionManagerConfig } from "./error.js";
