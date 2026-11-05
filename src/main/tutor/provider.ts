import type { ParagraphSource, RecapSegment, SendScope, TutorContext } from '../../shared/ipc/contract';

export interface TutorProviderRequest {
  question: string;
  scope: SendScope;
  /** 이번 요청에서 새로 고친 내용. 되짚기 블록에 함께 표시한다. */
  correction: string | null;
  /** 지금까지 고친 내용 전부. 후속 질문에도 항상 포함한다(계약 4.7절). */
  corrections: string[];
  /** 범위에 포함된 이전 대화. */
  history: { question: string; answer: string }[];
  /** 메인이 범위에 맞춰 걸러 낸 내용. 범위 표시와 실제 전송이 같도록 이것만 보낸다. */
  context: TutorContext;
}

export type TutorProviderEvent =
  | { type: 'recap'; segments: RecapSegment[]; correction: string | null }
  | { type: 'delta'; paragraph: number; text: string }
  | { type: 'paragraph-end'; paragraph: number; source: ParagraphSource };

// 제공사 경계(docs/architecture.md 4절). 키는 어댑터 뒤에서만 다룬다.
export interface TutorProvider {
  stream(request: TutorProviderRequest, signal: AbortSignal): AsyncIterable<TutorProviderEvent>;
}

// 요청에 고정된 제공사로 보낸다. 다시 받기도 처음 보낸 곳으로만 간다.
export function routeProvider(providers: Record<SendScope['provider'], TutorProvider>): TutorProvider {
  return { stream: (request, signal) => providers[request.scope.provider].stream(request, signal) };
}

// 보낸 범위 밖의 쪽은 근거 라벨로 만들지 않고 글자로 둔다(계약 4.8절).
export function sanitizeSource(source: ParagraphSource, scope: SendScope): ParagraphSource {
  if (source.kind !== 'page') return source;
  const inRange = source.page >= scope.firstPage && source.page <= scope.lastPage;
  return inRange ? source : { kind: 'plain', text: `p.${String(source.page)}` };
}
