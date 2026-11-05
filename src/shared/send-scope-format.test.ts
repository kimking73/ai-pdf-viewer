import { describe, expect, it } from 'vitest';
import type { SendScope } from './ipc/contract';
import { formatFrozenScope, formatPageRange, formatProviderLine, formatScopeLine, formatScopeNotice } from './send-scope-format';

const base: SendScope = {
  basePage: 12,
  firstPage: 11,
  lastPage: 13,
  currentPage: 12,
  selection: null,
  previousTurns: 0,
  corrections: 0,
  provider: 'fake',
};

describe('범위 문구', () => {
  it('쪽 범위와 문서 경계', () => {
    expect(formatPageRange(base)).toBe('p.11~13');
    expect(formatPageRange({ firstPage: 1, lastPage: 1 })).toBe('p.1');
  });

  it('선택 종류를 표시한다', () => {
    expect(formatScopeLine(base)).toBe('p.11~13');
    expect(formatScopeLine({ ...base, selection: { kind: 'text', page: 12 } })).toBe('p.11~13 · 선택한 글 1개(p.12)');
    expect(formatScopeLine({ ...base, selection: { kind: 'area', page: 12 } })).toBe('p.11~13 · 선택 영역 1개(p.12)');
  });

  it('제공사 줄은 가짜 응답임을 밝히고 이전 대화를 표시한다', () => {
    expect(formatProviderLine(base)).toBe('가짜 응답(전송 없음)');
    expect(formatProviderLine({ ...base, previousTurns: 2 })).toBe('이전 대화 일부 포함 · 가짜 응답(전송 없음)');
    expect(formatProviderLine(base)).not.toContain('OpenAI');
  });

  it('선택 쪽과 현재 쪽이 다를 때만 알린다', () => {
    const selection = { kind: 'area', page: 12 } as const;
    expect(formatScopeNotice(base)).toBeNull();
    expect(formatScopeNotice({ ...base, selection })).toBeNull();
    expect(formatScopeNotice({ ...base, selection, currentPage: 20 })).toBe(
      '선택 기준입니다. 지금 보는 p.20은 보내지 않습니다.',
    );
    expect(formatScopeNotice({ ...base, selection, currentPage: 13 })).toBe('선택 기준입니다.');
  });

  it('고정 문구는 전송하지 않았음을 적는다', () => {
    expect(formatFrozenScope({ ...base, selection: { kind: 'area', page: 12 } })).toBe(
      '확정 범위: p.11~13 · 선택 영역 1개 · 전송 안 함(가짜 응답)',
    );
  });
});
