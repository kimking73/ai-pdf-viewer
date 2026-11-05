import { describe, expect, it } from 'vitest';
import { parseBlocks, parseInline } from './answer-format';

const text = (value: string) => ({ kind: 'text', text: value });
const math = (latex: string, display = false) => ({ kind: 'math', latex, display });

describe('parseInline', () => {
  it('화면에서 깨졌던 답변을 수식과 강조로 나눈다', () => {
    expect(parseInline('입력 $X\\in\\mathbb{R}^k$에 **오른쪽 함수부터** 적용', false)).toEqual([
      text('입력 '),
      math('X\\in\\mathbb{R}^k'),
      text('에 '),
      { kind: 'bold', children: [text('오른쪽 함수부터')] },
      text(' 적용'),
    ]);
  });

  it('여러 수식 표기를 모두 읽는다', () => {
    expect(parseInline('$$a$$', false)).toEqual([math('a', true)]);
    expect(parseInline('\\[a\\]', false)).toEqual([math('a', true)]);
    expect(parseInline('\\(a\\)', false)).toEqual([math('a')]);
    expect(parseInline('$$\na\n$$', false)).toEqual([math('a', true)]);
  });

  it('금액은 수식으로 읽지 않는다', () => {
    expect(parseInline('가격은 $5이고 $10입니다', false)).toEqual([text('가격은 $5이고 $10입니다')]);
    expect(parseInline('\\$5', false)).toEqual([text('$5')]);
    expect(parseInline('$ a $', false)).toEqual([text('$ a $')]);
  });

  it('강조 안의 수식도 읽는다', () => {
    expect(parseInline('**$a$ 입니다**', false)).toEqual([{ kind: 'bold', children: [math('a'), text(' 입니다')] }]);
  });

  it('곱셈 별표는 강조로 읽지 않는다', () => {
    expect(parseInline('2*3*4', false)).toEqual([text('2*3*4')]);
    expect(parseInline('*기울임*', false)).toEqual([{ kind: 'em', children: [text('기울임')] }]);
  });

  it('코드 안의 기호는 해석하지 않는다', () => {
    expect(parseInline('`$a$ **b**`', false)).toEqual([{ kind: 'code', text: '$a$ **b**' }]);
  });

  it('HTML과 링크는 글자로 남는다', () => {
    const value = '<img src=x onerror=y> [링크](https://example.com)';
    expect(parseInline(value, false)).toEqual([text(value)]);
  });

  it('스트리밍 중 닫히지 않은 수식은 원문 대신 자리표시로 둔다', () => {
    expect(parseInline('값은 $X\\in', true)).toEqual([text('값은 '), { kind: 'pending-math' }]);
    expect(parseInline('값은 $$X', true)).toEqual([text('값은 '), { kind: 'pending-math' }]);
    expect(parseInline('값은 \\[X', true)).toEqual([text('값은 '), { kind: 'pending-math' }]);
  });

  it('스트리밍 중에도 금액 뒤에 이어지는 글을 가리지 않는다', () => {
    expect(parseInline('가격은 $5이고 설명이 이어집니다', true)).toEqual([text('가격은 $5이고 설명이 이어집니다')]);
  });

  it('스트리밍 중 닫히지 않은 강조는 기호를 노출하지 않는다', () => {
    expect(parseInline('**강조', true)).toEqual([{ kind: 'bold', children: [text('강조')] }]);
  });

  it('완료 뒤에도 닫히지 않았으면 글자로 둔다', () => {
    expect(parseInline('값은 $X\\in', false)).toEqual([text('값은 $X\\in')]);
    expect(parseInline('**강조', false)).toEqual([text('**강조')]);
    expect(parseInline('$$X', false)).toEqual([text('$$X')]);
  });
});

describe('parseBlocks', () => {
  it('제목, 목록, 문단을 나눈다', () => {
    expect(parseBlocks('## 제목\n문단\n- 하나\n- 둘\n1. 셋\n끝', false)).toEqual([
      { kind: 'heading', inlines: [text('제목')] },
      { kind: 'paragraph', inlines: [text('문단')] },
      { kind: 'list', ordered: false, items: [[text('하나')], [text('둘')]] },
      { kind: 'list', ordered: true, items: [[text('셋')]] },
      { kind: 'paragraph', inlines: [text('끝')] },
    ]);
  });

  it('코드 구역은 해석하지 않고, 닫히지 않아도 코드로 둔다', () => {
    expect(parseBlocks('```js\n- $a$\n```', false)).toEqual([{ kind: 'code', text: '- $a$' }]);
    expect(parseBlocks('```\n미완성', true)).toEqual([{ kind: 'code', text: '미완성' }]);
  });

  it('여러 줄 수식 안의 줄은 목록으로 읽지 않는다', () => {
    expect(parseBlocks('$$\n- a\n+ b\n$$', false)).toEqual([{ kind: 'paragraph', inlines: [math('- a\n+ b', true)] }]);
  });

  it('줄바꿈이 있는 문단은 한 문단으로 둔다', () => {
    expect(parseBlocks('한 줄\n다음 줄', false)).toEqual([{ kind: 'paragraph', inlines: [text('한 줄\n다음 줄')] }]);
  });
});
