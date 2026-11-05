import { describe, expect, it } from 'vitest';
import { AnswerParser, type ParsedAnswerEvent } from './answer-parser';

function run(chunks: string[], correction: string | null = null): ParsedAnswerEvent[] {
  const parser = new AnswerParser(correction);
  return [...chunks.flatMap((chunk) => parser.feed(chunk)), ...parser.finish()];
}

// 같은 문단의 조각을 합쳐 조각 경계와 무관하게 비교한다.
function normalize(events: ParsedAnswerEvent[]): unknown[] {
  const merged: ParsedAnswerEvent[] = [];
  for (const event of events) {
    const last = merged.at(-1);
    if (event.type === 'delta' && last?.type === 'delta' && last.paragraph === event.paragraph) {
      merged[merged.length - 1] = { ...last, text: last.text + event.text };
    } else {
      merged.push(event);
    }
  }
  return merged;
}

const ANSWER = '[읽은내용] x = {{a_i}} + b\n\n첫 문단입니다. [근거 p.12]\n\n둘째 문단입니다. [일반 지식]\n\n셋째 문단';
const EXPECTED = [
  { type: 'recap', correction: null, segments: [{ text: 'x = ', uncertain: false }, { text: 'a_i', uncertain: true }, { text: ' + b', uncertain: false }] },
  { type: 'delta', paragraph: 0, text: '첫 문단입니다.' },
  { type: 'paragraph-end', paragraph: 0, source: { kind: 'page', page: 12 } },
  { type: 'delta', paragraph: 1, text: '둘째 문단입니다.' },
  { type: 'paragraph-end', paragraph: 1, source: { kind: 'general' } },
  { type: 'delta', paragraph: 2, text: '셋째 문단' },
];

describe('AnswerParser', () => {
  it('되짚기, 문단, 근거, 일반 지식을 나눈다', () => {
    expect(normalize(run([ANSWER]))).toEqual(EXPECTED);
  });

  it.each([1, 2, 3, 7])('%i글자씩 끊어 받아도 결과가 같다', (size) => {
    const chunks: string[] = [];
    for (let start = 0; start < ANSWER.length; start += size) chunks.push(ANSWER.slice(start, start + size));
    expect(normalize(run(chunks))).toEqual(EXPECTED);
  });

  it('근거 태그는 글자로 나가지 않는다', () => {
    const text = run(['본문 [근', '거 p.', '3]'])
      .flatMap((event) => (event.type === 'delta' ? [event.text] : []))
      .join('');
    expect(text).toBe('본문');
  });

  it('문단 가운데의 대괄호는 글자로 남긴다', () => {
    expect(normalize(run(['행렬 [a b] 를 봅니다. [근거 p.1]']))).toEqual([
      { type: 'delta', paragraph: 0, text: '행렬 [a b] 를 봅니다.' },
      { type: 'paragraph-end', paragraph: 0, source: { kind: 'page', page: 1 } },
    ]);
  });

  it('고친 내용을 되짚기에 함께 싣는다', () => {
    expect(run(['[읽은내용] y\n\n답'], '첨자는 j')[0]).toEqual({
      type: 'recap',
      correction: '첨자는 j',
      segments: [{ text: 'y', uncertain: false }],
    });
  });

  it('줄바꿈 형식이 달라도 문단을 나눈다', () => {
    expect(normalize(run(['하나\r\n\r\n둘']))).toEqual([
      { type: 'delta', paragraph: 0, text: '하나' },
      { type: 'delta', paragraph: 1, text: '둘' },
    ]);
  });

  it('태그만 있는 블록은 빈 문단을 만들지 않는다', () => {
    expect(run(['[일반 지식]\n\n본문'])).toEqual([{ type: 'delta', paragraph: 0, text: '본문' }]);
  });

  it('빈 답변은 아무것도 내보내지 않는다', () => {
    expect(run(['  \n\n '])).toEqual([]);
  });
});
