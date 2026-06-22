import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  decryptLocoFrame,
  encryptLocoFrame,
  SECURE_FRAME_HEADER_SIZE,
  SECURE_FRAME_IV_SIZE,
} from "./aes.js";

const sessionKey = randomBytes(16);

for (const size of [0, 1, 15, 16, 17, 257, 65_537]) {
  const plaintext = randomBytes(size);
  const frame = encryptLocoFrame(plaintext, sessionKey);
  assert.equal(frame.length, SECURE_FRAME_HEADER_SIZE + plaintext.length);
  assert.equal(frame.readUInt32LE(0), SECURE_FRAME_IV_SIZE + plaintext.length);
  assert.deepEqual(decryptLocoFrame(frame, sessionKey), plaintext);
}

const plaintext = randomBytes(64);
const frame = encryptLocoFrame(plaintext, sessionKey, Buffer.alloc(SECURE_FRAME_IV_SIZE, 0x5a));
const tamperedFrame = Buffer.from(frame);
tamperedFrame[SECURE_FRAME_HEADER_SIZE + 7] ^= 0x80;
const tamperedPlaintext = decryptLocoFrame(tamperedFrame, sessionKey);
assert.notDeepEqual(tamperedPlaintext, plaintext);
assert.equal(tamperedPlaintext.length, plaintext.length);

assert.throws(() => encryptLocoFrame(Buffer.alloc(0), Buffer.alloc(15)), /sessionKey/);
assert.throws(() => encryptLocoFrame(Buffer.alloc(0), sessionKey, Buffer.alloc(15)), /iv/);
assert.throws(() => decryptLocoFrame(frame.subarray(0, frame.length - 1), sessionKey), /length mismatch/);

sessionKey.fill(0);
console.log("AES-128-CFB frame roundtrip: OK (7 boundary sizes)");
console.log("Malformed frame rejection: OK");
console.log("Tamper behavior: unauthenticated change confirmed");
