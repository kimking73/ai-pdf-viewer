import type { ParagraphSource, RecapSegment } from '../../shared/ipc/contract';

// tutor-prompt.ts가 모델에게 요구하는 답변 형식을 화면용 이벤트로 바꾼다.
// 문단은 빈 줄로 나뉘고, 끝에 [근거 p.12] 또는 [일반 지식]이 붙는다. 첫 블록은 [읽은내용]일 수 있다.
export type ParsedAnswerEvent =
  | { type: 'recap'; segments: RecapSegment[]; correction: string | null }
  | { type: 'delta'; paragraph: number; text: string }
  | { type: 'paragraph-end'; paragraph: number; source: ParagraphSource };

const RECAP_MARK = '[읽은내용]';
const SOURCE_TAG = /\s*\[(?:근거 p\.(\d+)|(일반 지식))\]\s*$/;
// 뒤에 태그나 문단 구분이 이어질 수 있는 꼬리. 다음 조각을 볼 때까지 내보내지 않는다.
const HOLD_BACK = /\s*(?:\[[^\]\n]{0,14}\]?\s*)?$/;

function parseRecap(text: string): RecapSegment[] {
  return text
    .split(/(\{\{.*?\}\})/s)
    .filter((part) => part !== '')
    .map((part) =>
      part.startsWith('{{') && part.endsWith('}}') ? { text: part.slice(2, -2), uncertain: true } : { text: part, uncertain: false },
    );
}

export class AnswerParser {
  private buffer = '';
  private paragraph = 0;
  // 지금 문단에서 이미 내보낸 글자 수.
  private emitted = 0;
  private firstBlock = true;

  constructor(private readonly correction: string | null) {}

  feed(text: string): ParsedAnswerEvent[] {
    this.buffer += text.replaceAll('\r\n', '\n');
    const events: ParsedAnswerEvent[] = [];
    for (;;) {
      if (this.emitted === 0) this.buffer = this.buffer.replace(/^\s+/, '');
      const end = this.buffer.indexOf('\n\n');
      if (end === -1) break;
      this.finishBlock(this.buffer.slice(0, end), events);
      this.buffer = this.buffer.slice(end + 2);
    }
    if (!this.mayBeRecap()) {
      const safe = this.buffer.search(HOLD_BACK);
      if (safe > this.emitted) {
        events.push({ type: 'delta', paragraph: this.paragraph, text: this.buffer.slice(this.emitted, safe) });
        this.emitted = safe;
        this.firstBlock = false;
      }
    }
    return events;
  }

  finish(): ParsedAnswerEvent[] {
    const events: ParsedAnswerEvent[] = [];
    if (this.buffer.trim() !== '') this.finishBlock(this.buffer, events);
    this.buffer = '';
    return events;
  }

  // 첫 블록이 아직 [읽은내용]일 수 있으면 글자를 내보내지 않고 기다린다.
  private mayBeRecap(): boolean {
    if (!this.firstBlock) return false;
    return this.buffer.startsWith(RECAP_MARK) || RECAP_MARK.startsWith(this.buffer);
  }

  private finishBlock(block: string, events: ParsedAnswerEvent[]): void {
    if (this.firstBlock && block.startsWith(RECAP_MARK)) {
      this.firstBlock = false;
      events.push({ type: 'recap', segments: parseRecap(block.slice(RECAP_MARK.length).trim()), correction: this.correction });
      return;
    }
    this.firstBlock = false;

    const tag = SOURCE_TAG.exec(block);
    const body = tag === null ? block.trimEnd() : block.slice(0, tag.index);
    if (body.length > this.emitted) {
      events.push({ type: 'delta', paragraph: this.paragraph, text: body.slice(this.emitted) });
    }
    if (body.length > 0) {
      if (tag !== null) {
        const page = tag[1];
        const source: ParagraphSource = page === undefined ? { kind: 'general' } : { kind: 'page', page: Number(page) };
        events.push({ type: 'paragraph-end', paragraph: this.paragraph, source });
      }
      this.paragraph += 1;
    }
    this.emitted = 0;
  }
}
