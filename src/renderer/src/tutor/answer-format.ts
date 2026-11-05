// 답변 글을 화면 구조로 바꾼다. 제목, 목록, 강조, 코드, 수식만 다룬다(계약 4.6절).
// HTML은 해석하지 않고 글자로 둔다. 링크 문법도 글자로 두므로 답변 안의 주소는 눌리지 않는다.

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; children: Inline[] }
  | { kind: 'em'; children: Inline[] }
  | { kind: 'code'; text: string }
  | { kind: 'math'; latex: string; display: boolean }
  // 스트리밍 중 닫는 기호가 아직 오지 않은 수식. 원문 대신 자리표시를 보여 준다.
  | { kind: 'pending-math' };

export type Block =
  | { kind: 'paragraph'; inlines: Inline[] }
  | { kind: 'heading'; inlines: Inline[] }
  | { kind: 'list'; ordered: boolean; items: Inline[][] }
  | { kind: 'code'; text: string };

function isSpace(char: string | undefined): boolean {
  return char === undefined || /\s/.test(char);
}

// 줄을 넘지 않고, 앞뒤가 공백이 아닌 인라인 수식의 닫는 $를 찾는다. "$5에서 $10"을 수식으로 읽지 않기 위한 규칙이다.
function findInlineMathEnd(text: string, from: number): number {
  for (let index = from; index < text.length; index += 1) {
    const char = text[index];
    if (char === '\n') return -1;
    if (char === '\\') {
      index += 1;
    } else if (char === '$') {
      return !isSpace(text[index - 1]) && !/\d/.test(text[index + 1] ?? '') ? index : -1;
    }
  }
  return -1;
}

export function parseInline(text: string, streaming: boolean): Inline[] {
  const result: Inline[] = [];
  let plain = '';
  const flush = (): void => {
    if (plain !== '') result.push({ kind: 'text', text: plain });
    plain = '';
  };
  const push = (inline: Inline): void => {
    flush();
    result.push(inline);
  };

  let index = 0;
  // 닫는 기호로 끝나는 구간을 처리한다. 닫히지 않았으면 false를 돌려 글자로 둔다.
  const delimited = (open: string, close: string, make: (inner: string) => Inline, pending: Inline | null): boolean => {
    const end = text.indexOf(close, index + open.length);
    if (end !== -1) {
      push(make(text.slice(index + open.length, end)));
      index = end + close.length;
      return true;
    }
    if (streaming && pending !== null) {
      push(pending);
      index = text.length;
      return true;
    }
    return false;
  };
  const math = (display: boolean) => (latex: string): Inline => ({ kind: 'math', latex: latex.trim(), display });
  const pendingMath: Inline = { kind: 'pending-math' };

  while (index < text.length) {
    const char = text[index] ?? '';
    const pair = text.slice(index, index + 2);
    let handled = false;

    if (pair === '\\$') {
      plain += '$';
      index += 2;
      continue;
    }
    if (pair === '\\(') handled = delimited('\\(', '\\)', math(false), pendingMath);
    else if (pair === '\\[') handled = delimited('\\[', '\\]', math(true), pendingMath);
    else if (pair === '$$') handled = delimited('$$', '$$', math(true), pendingMath);
    else if (char === '$' && !isSpace(text[index + 1])) {
      const end = findInlineMathEnd(text, index + 1);
      if (end !== -1) {
        push(math(false)(text.slice(index + 1, end)));
        index = end + 1;
        handled = true;
      } else if (streaming && !/[\n\p{Script=Hangul}]/u.test(text.slice(index))) {
        // 뒤에 한글 문장이 이어지면 "$5이고"처럼 금액일 가능성이 높다. 수식으로 가리면 답변 끝까지 글이 안 보인다.
        push(pendingMath);
        index = text.length;
        handled = true;
      }
    } else if (char === '`') {
      handled = delimited('`', '`', (inner) => ({ kind: 'code', text: inner }), null);
    } else if (pair === '**' && !isSpace(text[index + 2])) {
      const end = text.indexOf('**', index + 2);
      if (end !== -1) {
        push({ kind: 'bold', children: parseInline(text.slice(index + 2, end), streaming) });
        index = end + 2;
        handled = true;
      } else if (streaming) {
        // 닫는 **가 오기 전에도 기호를 노출하지 않는다.
        push({ kind: 'bold', children: parseInline(text.slice(index + 2), streaming) });
        index = text.length;
        handled = true;
      }
    } else if (char === '*' && !isSpace(text[index + 1]) && !/[\p{L}\p{N}]/u.test(text[index - 1] ?? '')) {
      const end = text.indexOf('*', index + 1);
      if (end !== -1 && !isSpace(text[end - 1])) {
        push({ kind: 'em', children: parseInline(text.slice(index + 1, end), streaming) });
        index = end + 1;
        handled = true;
      }
    }

    if (!handled) {
      plain += char;
      index += 1;
    }
  }
  flush();
  return result;
}

const HEADING = /^#{1,6}\s+(.*)$/;
const UNORDERED = /^\s*[-*+]\s+(.*)$/;
const ORDERED = /^\s*\d+[.)]\s+(.*)$/;

export function parseBlocks(text: string, streaming: boolean): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list = null as { ordered: boolean; items: string[] } | null;
  let code: string[] | null = null;

  const flushParagraph = (): void => {
    if (paragraph.length > 0) blocks.push({ kind: 'paragraph', inlines: parseInline(paragraph.join('\n'), streaming) });
    paragraph = [];
  };
  const flushList = (): void => {
    if (list !== null) {
      blocks.push({ kind: 'list', ordered: list.ordered, items: list.items.map((item) => parseInline(item, streaming)) });
    }
    list = null;
  };
  // 여러 줄 수식 안의 줄은 목록이나 제목으로 읽지 않는다.
  const inDisplayMath = (): boolean => (paragraph.join('\n').match(/\$\$/g)?.length ?? 0) % 2 === 1;

  for (const line of text.split('\n')) {
    if (code !== null) {
      if (line.trimStart().startsWith('```')) {
        blocks.push({ kind: 'code', text: code.join('\n') });
        code = null;
      } else {
        code.push(line);
      }
      continue;
    }
    if (inDisplayMath()) {
      paragraph.push(line);
      continue;
    }
    if (line.trimStart().startsWith('```')) {
      flushParagraph();
      flushList();
      code = [];
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading !== null) {
      flushParagraph();
      flushList();
      blocks.push({ kind: 'heading', inlines: parseInline(heading[1] ?? '', streaming) });
      continue;
    }
    const unordered = UNORDERED.exec(line);
    const ordered = ORDERED.exec(line);
    const item = unordered ?? ordered;
    if (item !== null) {
      flushParagraph();
      const isOrdered = unordered === null;
      if (list?.ordered !== isOrdered) {
        flushList();
        list = { ordered: isOrdered, items: [] };
      }
      list.items.push(item[1] ?? '');
      continue;
    }
    flushList();
    paragraph.push(line);
  }
  flushParagraph();
  flushList();
  // 닫는 ```가 없으면 받은 데까지 코드로 둔다.
  if (code !== null) blocks.push({ kind: 'code', text: code.join('\n') });
  return blocks;
}
