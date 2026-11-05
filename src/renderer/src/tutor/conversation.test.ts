import { describe, expect, it } from 'vitest';
import type { SendScope, TutorEvent } from '../../../shared/ipc/contract';
import { conversationReducer, summarizeSources, type Turn } from './conversation';

const scope: SendScope = { basePage: 2, firstPage: 1, lastPage: 3, currentPage: 2, selection: null, previousTurns: 0, corrections: 0, provider: 'fake' };
const start = (id: string, replaces: string | null = null) => ({ type: 'started', id, question: 'q', scope, replaces }) as const;
const apply = (turns: Turn[], ...events: TutorEvent[]): Turn[] =>
  events.reduce((state, event) => conversationReducer(state, { type: 'event', event }), turns);

describe('conversationReducer', () => {
  it('읽는 중에서 스트리밍, 완료로 간다', () => {
    let turns = conversationReducer([], start('a'));
    expect(turns[0]?.status).toBe('reading');
    turns = apply(turns, { requestId: 'a', type: 'delta', paragraph: 0, text: '안녕' }, { requestId: 'a', type: 'delta', paragraph: 0, text: '하세요' });
    expect(turns[0]).toMatchObject({ status: 'streaming', paragraphs: [{ text: '안녕하세요', source: null }] });
    turns = apply(turns, { requestId: 'a', type: 'paragraph-end', paragraph: 0, source: { kind: 'page', page: 2 } }, { requestId: 'a', type: 'done' });
    expect(turns[0]).toMatchObject({ status: 'done', paragraphs: [{ source: { kind: 'page', page: 2 } }] });
  });

  it('다른 요청의 알림은 섞이지 않는다', () => {
    const turns = apply(conversationReducer([], start('a')), { requestId: 'b', type: 'done' });
    expect(turns[0]?.status).toBe('reading');
  });

  it('고치면 같은 자리에서 교체하고 이전 답변을 중지된 상태로 접어 둔다', () => {
    let turns = conversationReducer(conversationReducer([], start('a')), start('b'));
    turns = apply(turns, { requestId: 'a', type: 'delta', paragraph: 0, text: 'x' });
    turns = conversationReducer(turns, start('c', 'a'));
    expect(turns.map(({ id }) => id)).toEqual(['c', 'b']);
    expect(turns[0]?.previous).toMatchObject({ id: 'a', status: 'stopped' });
  });
});

describe('summarizeSources', () => {
  it('근거 쪽과 일반 지식을 모은다. 범위 밖 글자는 근거가 아니다', () => {
    expect(
      summarizeSources([
        { text: '', source: { kind: 'page', page: 3 } },
        { text: '', source: { kind: 'page', page: 1 } },
        { text: '', source: { kind: 'page', page: 3 } },
        { text: '', source: { kind: 'general' } },
        { text: '', source: { kind: 'plain', text: 'p.99' } },
        { text: '', source: null },
      ]),
    ).toEqual({ pages: [1, 3], general: true });
  });
});
