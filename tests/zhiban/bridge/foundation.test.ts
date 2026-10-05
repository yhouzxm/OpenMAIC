import { describe, expect, it } from 'vitest';
import {
  BridgeError,
  counter,
  digest,
  newPrincipal,
  principal,
  revision,
  successor,
} from '@/lib/zhiban/infrastructure/openmaic/validation';
import { boundedJson, validateBytes } from '@/lib/zhiban/infrastructure/openmaic/content';
import { admittedOperation, Deadline } from '@/lib/zhiban/infrastructure/openmaic/transactions';
import {
  deliverAsset,
  gatewayHeaders,
  singleRange,
} from '@/lib/zhiban/infrastructure/openmaic/gateway';

describe('Bridge foundation security boundaries', () => {
  it('preserves signed int8 revisions without Number coercion', () => {
    expect(successor('9007199254740993')).toBe('9007199254740994');
    expect(revision('9223372036854775807')).toBe('9223372036854775807');
    expect(() => successor('9223372036854775807')).toThrow(BridgeError);
  });
  it.each(['0', '01', '-1', '1e3', '9223372036854775808'])(
    'rejects malformed revision case %s',
    (value) => {
      expect(() => revision(value)).toThrow(BridgeError);
    },
  );
  it('validates authorizationVersion separately from epoch and timestamp', () => {
    expect(counter('9007199254740991')).toBe(Number.MAX_SAFE_INTEGER);
    expect(() => counter('9007199254740992')).toThrow(BridgeError);
  });
  it('creates independent canonical 256-bit principals', () => {
    const first = newPrincipal(),
      second = newPrincipal();
    expect(Buffer.from(principal(first), 'base64url')).toHaveLength(32);
    expect(first).not.toBe(second);
    expect(() => principal(`${first}=`)).toThrow(BridgeError);
  });
  it('never preserves an input or provider cause in its error', () => {
    const error = new BridgeError();
    expect(Object.keys(error)).toEqual(['name']);
    expect(error.message).toBe('Bridge request rejected');
    expect('cause' in error).toBe(false);
    expect(() => digest('invalid')).toThrow(BridgeError);
  });
  it('rejects getters without invoking them', () => {
    let reads = 0;
    const input = Object.defineProperty({}, 'content', {
      enumerable: true,
      get() {
        reads++;
        return 'untrusted';
      },
    });
    expect(() => boundedJson(input)).toThrow(BridgeError);
    expect(reads).toBe(0);
  });
  it('rejects cycles and oversized content before encoding', () => {
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    expect(() => boundedJson(cycle)).toThrow(BridgeError);
    expect(() => boundedJson('x'.repeat(4194305))).toThrow(BridgeError);
  });
  it('does not accept content solely from its MIME label', () => {
    expect(() => validateBytes('image/png', new Uint8Array(24))).toThrow(BridgeError);
    expect(() => validateBytes('text/html', new Uint8Array([1]))).toThrow(BridgeError);
  });
  it('bounds admission to two and releases rejected work', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = admittedOperation(async () => gate);
    const second = admittedOperation(async () => gate);
    await expect(admittedOperation(async () => undefined)).rejects.toThrow(BridgeError);
    release();
    await Promise.all([first, second]);
    await expect(
      admittedOperation(async () => {
        throw new Error('private provider detail');
      }),
    ).rejects.toThrow('Bridge request rejected');
    await expect(admittedOperation(async () => 'available')).resolves.toBe('available');
  });
  it('uses one bounded range without multiple-range fallback', () => {
    expect(singleRange('bytes=-2', 5)).toEqual([3, 4]);
    expect(singleRange('bytes=1-99', 5)).toEqual([1, 4]);
    expect(() => singleRange('bytes=0-1,3-4', 5)).toThrow(BridgeError);
    expect(() => singleRange('bytes=-0', 5)).toThrow(BridgeError);
  });
  it('authorizes before HEAD lookup and range processing', async () => {
    const events: string[] = [];
    const headers = await deliverAsset(
      'HEAD',
      null,
      async () => {
        events.push('load');
        return { bytes: new Uint8Array(3), mime: 'image/png' };
      },
      async () => {
        events.push('auth');
      },
      async () => {
        events.push('write');
      },
      new Deadline(),
    );
    expect(events).toEqual(['auth', 'load', 'auth']);
    expect(headers['Content-Length']).toBe('3');
    expect(headers['Cache-Control']).toBe(gatewayHeaders['Cache-Control']);
  });
  it('rechecks each chunk and stops emission when authorization changes', async () => {
    let checks = 0;
    const chunks: number[] = [];
    await expect(
      deliverAsset(
        'GET',
        null,
        async () => ({ bytes: new Uint8Array(65537), mime: 'image/png' }),
        async () => {
          if (++checks === 4) throw new Error('revoked');
        },
        async (chunk) => {
          chunks.push(chunk.length);
        },
        new Deadline(),
      ),
    ).rejects.toThrow(BridgeError);
    expect(chunks).toEqual([65536]);
  });
});
