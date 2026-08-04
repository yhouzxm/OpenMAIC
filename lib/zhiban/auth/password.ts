import { hash, verify } from '@node-rs/argon2';

const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$DB3JvKteVmtPNRyoevMSjg$cAoQU6e62qrJ6V/wQig8g6+nNfigMxtuh8yyJQwVuz4';

const ARGON2_OPTIONS = {
  algorithm: 2,
  version: 1,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
} as const;

export function validateLocalPassword(password: string): void {
  if (password.length < 12 || password.length > 128) {
    throw new Error('Password must contain between 12 and 128 characters');
  }
  if (!/\p{L}/u.test(password) || !/\p{N}/u.test(password)) {
    throw new Error('Password must contain at least one letter and one number');
  }
}

export async function hashLocalPassword(password: string): Promise<string> {
  validateLocalPassword(password);
  return hash(password, ARGON2_OPTIONS);
}

export async function verifyLocalPassword(
  encodedHash: string | null | undefined,
  password: string,
): Promise<boolean> {
  try {
    return await verify(encodedHash ?? DUMMY_PASSWORD_HASH, password);
  } catch {
    return false;
  }
}
