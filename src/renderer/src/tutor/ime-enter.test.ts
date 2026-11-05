import { describe, expect, it } from 'vitest';
import { ImeEnterGuard, type EnterKey } from './ime-enter';

const enter = (overrides: Partial<EnterKey> = {}): EnterKey => ({ key: 'Enter', shiftKey: false, isComposing: false, keyCode: 13, ...overrides });
const composingEnter = enter({ isComposing: true, keyCode: 229 });

describe('ImeEnterGuard', () => {
  it('조합이 없으면 Enter는 전송, Shift+Enter는 줄바꿈이다', () => {
    const guard = new ImeEnterGuard();
    expect(guard.onKeyDown(enter())).toBe('submit');
    expect(guard.onKeyDown(enter({ shiftKey: true }))).toBe('pass');
  });

  it('순서 A: 조합 중 Enter 뒤 한글 확정이면 한 번 전송하고 뒤따르는 Enter를 무시한다', () => {
    const guard = new ImeEnterGuard();
    expect(guard.onKeyDown(composingEnter)).toBe('pass');
    expect(guard.onCompositionEnd('요')).toBe('submit');
    expect(guard.onKeyDown(enter())).toBe('block');
    expect(guard.onKeyDown(enter())).toBe('submit');
  });

  it('순서 B: 조합이 먼저 끝나면 뒤따르는 Enter가 전송한다', () => {
    const guard = new ImeEnterGuard();
    expect(guard.onCompositionEnd('값')).toBe('none');
    expect(guard.onKeyDown(enter())).toBe('submit');
  });

  it('일본어와 중국어 후보 확정은 전송하지 않고, 같은 Enter도 전송으로 치지 않는다', () => {
    const guard = new ImeEnterGuard();
    guard.onKeyDown(composingEnter);
    expect(guard.onCompositionEnd('日本語')).toBe('none');
    expect(guard.onKeyDown(enter())).toBe('block');
    expect(guard.onKeyDown(enter())).toBe('submit');
  });

  it('조합 중 Shift+Enter는 확정 뒤 줄바꿈이고 두 번 넣지 않는다', () => {
    const guard = new ImeEnterGuard();
    expect(guard.onKeyDown({ ...composingEnter, shiftKey: true })).toBe('pass');
    expect(guard.onCompositionEnd('요')).toBe('newline');
    expect(guard.onKeyDown(enter({ shiftKey: true }))).toBe('block');
    expect(guard.onKeyDown(enter({ shiftKey: true }))).toBe('pass');
  });

  it('조합 중 일반 글자(229)는 아무것도 예약하지 않는다', () => {
    const guard = new ImeEnterGuard();
    expect(guard.onKeyDown({ key: 'Process', shiftKey: false, isComposing: true, keyCode: 229 })).toBe('pass');
    expect(guard.onCompositionEnd('가')).toBe('none');
  });

  it('무시 표시는 다른 키나 시간이 지나면 풀린다', () => {
    const guard = new ImeEnterGuard();
    guard.onKeyDown(composingEnter);
    guard.onCompositionEnd('요');
    guard.clearIgnore();
    expect(guard.onKeyDown(enter())).toBe('submit');

    guard.onKeyDown(composingEnter);
    guard.onCompositionEnd('요');
    guard.onKeyDown({ key: 'a', shiftKey: false, isComposing: false, keyCode: 65 });
    expect(guard.onKeyDown(enter())).toBe('submit');
  });
});
