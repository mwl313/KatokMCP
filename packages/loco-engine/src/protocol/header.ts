/**
 * LOCO 22-byte packet header encode/decode
 * 
 * Spec (Little Endian):
 *   Offset  Size  Type    Field
 *   0x00    4     u32 LE  packet_id
 *   0x04    2     i16 LE  status_code  (0 for requests)
 *   0x06    11    ASCII   method       null-padded
 *   0x11    1     u8      body_type    (usually 0)
 *   0x12    4     u32 LE  body_size
 *   ------
 *   22 bytes total
 */

export const LOCO_HEADER_SIZE = 22;
export const LOCO_METHOD_SIZE = 11;

export interface DecodedPacket {
  packetId: number;
  statusCode: number;
  method: string;
  bodyType: number;
  bodySize: number;
  body: Buffer;
}

function assertUnsignedInteger(value: number, maximum: number, name: string): void {
  if (!Number.isInteger(value) || value < 0 || value > maximum) {
    throw new RangeError(`${name} must be an integer between 0 and ${maximum}`);
  }
}

function encodeMethod(method: string): Buffer {
  if (method.includes("\0") || !/^[\x20-\x7e]*$/.test(method)) {
    throw new TypeError("method must contain printable ASCII characters only");
  }
  const encoded = Buffer.from(method, "ascii");
  if (encoded.length > LOCO_METHOD_SIZE) {
    throw new RangeError(`method must be at most ${LOCO_METHOD_SIZE} bytes`);
  }
  const field = Buffer.alloc(LOCO_METHOD_SIZE);
  encoded.copy(field);
  return field;
}

/** Encode a complete LOCO packet (header + body) */
export function encodeHeader(
  packetId: number,
  method: string,
  bodyType: number,
  body: Buffer,
): Buffer {
  assertUnsignedInteger(packetId, 0xffff_ffff, "packetId");
  assertUnsignedInteger(bodyType, 0xff, "bodyType");
  if (!Buffer.isBuffer(body)) {
    throw new TypeError("body must be a Buffer");
  }

  const packet = Buffer.allocUnsafe(LOCO_HEADER_SIZE + body.length);
  packet.writeUInt32LE(packetId, 0);
  packet.writeInt16LE(0, 4); // status_code = 0 for requests
  encodeMethod(method).copy(packet, 6);
  packet.writeUInt8(bodyType, 17);
  packet.writeUInt32LE(body.length, 18);
  body.copy(packet, LOCO_HEADER_SIZE);
  return packet;
}

/** Decode a complete LOCO packet (header + body) */
export function decodeHeader(buffer: Buffer): DecodedPacket {
  if (!Buffer.isBuffer(buffer)) {
    throw new TypeError("buffer must be a Buffer");
  }
  if (buffer.length < LOCO_HEADER_SIZE) {
    throw new RangeError(`packet must contain at least ${LOCO_HEADER_SIZE} bytes`);
  }

  const bodySize = buffer.readUInt32LE(18);
  const packetSize = LOCO_HEADER_SIZE + bodySize;
  if (buffer.length < packetSize) {
    throw new RangeError(`packet body is incomplete: expected ${bodySize} bytes`);
  }

  const methodField = buffer.subarray(6, 17);
  const nullOffset = methodField.indexOf(0);
  const methodEnd = nullOffset === -1 ? methodField.length : nullOffset;

  return {
    packetId: buffer.readUInt32LE(0),
    statusCode: buffer.readInt16LE(4),
    method: methodField.subarray(0, methodEnd).toString("ascii"),
    bodyType: buffer.readUInt8(17),
    bodySize,
    body: buffer.subarray(LOCO_HEADER_SIZE, packetSize),
  };
}