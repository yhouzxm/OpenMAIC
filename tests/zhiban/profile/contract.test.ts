import { describe, it, expect } from 'vitest';
import { profileCommand } from '../../../lib/zhiban/domain/profile/model';
const own = {
  type: 'SAVE_PROFILE',
  revision: null,
  displayName: '陈同学',
  email: '',
  qq: '',
  wechat: '',
  bio: '',
};
const directory = {
  type: 'SAVE_DIRECTORY',
  revision: null,
  membershipId: '01a14eb4-cda5-7789-8bef-8697ba437208',
  formalName: '陈同学',
  studentNo: 'ST-001',
  employeeNo: '',
};
describe('P3 strict business profile contract', () => {
  it('normalizes display and supports optional private contacts and multiline biography', () => {
    expect(profileCommand({ ...own, displayName: ' 陈同学 ', bio: '第一行\n第二行' })).toEqual({
      ...own,
      bio: '第一行\n第二行',
    });
    expect(profileCommand(directory)).toEqual(directory);
  });
  it.each(['userId', 'membershipId', 'formalName', 'status', 'roles', 'password'])(
    'rejects injected own-profile field %s',
    (k) => {
      expect(() => profileCommand({ ...own, [k]: 'forged' })).toThrow();
    },
  );
  it('rejects malformed values and missing revision', () => {
    for (const patch of [
      { displayName: '' },
      { displayName: 'x'.repeat(121) },
      { email: 'bad' },
      { bio: '\ud800' },
      { qq: 'x\u0000y' },
      { revision: '0' },
      { revision: 1 },
    ])
      expect(() => profileCommand({ ...own, ...patch })).toThrow();
    const { revision: _, ...missing } = own;
    expect(() => profileCommand(missing)).toThrow();
  });
  it('requires membership UUIDv7 and bounded noncredential business identifiers', () => {
    for (const patch of [
      { membershipId: 'no' },
      { studentNo: '学号01' },
      { employeeNo: '../x' },
      { studentNo: 'a'.repeat(65) },
      { formalName: '' },
    ])
      expect(() => profileCommand({ ...directory, ...patch })).toThrow();
    expect(() => profileCommand({ ...directory, status: 'DISABLED' })).toThrow();
  });
});
