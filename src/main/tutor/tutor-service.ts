import { randomUUID } from 'node:crypto';
import type { IpcRequest, IpcResponse, SendScope, TutorContext, TutorEvent } from '../../shared/ipc/contract';
import type { IPC_CHANNELS } from '../../shared/ipc/channels';
import { classifyFailure } from '../ai/ai-error';
import { sanitizeSource, type TutorProvider, type TutorProviderRequest } from './provider';
import { fitContextToScope, resolveSendScope } from './send-scope';

type ScopeRequest = IpcRequest<typeof IPC_CHANNELS.tutorResolveScope>;
type AskRequest = IpcRequest<typeof IPC_CHANNELS.tutorAsk>;
type AskResponse = IpcResponse<typeof IPC_CHANNELS.tutorAsk>;
type ScopeResponse = IpcResponse<typeof IPC_CHANNELS.tutorResolveScope>;

interface StoredRequest {
  question: string;
  scope: SendScope;
  context: TutorContext;
}

interface Session {
  documentId: string;
  history: { question: string; answer: string }[];
  corrections: string[];
  // 다시 받을 때 같은 범위와 내용을 쓰도록 요청별로 보관한다. 렌더러가 범위를 다시 정할 수 없다.
  requests: Map<string, StoredRequest>;
}

export interface TutorServiceOptions {
  provider: TutorProvider;
  /** 지금 고른 제공사. 새 질문의 범위에 고정된다. */
  getProviderId(): SendScope['provider'];
  /** 키가 없으면 아무것도 전송하지 않는다(계약 4.5절). */
  hasKey(): Promise<boolean>;
  isIssuedDocument(id: string): boolean;
  send(event: TutorEvent): void;
}

// 대화 상태와 전송 범위의 원본. Electron을 가져오지 않으므로 단위 테스트에서 그대로 실행한다.
export class TutorService {
  private session: Session | null = null;
  private active: { requestId: string; abort: AbortController; finished: Promise<void> } | null = null;

  constructor(private readonly options: TutorServiceOptions) {}

  resolveScope(request: ScopeRequest): ScopeResponse {
    const session = this.sessionFor(request.documentId);
    if (session === null) return { status: 'no-document' };
    return { status: 'ok', scope: this.scopeFor(request, session) };
  }

  async ask(request: AskRequest): Promise<AskResponse> {
    const documentId = request.mode === 'new' ? request.scope.documentId : request.documentId;
    if (this.sessionFor(documentId) === null) return { status: 'no-document' };
    // 복사 금지 문서는 어떤 경로로도 내용을 보내지 않는다.
    if (request.mode === 'new' && !request.copyAllowed) return { status: 'blocked' };
    if (!(await this.options.hasKey())) return { status: 'no-key' };

    // 키를 확인하는 사이에 상태가 바뀌었을 수 있으므로 여기서부터 동기로 판단한다.
    const session = this.sessionFor(documentId);
    if (session === null) return { status: 'no-document' };

    if (request.mode === 'new') {
      if (this.active !== null) return { status: 'busy' };
      const resolved = this.scopeFor(request.scope, session);
      const context = fitContextToScope(request.context, resolved);
      // 쪽을 이미지로 만들지 못했으면 보냈다고 표시하지 않는다.
      const scope = { ...resolved };
      if ((context.pageImage ?? null) === null) delete scope.pageImage;
      return this.start(session, { question: request.question, scope, context }, null);
    }

    const original = session.requests.get(request.requestId);
    if (original === undefined) return { status: 'no-document' };
    if (request.correction === null) {
      if (this.active !== null) return { status: 'busy' };
      return this.start(session, original, null);
    }

    // 고친 내용은 진행 중인 답변을 멈추고 같은 범위로 새로 받는다(계약 4.7절).
    if (this.active !== null) {
      this.active.abort.abort();
      await this.active.finished;
      // 기다리는 사이에 문서가 바뀌었거나 창이 닫혔거나 다른 고치기 요청이 먼저 시작했을 수 있다.
      if (this.session !== session) return { status: 'no-document' };
      if (this.isBusy()) return { status: 'busy' };
    }
    session.corrections.push(request.correction);
    const scope = { ...original.scope, corrections: session.corrections.length };
    return this.start(session, { ...original, scope }, request.correction);
  }

  stop(requestId: string): boolean {
    if (this.active?.requestId !== requestId) return false;
    this.active.abort.abort();
    return true;
  }

  reset(): void {
    this.active?.abort.abort();
    this.session = null;
  }

  private isBusy(): boolean {
    return this.active !== null;
  }

  private scopeFor(material: ScopeRequest, session: Session): SendScope {
    return resolveSendScope(material, session.history.length, session.corrections.length, this.options.getProviderId());
  }

  private sessionFor(documentId: string): Session | null {
    if (!this.options.isIssuedDocument(documentId)) return null;
    if (this.session?.documentId !== documentId) {
      // 다른 문서로 넘어가면 진행 중인 답변을 멈추고 대화를 새로 시작한다.
      this.active?.abort.abort();
      this.session = { documentId, history: [], corrections: [], requests: new Map() };
    }
    return this.session;
  }

  private start(session: Session, stored: StoredRequest, correction: string | null): AskResponse {
    const requestId = randomUUID();
    session.requests.set(requestId, stored);
    const { question, scope, context } = stored;
    const request: TutorProviderRequest = {
      question,
      scope,
      context,
      correction,
      corrections: [...session.corrections],
      history: scope.previousTurns === 0 ? [] : session.history.slice(-scope.previousTurns),
    };
    const abort = new AbortController();
    const finished = this.run(session, requestId, request, abort.signal).finally(() => {
      if (this.active?.requestId === requestId) this.active = null;
    });
    this.active = { requestId, abort, finished };
    return { status: 'started', requestId, question, scope };
  }

  private async run(session: Session, requestId: string, request: TutorProviderRequest, signal: AbortSignal): Promise<void> {
    const send = (event: TutorEvent): void => {
      this.options.send(event);
    };
    let answer = '';
    // 받은 글자가 있는 답변만 다음 질문의 이전 대화로 쓴다.
    const remember = (): void => {
      if (answer !== '') session.history.push({ question: request.question, answer });
    };
    try {
      for await (const event of this.options.provider.stream(request, signal)) {
        if (signal.aborted) break;
        if (event.type === 'delta') answer += event.text;
        send(
          event.type === 'paragraph-end'
            ? { ...event, requestId, source: sanitizeSource(event.source, request.scope) }
            : { ...event, requestId },
        );
      }
      remember();
      send({ requestId, type: signal.aborted ? 'stopped' : 'done' });
    } catch (error) {
      const code = classifyFailure(error, signal);
      // 실제 호출은 중단되면 AbortError를 던진다. 사용자가 멈춘 것이므로 실패로 알리지 않는다.
      if (code === 'cancelled') {
        remember();
        send({ requestId, type: 'stopped' });
        return;
      }
      console.error(`[tutor] 답변 실패: ${code}`);
      send({ requestId, type: 'error', code });
    }
  }
}
