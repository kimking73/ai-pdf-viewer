import { describe, expect, it } from 'vitest';
import type { TutorProviderEvent, TutorProviderRequest } from '../tutor/provider';
import { AiError } from './ai-error';
import { PostechProvider } from './postech-provider';

const KEY = 'test-key-value-1234';
const IMAGE = 'data:image/png;base64,AAAA';
const request: TutorProviderRequest = {
  question: '이게 뭔가요',
  scope: { basePage: 2, firstPage: 1, lastPage: 3, currentPage: 2, selection: null, previousTurns: 1, corrections: 1, provider: 'postech' },
  correction: null,
  corrections: ['첨자는 j'],
  history: [{ question: '이전 질문', answer: '이전 답' }],
  context: { pages: [{ page: 2, text: '쪽 본문' }], selectionText: '선택 글', areaImage: IMAGE },
};

function setup(respond: (signal: AbortSignal) => Response | Promise<Response>, loadKey: string | null = KEY) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = ((url: string, init: RequestInit) => {
    calls.push({ url, init });
    return Promise.resolve(respond(init.signal as AbortSignal));
  }) as typeof globalThis.fetch;
  const provider = new PostechProvider({ loadApiKey: () => Promise.resolve(loadKey), fetch, timeoutMs: 20 });
  return { provider, calls };
}

async function collect(provider: PostechProvider, signal = new AbortController().signal): Promise<TutorProviderEvent[]> {
  const events: TutorProviderEvent[] = [];
  for await (const event of provider.stream(request, signal)) events.push(event);
  return events;
}

const failure = (error: unknown): unknown => (error instanceof AiError ? error.code : error);
const reply = (message: unknown): Response => new Response(JSON.stringify({ message }));

describe('PostechProvider.stream', () => {
  it('고정된 주소로 키 헤더와 범위 안의 내용을 보내고, 넘겨받기를 거부한다', async () => {
    const { provider, calls } = setup(() => reply('답'));
    await collect(provider);
    const call = calls[0];
    expect(call?.url).toBe('https://genai.postech.ac.kr/agent/api/a1/gpt');
    expect(call?.init.redirect).toBe('error');
    expect(new Headers(call?.init.headers).get('x-api-key')).toBe(KEY);
    const body = JSON.parse(call?.init.body as string) as { message: string; stream: boolean; files: { url: string }[] };
    expect(body.stream).toBe(false);
    expect(body.files.map(({ url }) => url)).toEqual([IMAGE]);
    for (const expected of ['쪽 본문', '선택 글', '첨자는 j', '이게 뭔가요', '이전 질문', '이전 답']) expect(body.message).toContain(expected);
    expect(body.message).not.toContain(KEY);
  });

  it('답변을 문단과 근거로 바꾼다', async () => {
    const { provider } = setup(() => reply('답입니다. [근거 p.2]\n\n둘째'));
    await expect(collect(provider)).resolves.toEqual([
      { type: 'delta', paragraph: 0, text: '답입니다.' },
      { type: 'paragraph-end', paragraph: 0, source: { kind: 'page', page: 2 } },
      { type: 'delta', paragraph: 1, text: '둘째' },
    ]);
  });

  it.each([
    [401, 'invalid-key'],
    [403, 'invalid-key'],
    [402, 'insufficient-quota'],
    [429, 'rate-limited'],
    [500, 'provider'],
  ])('HTTP %i -> %s', async (status, expected) => {
    const { provider } = setup(() => new Response('{}', { status }));
    await expect(collect(provider).catch(failure)).resolves.toBe(expected);
  });

  it('HTTP 200이어도 message의 오류 표식은 답변으로 내보내지 않는다', async () => {
    const { provider } = setup(() => reply('<div cls="error" attr="10000"></div>'));
    await expect(collect(provider).catch(failure)).resolves.toBe('provider');
  });

  it('오류 표식이 들어 있어도 키 확인을 통과시키지 않는다', async () => {
    const { provider } = setup(() => reply('<div cls="error" attr="10000"></div>'));
    await expect(provider.validateKey(KEY)).resolves.toBe('provider');
  });

  it('본문 설명 안의 div는 답변으로 둔다', async () => {
    const { provider } = setup(() => reply('태그 <div cls="error" attr="1"></div> 설명입니다.'));
    await expect(collect(provider)).resolves.toEqual([{ type: 'delta', paragraph: 0, text: '태그 <div cls="error" attr="1"></div> 설명입니다.' }]);
  });

  it.each(['<html>', '{}', '{"message":1}'])('형식이 다른 본문 %s은 제공사 오류다', async (text) => {
    const { provider } = setup(() => new Response(text));
    await expect(collect(provider).catch(failure)).resolves.toBe('provider');
  });

  it('시간이 초과되면 제공사 오류다', async () => {
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
    const { provider, calls } = setup(() => reply('답'), null);
    await expect(collect(provider).catch(failure)).resolves.toBe('invalid-key');
    expect(calls).toEqual([]);
  });
});

describe('PostechProvider.validateKey', () => {
  it.each([
    [200, 'ok'],
    [401, 'invalid-key'],
    [429, 'rate-limited'],
    [500, 'provider'],
  ])('HTTP %i -> %s', async (status, expected) => {
    const { provider, calls } = setup(() => new Response(JSON.stringify({ message: '네' }), { status }));
    await expect(provider.validateKey(KEY)).resolves.toBe(expected);
    expect(calls[0]?.url).toBe('https://genai.postech.ac.kr/agent/api/a1/gpt');
  });

  it('연결 실패는 네트워크 문제다', async () => {
    const fetch = (() => Promise.reject(new TypeError('fetch failed'))) as typeof globalThis.fetch;
    const provider = new PostechProvider({ loadApiKey: () => Promise.resolve(KEY), fetch });
    await expect(provider.validateKey(KEY)).resolves.toBe('network');
  });
});
