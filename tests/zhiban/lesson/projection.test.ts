import { describe, it, expect } from 'vitest';
import { handoutProjection } from '@/lib/zhiban/infrastructure/lesson/projection';
const document = (elements: unknown[]) => ({
  stage: { name: '电路备课' },
  scenes: [{ id: 'native-1', type: 'slide', title: '第一课', content: { canvas: { elements } } }],
});
describe('native generation → reviewed text handout boundary', () => {
  it('has stable bounded IDs and projects sanitized text without executing HTML', () => {
    const d = document([
      { type: 'text', content: '<p>电压 &lt; 5V</p><script>alert(1)</script><p>电流</p>' },
    ]);
    const a = handoutProjection('run-a', d);
    expect(a).toEqual(handoutProjection('run-a', d));
    expect(a.draft.slides[0].elements[0].text).toContain('电压 ＜ 5V');
    expect(a.draft.slides[0].elements[0].text).not.toContain('alert');
    expect(a.draft.slides[0].id[14]).toBe('7');
    expect(a).not.toEqual(handoutProjection('run-b', d));
  });
  it('reports media omissions explicitly; never copies native asset capabilities', () => {
    const a = handoutProjection(
      'run-a',
      document([
        { type: 'image', src: 'asset:private' },
        { type: 'text', content: '说明' },
      ]),
    );
    expect(a.omitted).toEqual(['image']);
    expect(JSON.stringify(a.draft)).not.toContain('asset:');
  });
  it('keeps standalone formulas with fractions, powers and comparison semantics', () => {
    const a = handoutProjection(
      'math',
      document([
        { type: 'text', content: '第一课' },
        { type: 'latex', latex: String.raw`I = \frac{12V}{6\Omega} = 2A` },
        { type: 'latex', latex: String.raw`(x+1)^2 \leq 4` },
        { type: 'latex', latex: String.raw`\sqrt{x}` },
      ]),
    );
    const t = a.draft.slides[0].elements.map((e) => e.text).join('\n');
    expect(t).toContain('(12V) / (6Ω)');
    expect(t).toContain('≤4');
    expect(t).toContain('√(x)');
    expect(a.omitted).not.toContain('latex');
    expect(t.match(/第一课/g)).toHaveLength(1);
  });
  it('retains unsupported syntax literally and never trusts HTML or asset fields', () => {
    const a = handoutProjection(
      'math',
      document([
        {
          type: 'latex',
          latex: String.raw`\begin{matrix}a&b\\c&d\end{matrix}`,
          html: '<img src=x onerror=alert(1)>',
          path: 'asset:private',
        },
        { type: 'latex', latex: '<script>alert(1)</script>' },
      ]),
    );
    const value = JSON.stringify(a.draft);
    expect(value).toContain('[LaTeX 原式]');
    expect(value).toContain('matrix');
    expect(value).not.toContain('<script>');
    expect(value).not.toContain('asset:private');
    expect(value).not.toContain('onerror');
    expect(() =>
      handoutProjection('bad', document([{ type: 'latex', html: 'formula only in HTML' }])),
    ).toThrow('UNSUPPORTED_GENERATED_FORMULA');
  });
  it('refuses interactive or quiz scenes rather than silently dropping them', () => {
    expect(() =>
      handoutProjection('run-a', { stage: { name: 'x' }, scenes: [{ type: 'quiz' }] }),
    ).toThrow('UNSUPPORTED_GENERATED_CONTENT');
  });
  it('refuses over-limit pages and documents', () => {
    expect(() =>
      handoutProjection('run-a', document([{ type: 'text', content: '字'.repeat(17000) }])),
    ).toThrow('GENERATED_PAGE_TOO_LONG');
    expect(() => handoutProjection('run-a', { stage: { name: 'x' }, scenes: [] })).toThrow();
  });
});
