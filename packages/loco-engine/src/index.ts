/**
 * @kakao-mcp/loco-engine — LOCO Protocol Client Engine
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