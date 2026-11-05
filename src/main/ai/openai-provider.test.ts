import { describe, expect, it } from 'vitest';
import type { TutorProviderEvent, TutorProviderRequest } from '../tutor/provider';
import { AiError } from './ai-error';
import { OpenAiProvider } from './openai-provider';

const KEY = 'test-key-value-1234';
const request: TutorProviderRequest = {
  question: '이게 뭔가요',
  scope: { basePage: 2, firstPage: 1, lastPage: 3, currentPage: 2, selection: null, previousTurns: 1, corrections: 1, provider: 'openai' },
  correction: null,
  corrections: ['첨자는 j'],
  history: [{ question: '이전 질문', answer: '이전 답' }],
  context: { pages: [{ page: 2, text: '쪽 본문' }], selectionText: '선택 글', areaImage: 'data:image/png;base64,AAAA' },
};

function sse(events: unknown[]): string {
  return events.map((event) => `event: x\ndata: ${JSON.stringify(event)}\n\n`).join('');
}

function setup(respond: (signal: AbortSignal) => Response | Promise<Response>, loadKey: string | null = KEY) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = ((url: string, init: RequestInit) => {
    calls.push({ url, init });
    return Promise.resolve(respond(init.signal as AbortSignal));
  }) as typeof globalThis.fetch;
  const provider = new OpenAiProvider({ loadApiKey: () => Promise.resolve(loadKey), fetch, idleTimeoutMs: 20 });
  return { provider, calls };
}

async function collect(provider: OpenAiProvider): Promise<TutorProviderEvent[]> {
  const events: TutorProviderEvent[] = [];
  for await (const event of provider.stream(request, new AbortController().signal)) events.push(event);
  return events;
}

const failure = (error: unknown): unknown => (error instanceof AiError ? error.code : error);

describe('OpenAiProvider.stream', () => {
  it('고정된 주소로 키와 범위 안의 내용만 보내고 저장하지 않게 요청한다', async () => {
    const { provider, calls } = setup(() => new Response(sse([{ type: 'response.completed' }])));
    await collect(provider);
    const call = calls[0];
    expect(call?.url).toBe('https://api.openai.com/v1/responses');
    expect(new Headers(call?.init.headers).get('authorization')).toBe(`Bearer ${KEY}`);
    const body = JSON.parse(call?.init.body as string) as { store: boolean; stream: boolean; input: { role: string }[] };
    expect(body).toMatchObject({ store: false, stream: true });
    expect(body.input.map(({ role }) => role)).toEqual(['user', 'assistant', 'user']);
    const last = JSON.stringify(body.input.at(-1));
    for (const expected of ['쪽 본문', '선택 글', '첨자는 j', '이게 뭔가요', 'input_image']) expect(last).toContain(expected);
  });

  it('조각으로 나뉜 줄과 글자를 이어 답변으로 바꾼다', async () => {
    const text = sse([
      { type: 'response.created' },
      { type: 'response.output_text.delta', delta: '답입니다. [근' },
      { type: 'response.output_text.delta', delta: '거 p.2]' },
      { type: 'response.completed' },
    ]);
    const bytes = new TextEncoder().encode(text);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let start = 0; start < bytes.length; start += 5) controller.enqueue(bytes.slice(start, start + 5));
        controller.close();
      },
    });
    const { provider } = setup(() => new Response(body));
    await expect(collect(provider)).resolves.toEqual([
      { type: 'delta', paragraph: 0, text: '답입니다.' },
      { type: 'paragraph-end', paragraph: 0, source: { kind: 'page', page: 2 } },
    ]);
  });

  it.each([
    [401, { error: { code: 'invalid_api_key' } }, 'invalid-key'],
    [429, { error: { code: 'credit_balance_exhausted' } }, 'insufficient-quota'],
    [429, { error: { code: 'slow_down' } }, 'rate-limited'],
    [500, {}, 'provider'],
  ])('HTTP %i 응답을 공통 코드로 바꾼다', async (status, body, expected) => {
    const { provider } = setup(() => new Response(JSON.stringify(body), { status }));
    await expect(collect(provider).catch(failure)).resolves.toBe(expected);
  });

  it.each([
    [{ type: 'response.failed', response: { error: { code: 'rate_limit_exceeded' } } }, 'rate-limited'],
    [{ type: 'response.failed', response: { error: null } }, 'provider'],
    [{ type: 'error', code: 'server_error' }, 'provider'],
  ])('스트림 도중 실패 %j', async (event, expected) => {
    const { provider } = setup(() => new Response(sse([event])));
    await expect(collect(provider).catch(failure)).resolves.toBe(expected);
  });

  it('끝 표시 없이 끊기면 네트워크 오류다', async () => {
    const { provider } = setup(() => new Response(sse([{ type: 'response.output_text.delta', delta: '중간' }])));
    await expect(collect(provider).catch(failure)).resolves.toBe('network');
  });

  it('잘린 답변은 받은 부분을 내보낸다', async () => {
    const { provider } = setup(() => new Response(sse([{ type: 'response.output_text.delta', delta: '중간' }, { type: 'response.incomplete' }])));
    await expect(collect(provider)).resolves.toEqual([{ type: 'delta', paragraph: 0, text: '중간' }]);
  });

  it('응답이 오래 멈추면 제공사 오류다', async () => {
    const { provider } = setup(
      (signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
        }),
    );
    await expect(collect(provider).catch(failure)).resolves.toBe('provider');
  });

  it('키가 없으면 요청을 보내지 않는다', async () => {
    const { provider, calls } = setup(() => new Response(''), null);
    await expect(collect(provider).catch(failure)).resolves.toBe('invalid-key');
    expect(calls).toEqual([]);
  });
});

describe('OpenAiProvider.validateKey', () => {
  it.each([
    [200, 'ok'],
    [401, 'invalid-key'],
    [500, 'provider'],
  ])('HTTP %i -> %s', async (status, expected) => {
    const { provider, calls } = setup(() => new Response('{}', { status }));
    await expect(provider.validateKey(KEY)).resolves.toBe(expected);
    expect(calls[0]?.url).toBe('https://api.openai.com/v1/models');
  });

  it('연결 실패는 네트워크 문제다', async () => {
    const fetch = (() => Promise.reject(new TypeError('fetch failed'))) as typeof globalThis.fetch;
    const provider = new OpenAiProvider({ loadApiKey: () => Promise.resolve(KEY), fetch });
    await expect(provider.validateKey(KEY)).resolves.toBe('network');
  });
});
