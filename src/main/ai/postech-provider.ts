import type { AiErrorCode } from '../../shared/ipc/contract';
import type { TutorProvider, TutorProviderEvent, TutorProviderRequest } from '../tutor/provider';
import { AiError, classifyFailure, type KeyCheckResult } from './ai-error';
import { AnswerParser } from './answer-parser';
import { buildMessage } from './tutor-prompt';

// 목적지는 여기에 고정한다. 렌더러가 주소를 정할 수 없다(docs/architecture.md 4절).
const ENDPOINT = 'https://genai.postech.ac.kr/agent/api/a1/gpt';
// 스트리밍 형식이 문서에 없어 답변을 한 번에 받으므로, 답변 전체를 기다릴 만큼 둔다.
const REQUEST_TIMEOUT_MS = 180_000;
const VALIDATE_TIMEOUT_MS = 60_000;
const IN_BAND_ERROR = /^\s*<div\s+cls="error"\s+attr="(\d*)"\s*>\s*<\/div>\s*$/;

export interface PostechProviderOptions {
  loadApiKey(): Promise<string | null>;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}

// 오류 본문의 형식이 문서에 없어 상태 코드로만 판단한다. 실제 응답을 보고 다듬는다.
export function classifyPostechStatus(status: number): AiErrorCode {
  if (status === 401 || status === 403) return 'invalid-key';
  if (status === 402) return 'insufficient-quota';
  if (status === 429) return 'rate-limited';
  return 'provider';
}

async function readMessage(response: Response): Promise<string> {
  // 원인을 가릴 수 있게 상태 코드와 형식 문제만 로그에 남긴다. 본문과 키는 남기지 않는다.
  if (!response.ok) {
    console.error(`[postech] HTTP ${String(response.status)}`);
    throw new AiError(classifyPostechStatus(response.status));
  }
  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch (error) {
    // 끊긴 연결은 그대로 올리고, 형식이 다른 본문은 내용을 남기지 않고 제공사 오류로 본다.
    if (error instanceof SyntaxError) {
      console.error('[postech] 응답이 JSON이 아님');
      throw new AiError('provider');
    }
    throw error;
  }
  if (typeof parsed !== 'object' || parsed === null || !('message' in parsed) || typeof parsed.message !== 'string') {
    console.error('[postech] 응답에 message 글자가 없음');
    throw new AiError('provider');
  }
  // 서버가 HTTP 200으로 답하면서 message에 오류 표식을 담아 보낼 때가 있다. 답변으로 표시하거나 키 확인을 통과시키지 않는다.
  const inBandError = IN_BAND_ERROR.exec(parsed.message);
  if (inBandError !== null) {
    console.error(`[postech] 응답 안의 오류 코드 ${inBandError[1] ?? ''}`);
    throw new AiError('provider');
  }
  return parsed.message;
}

export class PostechProvider implements TutorProvider {
  private readonly fetch: typeof globalThis.fetch;
  private readonly timeoutMs: number;

  constructor(private readonly options: PostechProviderOptions) {
    this.fetch = options.fetch ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  }

  private post(apiKey: string, message: string, files: { id: string; name: string; url: string }[], signal: AbortSignal): Promise<Response> {
    return this.fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey },
      body: JSON.stringify({ message, stream: false, files }),
      // 다른 주소로 넘겨지면 키 헤더까지 따라가므로 넘겨받기를 거부한다.
      redirect: 'error',
      signal,
    });
  }

  async *stream(request: TutorProviderRequest, signal: AbortSignal): AsyncIterable<TutorProviderEvent> {
    const apiKey = await this.options.loadApiKey();
    if (apiKey === null) throw new AiError('invalid-key');

    const { areaImage } = request.context;
    const files = areaImage === null ? [] : [{ id: 'selected-area', name: 'selected-area.png', url: areaImage }];
    const timeout = AbortSignal.timeout(this.timeoutMs);
    let message: string;
    try {
      const response = await this.post(apiKey, buildMessage(request), files, AbortSignal.any([signal, timeout]));
      message = await readMessage(response);
    } catch (error) {
      if (timeout.aborted && !signal.aborted) throw new AiError('provider');
      throw error;
    }
    const parser = new AnswerParser(request.correction);
    yield* parser.feed(message);
    yield* parser.finish();
  }

  // 키만 확인하는 주소가 문서에 없어 짧은 메시지를 한 번 보낸다. 사용량을 조금 쓴다.
  async validateKey(apiKey: string): Promise<KeyCheckResult> {
    try {
      await readMessage(await this.post(apiKey, '확인', [], AbortSignal.timeout(VALIDATE_TIMEOUT_MS)));
      return 'ok';
    } catch (error) {
      const code = classifyFailure(error, new AbortController().signal);
      return code === 'cancelled' ? 'network' : code;
    }
  }
}
