import type { AiErrorCode, ParagraphSource, RecapSegment, SendScope, TutorEvent } from '../../../shared/ipc/contract';

export interface Paragraph {
  text: string;
  source: ParagraphSource | null;
}

export type TurnStatus = 'reading' | 'streaming' | 'done' | 'stopped' | 'error';

export interface Turn {
  id: string;
  question: string;
  scope: SendScope;
  status: TurnStatus;
  errorCode: AiErrorCode | null;
  recap: { segments: RecapSegment[]; correction: string | null } | null;
  paragraphs: Paragraph[];
  /** 고치기 전 답변. 접어서 대화에 남긴다. */
  previous: Turn | null;
}

export type ConversationAction =
  | { type: 'started'; id: string; question: string; scope: SendScope; replaces: string | null }
  | { type: 'event'; event: TutorEvent }
  | { type: 'reset' };

export function isActive(turn: Turn): boolean {
  return turn.status === 'reading' || turn.status === 'streaming';
}

export function conversationReducer(turns: Turn[], action: ConversationAction): Turn[] {
  if (action.type === 'reset') return [];
  if (action.type === 'started') {
    const turn: Turn = {
      id: action.id,
      question: action.question,
      scope: action.scope,
      status: 'reading',
      errorCode: null,
      recap: null,
      paragraphs: [],
      previous: null,
    };
    const index = action.replaces === null ? -1 : turns.findIndex(({ id }) => id === action.replaces);
    const replaced = turns[index];
    if (replaced === undefined) return [...turns, turn];
    const previous: Turn = isActive(replaced) ? { ...replaced, status: 'stopped' } : replaced;
    return turns.with(index, { ...turn, previous });
  }

  const { event } = action;
  return turns.map((turn) => (turn.id === event.requestId ? applyEvent(turn, event) : turn));
}

function applyEvent(turn: Turn, event: TutorEvent): Turn {
  switch (event.type) {
    case 'recap':
      return { ...turn, status: 'streaming', recap: { segments: event.segments, correction: event.correction } };
    case 'delta': {
      const existing = turn.paragraphs[event.paragraph] ?? { text: '', source: null };
      const paragraphs = turn.paragraphs.slice();
      paragraphs[event.paragraph] = { ...existing, text: existing.text + event.text };
      return { ...turn, status: 'streaming', paragraphs };
    }
    case 'paragraph-end': {
      const existing = turn.paragraphs[event.paragraph];
      if (existing === undefined) return turn;
      return { ...turn, paragraphs: turn.paragraphs.with(event.paragraph, { ...existing, source: event.source }) };
    }
    case 'done':
      return { ...turn, status: 'done' };
    case 'stopped':
      return { ...turn, status: 'stopped' };
    case 'error':
      return { ...turn, status: 'error', errorCode: event.code };
  }
}

/** 답변 끝 요약의 재료: 근거 쪽(중복 없이 오름차순)과 일반 지식 포함 여부. */
export function summarizeSources(paragraphs: Paragraph[]): { pages: number[]; general: boolean } {
  const pages = new Set<number>();
  let general = false;
  for (const { source } of paragraphs) {
    if (source?.kind === 'page') pages.add(source.page);
    if (source?.kind === 'general') general = true;
  }
  return { pages: [...pages].sort((a, b) => a - b), general };
}
