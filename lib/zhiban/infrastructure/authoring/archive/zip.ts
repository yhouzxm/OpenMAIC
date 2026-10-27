/** Bounded ZIP reader: validate directory before inflating; never extract paths to disk. */
import { createInflateRaw } from 'node:zlib';
import { requireContent } from '../../content/model';
export const ARCHIVE_LIMITS = {
  compressed: 64 * 1024 * 1024,
  expanded: 128 * 1024 * 1024,
  entry: 32 * 1024 * 1024,
  entries: 512,
};
const crcTable = Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i++) n = (n >>> 1) ^ (n & 1 ? 0xedb88320 : 0);
  return n >>> 0;
});
export function crc32(bytes: Uint8Array) {
  let n = 0xffffffff;
  for (const b of bytes) n = (n >>> 8) ^ crcTable[(n ^ b) & 255];
  return (n ^ 0xffffffff) >>> 0;
}
export function zipPath(name: string) {
  return (
    name.length <= 240 &&
    !name.startsWith('/') &&
    !name.includes('\\') &&
    !name.includes('\0') &&
    !name.split('/').some((s) => s === '.' || s === '..' || s === '') &&
    !/^[A-Za-z]:/.test(name)
  );
}
export async function readBoundedZip(bytes: Buffer) {
  requireContent(
    bytes.length > 22 && bytes.length <= ARCHIVE_LIMITS.compressed,
    'ARCHIVE_TOO_LARGE',
    413,
  );
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--)
    if (
      bytes.readUInt32LE(i) === 0x06054b50 &&
      i + 22 + bytes.readUInt16LE(i + 20) === bytes.length
    ) {
      end = i;
      break;
    }
  requireContent(end >= 0, 'INVALID_ARCHIVE');
  const count = bytes.readUInt16LE(end + 10),
    start = bytes.readUInt32LE(end + 16),
    size = bytes.readUInt32LE(end + 12);
  requireContent(
    bytes.readUInt16LE(end + 4) === 0 &&
      bytes.readUInt16LE(end + 6) === 0 &&
      bytes.readUInt16LE(end + 8) === count &&
      count > 0 &&
      count <= ARCHIVE_LIMITS.entries &&
      start + size === end,
    'INVALID_ARCHIVE',
  );
  const records: {
      name: string;
      offset: number;
      compressed: number;
      expanded: number;
      method: number;
      crc: number;
    }[] = [],
    names = new Set<string>();
  let pos = start,
    total = 0;
  for (let i = 0; i < count; i++) {
    requireContent(pos + 46 <= end && bytes.readUInt32LE(pos) === 0x02014b50, 'INVALID_ARCHIVE');
    const flags = bytes.readUInt16LE(pos + 8),
      method = bytes.readUInt16LE(pos + 10),
      compressed = bytes.readUInt32LE(pos + 20),
      expanded = bytes.readUInt32LE(pos + 24),
      nameLen = bytes.readUInt16LE(pos + 28),
      extra = bytes.readUInt16LE(pos + 30),
      comment = bytes.readUInt16LE(pos + 32),
      offset = bytes.readUInt32LE(pos + 42);
    requireContent(
      pos + 46 + nameLen + extra + comment <= end &&
        !(flags & 1) &&
        [0, 8].includes(method) &&
        bytes.readUInt16LE(pos + 34) === 0 &&
        ((bytes.readUInt32LE(pos + 38) >>> 16) & 0xf000) !== 0xa000,
      'INVALID_ARCHIVE',
    );
    const name = bytes.subarray(pos + 46, pos + 46 + nameLen).toString('utf8');
    pos += 46 + nameLen + extra + comment;
    if (name.endsWith('/')) {
      requireContent(expanded === 0 && zipPath(name.slice(0, -1)), 'INVALID_ARCHIVE');
      continue;
    }
    requireContent(
      zipPath(name) && !names.has(name) && expanded <= ARCHIVE_LIMITS.entry,
      'INVALID_ARCHIVE',
    );
    names.add(name);
    total += expanded;
    requireContent(total <= ARCHIVE_LIMITS.expanded, 'ARCHIVE_TOO_LARGE', 413);
    requireContent(
      offset + 30 <= start &&
        bytes.readUInt32LE(offset) === 0x04034b50 &&
        bytes.readUInt16LE(offset + 8) === method &&
        !(bytes.readUInt16LE(offset + 6) & 1),
      'INVALID_ARCHIVE',
    );
    const localNameLen = bytes.readUInt16LE(offset + 26),
      localExtra = bytes.readUInt16LE(offset + 28),
      data = offset + 30 + localNameLen + localExtra;
    requireContent(
      data + compressed <= start &&
        bytes.subarray(offset + 30, offset + 30 + localNameLen).toString('utf8') === name,
      'INVALID_ARCHIVE',
    );
    records.push({
      name,
      offset: data,
      compressed,
      expanded,
      method,
      crc: bytes.readUInt32LE(pos - (46 + nameLen + extra + comment) + 16),
    });
  }
  requireContent(pos === end, 'INVALID_ARCHIVE');
  const files = new Map<string, Buffer>();
  let actualTotal = 0;
  for (const record of records) {
    const input = bytes.subarray(record.offset, record.offset + record.compressed);
    let output: Buffer;
    if (record.method === 0) output = input;
    else {
      const inflater = createInflateRaw({ chunkSize: 16384 });
      const chunks: Buffer[] = [];
      let length = 0;
      inflater.end(input);
      try {
        for await (const part of inflater) {
          length += part.length;
          requireContent(
            length <= record.expanded && length <= ARCHIVE_LIMITS.entry,
            'ARCHIVE_TOO_LARGE',
            413,
          );
          chunks.push(part);
        }
        output = Buffer.concat(chunks, length);
      } finally {
        inflater.destroy();
      }
    }
    actualTotal += output.length;
    requireContent(
      output.length === record.expanded &&
        actualTotal <= ARCHIVE_LIMITS.expanded &&
        crc32(output) === record.crc,
      'INVALID_ARCHIVE',
    );
    files.set(record.name, output);
  }
  return files;
}
