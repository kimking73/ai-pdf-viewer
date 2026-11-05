import { OPENAI_MODEL } from '../../shared/ai-model';
import type { TutorProvider, TutorProviderEvent, TutorProviderRequest } from '../tutor/provider';
import { AiError, classifyFailure, type KeyCheckResult } from './ai-error';
import { AnswerParser } from './answer-parser';
import { classifyOpenAiResponse, classifyOpenAiStreamCode } from './openai-errors';
import { buildInput, TUTOR_INSTRUCTIONS } from './tutor-prompt';

// 목적지는 여기에 고정한다. 렌더러가 주소를 정할 수 없다(docs/architecture.md 4절).
const API_BASE = 'https://api.openai.com/v1';
const IDLE_TIMEOUT_MS = 60_000;
const VALIDATE_TIMEOUT_MS = 15_000;

export interface OpenAiProviderOptions {
  loadApiKey(): Promise<string | null>;
  fetch?: typeof globalThis.fetch;
  idleTimeoutMs?: number;
}

interface StreamEvent {
  type?: unknown;
  delta?: unknown;
  code?: unknown;
  response?: { error?: { code?: unknown } | null };
}

function asCode(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

// SSE 본문에서 data 줄의 JSON을 차례로 꺼낸다. 알 수 없는 줄은 건너뛴다.
async function* readEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<StreamEvent> {
  const decoder = new TextDecoder();
  let pending = '';
  const reader = body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      pending += decoder.decode(value, { stream: true });
      const lines = pending.split('\n');
      pending = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '' || data === '[DONE]') continue;
        try {
          yield JSON.parse(data) as StreamEvent;
        } catch {
          // 형식이 다른 줄은 무시한다. 내용을 로그에 남기지 않는다.
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export class OpenAiProvider implements TutorProvider {
  private readonly fetch: typeof globalThis.fetch;
  private readonly idleTimeoutMs: number;

  constructor(private readonly options: OpenAiProviderOptions) {
    this.fetch = options.fetch ?? globalThis.fetch;
    this.idleTimeoutMs = options.idleTimeoutMs ?? IDLE_TIMEOUT_MS;
  }

  async *stream(request: TutorProviderRequest, signal: AbortSignal): AsyncIterable<TutorProviderEvent> {
    const apiKey = await this.options.loadApiKey();
    if (apiKey === null) throw new AiError('invalid-key');

    // 응답이 오래 멈추면 실패로 처리한다(계약 4.6절). 조각을 받을 때마다 다시 잰다.
    const idle = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const touch = (): void => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        idle.abort();
      }, this.idleTimeoutMs);
    };
    touch();

    try {
      const response = await this.fetch(`${API_BASE}/responses`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: OPENAI_MODEL,
          instructions: TUTOR_INSTRUCTIONS,
          input: buildInput(request),
          stream: true,
          // 문서 내용을 OpenAI 쪽 대화 저장소에 남기지 않는다. 대화는 앱이 매번 다시 보낸다.
          store: false,
        }),
        signal: AbortSignal.any([signal, idle.signal]),
      });
      if (!response.ok) throw new AiError(classifyOpenAiResponse(response.status, await response.text()));
      if (response.body === null) throw new AiError('provider');

      const parser = new AnswerParser(request.correction);
      let finished = false;
      for await (const event of readEvents(response.body)) {
        touch();
        if (event.type === 'response.output_text.delta' && typeof event.delta === 'string') {
          yield* parser.feed(event.delta);
        } else if (event.type === 'response.completed' || event.type === 'response.incomplete') {
          // incomplete는 길이 제한 등으로 잘린 답변이다. 받은 부분을 그대로 둔다.
          finished = true;
          break;
        } else if (event.type === 'response.failed') {
          throw new AiError(classifyOpenAiStreamCode(asCode(event.response?.error?.code)));
        } else if (event.type === 'error') {
          throw new AiError(classifyOpenAiStreamCode(asCode(event.code)));
        }
      }
      // 끝 표시 없이 끊기면 답변이 잘린 것이다.
      if (!finished) throw new AiError('network');
      yield* parser.finish();
    } catch (error) {
      if (idle.signal.aborted && !signal.aborted) throw new AiError('provider');
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  // 과금 없는 모델 목록 조회로 확인한다. 잔액 부족은 여기서 잡히지 않을 수 있고, 그 경우 답변 때 알린다(계약 4.5절).
  async validateKey(apiKey: string): Promise<KeyCheckResult> {
    try {
      const response = await this.fetch(`${API_BASE}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(VALIDATE_TIMEOUT_MS),
      });
      if (response.ok) return 'ok';
      return classifyOpenAiResponse(response.status, await response.text());
    } catch (error) {
      const code = classifyFailure(error, new AbortController().signal);
      return code === 'cancelled' ? 'network' : code;
    }
  }
}
