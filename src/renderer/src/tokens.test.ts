import { describe, expect, it } from 'vitest';
import css from './main.css?raw';

const COLOR_LITERAL = /#[0-9a-f]{3,8}\b|\brgba?\(/gi;

describe('디자인 토큰', () => {
  it('색 값은 :root 토큰 블록에만 있다', () => {
    const rootEnd = css.indexOf('}', css.indexOf(':root'));
    expect(css.slice(rootEnd).match(COLOR_LITERAL)).toBeNull();
  });

  it('외부 글꼴과 원격 자산을 쓰지 않는다', () => {
    expect(css).not.toMatch(/@import|@font-face|https?:/);
  });
});
