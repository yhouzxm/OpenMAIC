import { describe, expect, it } from 'vitest';
import {
  referenceSourceHash,
  referenceSourceEntries,
} from '../../../scripts/zhiban-local/reference-source';
const file =
  'lib/zhiban/infrastructure/teaching/postgres/migrations/0001_teacher_relationships.sql';
const pin = 'a'.repeat(64);
describe('LOCAL reference relocation retains source identity', () => {
  it('accepts one canonical relative or historical absolute key without changing the pin', () => {
    expect(referenceSourceHash({ [file]: pin }, file)).toBe(pin);
    expect(referenceSourceHash({ ['/prior/checkout/' + file]: pin }, file)).toBe(pin);
  });
  it('rejects ambiguity, missing identity, traversal and malformed hashes', () => {
    expect(() => referenceSourceHash({ [file]: pin, ['/prior/' + file]: pin }, file)).toThrow(
      /ambiguous/,
    );
    expect(() => referenceSourceHash({ '/other/file': pin }, file)).toThrow(/missing/);
    expect(() => referenceSourceHash({ ['/prior/../checkout/' + file]: pin }, file)).toThrow();
    expect(() => referenceSourceHash({ [file]: 'bad' }, file)).toThrow();
  });
});

it('resolves all dependencies under one reference checkout, never reads historical paths', () => {
  expect(
    referenceSourceEntries({ ['/prior/' + file]: pin, '/prior/docs/receipt.sql': pin }, file),
  ).toEqual([
    [file, pin],
    ['docs/receipt.sql', pin],
  ]);
  expect(() =>
    referenceSourceEntries({ ['/prior/' + file]: pin, '/another/docs/receipt.sql': pin }, file),
  ).toThrow(/checkout/);
  expect(() =>
    referenceSourceEntries({ ['/prior/' + file]: pin, '/prior/../outside': pin }, file),
  ).toThrow(/name/);
});
