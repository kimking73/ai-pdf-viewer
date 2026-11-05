import { describe, expect, it, vi } from 'vitest';
import type { SendScope, TutorEvent } from '../../shared/ipc/contract';
import { fakeTutorProvider } from './fake-provider';
import type { TutorProvider } from './provider';
import { sanitizeSource } from './provider';
import { formatFrozenScope, formatScopeLine } from '../../shared/send-scope-format';
import { fitContextToScope, resolveSendScope } from './send-scope';
import { TutorService } from './tutor-service';

const DOC = '00000000-0000-4000-8000-000000000001';
const OTHER = '00000000-0000-4000-8000-000000000002';
const material = { documentId: DOC, currentPage: 5, pageCount: 10, selection: null };
const context = { pages: [], selectionText: null, areaImage: null };
const newRequest = { mode: 'new', question: '질문', context, copyAllowed: true } as const;

describe('resolveSendScope', () => {
  it('기준 쪽과 앞뒤 1쪽을 고른다', () => {
    expect(resolveSendScope({ currentPage: 5, pageCount: 10, selection: null }, 0, 0)).toMatchObject({
      basePage: 5,
      firstPage: 4,
      lastPage: 6,
    });
  });

  it('문서 경계에서 잘린다', () => {
    expect(resolveSendScope({ currentPage: 1, pageCount: 10, selection: null }, 0, 0)).toMatchObject({ firstPage: 1, lastPage: 2 });
    expect(resolveSendScope({ currentPage: 10, pageCount: 10, selection: null }, 0, 0)).toMatchObject({ firstPage: 9, lastPage: 10 });
    expect(resolveSendScope({ currentPage: 1, pageCount: 1, selection: null }, 0, 0)).toMatchObject({ firstPage: 1, lastPage: 1 });
  });

  it('선택이 있으면 선택 쪽이 기준이다', () => {
    const scope = resolveSendScope({ currentPage: 9, pageCount: 10, selection: { kind: 'area', page: 3 } }, 0, 0);
    expect(scope).toMatchObject({ basePage: 3, firstPage: 2, lastPage: 4, currentPage: 9 });
  });

  it('이전 대화 수는 상한을 넘지 않는다', () => {
    expect(resolveSendScope({ currentPage: 1, pageCount: 1, selection: null }, 99, 1)).toMatchObject({ previousTurns: 4, corrections: 1 });
  });
});

describe('쪽 이미지', () => {
  const image = 'data:image/png;base64,AAAA';
  const base = { currentPage: 5, pageCount: 10 };

  it('고른 것이 없을 때만 범위에 들어가고, 영역을 고르면 빠진다', () => {
    expect(resolveSendScope({ ...base, selection: null, pageImage: true }, 0, 0).pageImage).toBe(true);
    expect(resolveSendScope({ ...base, selection: { kind: 'area', page: 5 }, pageImage: true }, 0, 0).pageImage).toBeUndefined();
    expect(resolveSendScope({ ...base, selection: null }, 0, 0).pageImage).toBeUndefined();
  });

  it('범위에 없으면 렌더러가 보낸 이미지를 버린다', () => {
    const scope = resolveSendScope({ ...base, selection: null }, 0, 0);
    expect(fitContextToScope({ pages: [], selectionText: null, areaImage: null, pageImage: image }, scope).pageImage).toBeUndefined();
  });

  it('범위에 있으면 이미지를 남긴다', () => {
    const scope = resolveSendScope({ ...base, selection: null, pageImage: true }, 0, 0);
    expect(fitContextToScope({ pages: [], selectionText: null, areaImage: null, pageImage: image }, scope).pageImage).toBe(image);
  });

  it('범위 문구에 쪽 이미지를 적는다', () => {
    const scope = resolveSendScope({ ...base, selection: null, pageImage: true }, 0, 0);
    expect(formatScopeLine(scope)).toBe('p.4~6 · p.5 쪽 이미지');
    expect(formatFrozenScope(scope)).toBe('확정 범위: p.4~6 · p.5 쪽 이미지 · OpenAI로 전송');
  });

  it('이미지를 받은 질문만 표시하고 제공사로 넘긴다', async () => {
    const seen: (string | null | undefined)[] = [];
    const service = new TutorService({
      provider: {
        stream: (request) => {
          seen.push(request.context.pageImage);
          return fakeTutorProvider.stream(request, new AbortController().signal);
        },
      },
      getProviderId: () => 'openai',
      hasKey: () => Promise.resolve(true),
      isIssuedDocument: () => true,
      send: vi.fn(),
    });
    const scope = { ...material, pageImage: true };
    const missing = await service.ask({ ...newRequest, scope, context });
    expect(missing).toMatchObject({ status: 'started' });
    if (missing.status === 'started') {
      expect(missing.scope.pageImage).toBeUndefined();
      service.stop(missing.requestId);
    }
    await vi.waitFor(async () => {
      const sent = await service.ask({ ...newRequest, scope, context: { ...context, pageImage: image } });
      expect(sent).toMatchObject({ status: 'started', scope: { pageImage: true } });
    });
    expect(seen.at(-1)).toBe(image);
  });
});

describe('sanitizeSource', () => {
  const scope: SendScope = { basePage: 5, firstPage: 4, lastPage: 6, currentPage: 5, selection: null, previousTurns: 0, corrections: 0, provider: 'fake' };

  it('범위 안의 쪽만 근거로 남긴다', () => {
    expect(sanitizeSource({ kind: 'page', page: 6 }, scope)).toEqual({ kind: 'page', page: 6 });
    expect(sanitizeSource({ kind: 'page', page: 7 }, scope)).toEqual({ kind: 'plain', text: 'p.7' });
    expect(sanitizeSource({ kind: 'general' }, scope)).toEqual({ kind: 'general' });
  });
});

// 신호를 받을 때까지 끝나지 않는 제공사. 진행 중 상태를 시험한다.
const hangingProvider: TutorProvider = {
  async *stream(_request, signal) {
    yield await Promise.resolve({ type: 'delta' as const, paragraph: 0, text: 'x' });
    await new Promise<void>((resolve) => {
      signal.addEventListener('abort', () => {
        resolve();
      });
    });
  },
};

const spyOnHanging = () => vi.fn<TutorProvider['stream']>((request, signal) => hangingProvider.stream(request, signal));

function setup(provider: TutorProvider = hangingProvider, hasKey = true) {
  const events: TutorEvent[] = [];
  const service = new TutorService({
    provider,
    getProviderId: () => 'fake',
    hasKey: () => Promise.resolve(hasKey),
    isIssuedDocument: (id) => id === DOC || id === OTHER,
    send: (event) => events.push(event),
  });
  return { service, events };
}

async function askNew(service: TutorService, documentId = DOC) {
  const response = await service.ask({ ...newRequest, scope: { ...material, documentId } });
  if (response.status !== 'started') throw new Error(`시작하지 못했다: ${response.status}`);
  return response;
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('TutorService', () => {
  it('발급하지 않은 문서는 거부한다', async () => {
    const { service } = setup();
    expect(service.resolveScope({ ...material, documentId: '00000000-0000-4000-8000-000000000009' })).toEqual({ status: 'no-document' });
    await expect(
      service.ask({ ...newRequest, scope: { ...material, documentId: '00000000-0000-4000-8000-000000000009' } }),
    ).resolves.toEqual({ status: 'no-document' });
  });

  it('한 번에 한 턴만 진행한다', async () => {
    const { service } = setup();
    await askNew(service);
    await expect(service.ask({ ...newRequest, question: '다음', scope: material })).resolves.toEqual({ status: 'busy' });
  });

  it('중지하면 stopped를 보내고 다음 질문을 받는다', async () => {
    const { service, events } = setup();
    const { requestId } = await askNew(service);
    expect(service.stop('00000000-0000-4000-8000-00000000000f')).toBe(false);
    expect(service.stop(requestId)).toBe(true);
    await tick();
    expect(events.at(-1)).toEqual({ requestId, type: 'stopped' });
    await expect(askNew(service)).resolves.toMatchObject({ status: 'started' });
  });

  it('턴이 끝나면 다음 범위에 이전 대화가 포함되고 문서가 바뀌면 새로 시작한다', async () => {
    const { service } = setup();
    const { requestId } = await askNew(service);
    await tick();
    service.stop(requestId);
    await tick();
    expect(service.resolveScope(material)).toMatchObject({ scope: { previousTurns: 1 } });
    expect(service.resolveScope({ ...material, documentId: OTHER })).toMatchObject({ scope: { previousTurns: 0 } });
  });

  it('다시 받기는 그때의 범위를 그대로 쓰고 고친 내용 수를 늘린다', async () => {
    const { service } = setup();
    const first = await askNew(service);
    service.stop(first.requestId);
    await tick();

    const again = await service.ask({ mode: 'again', documentId: DOC, requestId: first.requestId, correction: null });
    expect(again).toMatchObject({ status: 'started', question: '질문', scope: { firstPage: 4, lastPage: 6, corrections: 0 } });

    // 고친 내용은 진행 중인 답변을 멈추고 시작한다.
    const corrected = await service.ask({ mode: 'again', documentId: DOC, requestId: first.requestId, correction: '첨자가 j입니다' });
    expect(corrected).toMatchObject({ status: 'started', scope: { firstPage: 4, lastPage: 6, corrections: 1 } });
    expect(service.resolveScope(material)).toMatchObject({ scope: { corrections: 1 } });
  });

  it('고치기 요청이 겹쳐도 답변은 하나만 시작하고 고친 내용도 하나만 쌓인다', async () => {
    const { service } = setup();
    const first = await askNew(service);
    const request = { mode: 'again', documentId: DOC, requestId: first.requestId } as const;
    const results = await Promise.all([
      service.ask({ ...request, correction: '첫째' }),
      service.ask({ ...request, correction: '둘째' }),
    ]);
    expect(results.map(({ status }) => status).sort()).toEqual(['busy', 'started']);
    expect(service.resolveScope(material)).toMatchObject({ scope: { corrections: 1 } });

    // 시작된 답변을 멈출 수 있어야 한다.
    const started = results.find((result) => result.status === 'started');
    if (started?.status !== 'started') throw new Error('시작되지 않았다');
    expect(service.stop(started.requestId)).toBe(true);
  });

  it('고치기를 기다리는 사이 창이 닫히면 새 답변을 시작하지 않는다', async () => {
    const { service, events } = setup();
    const first = await askNew(service);
    const pending = service.ask({ mode: 'again', documentId: DOC, requestId: first.requestId, correction: '고침' });
    service.reset();
    await expect(pending).resolves.toEqual({ status: 'no-document' });
    await tick();
    expect(new Set(events.map(({ requestId }) => requestId))).toEqual(new Set([first.requestId]));
  });

  it('제공사가 중단 오류를 던져도 stopped로 알리고 로그를 남기지 않는다', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const throwing: TutorProvider = {
      // eslint-disable-next-line require-yield
      async *stream(_request, signal) {
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
        });
      },
    };
    const { service, events } = setup(throwing);
    const { requestId } = await askNew(service);
    service.stop(requestId);
    await tick();
    expect(events).toEqual([{ requestId, type: 'stopped' }]);
    expect(logged).not.toHaveBeenCalled();
    logged.mockRestore();
  });

  it('키가 없으면 아무것도 보내지 않는다', async () => {
    const stream = spyOnHanging();
    const { service } = setup({ stream }, false);
    await expect(service.ask({ ...newRequest, scope: material })).resolves.toEqual({ status: 'no-key' });
    expect(stream).not.toHaveBeenCalled();
  });

  it('복사 금지 문서는 메인에서 전송을 막는다', async () => {
    const stream = spyOnHanging();
    const { service } = setup({ stream });
    await expect(service.ask({ ...newRequest, copyAllowed: false, scope: material })).resolves.toEqual({ status: 'blocked' });
    expect(stream).not.toHaveBeenCalled();
  });

  it('범위 밖 쪽과 선택 종류가 맞지 않는 내용은 제공사로 보내지 않는다', async () => {
    const stream = spyOnHanging();
    const { service } = setup({ stream });
    await service.ask({
      ...newRequest,
      scope: material,
      context: {
        pages: [3, 4, 5, 6, 7].map((page) => ({ page, text: `쪽${String(page)}` })),
        selectionText: '선택 없음',
        areaImage: 'data:image/png;base64,AAAA',
      },
    });
    expect(stream.mock.calls[0]?.[0].context).toEqual({
      pages: [4, 5, 6].map((page) => ({ page, text: `쪽${String(page)}` })),
      selectionText: null,
      areaImage: null,
    });
  });

  it('이전 대화와 고친 내용을 다음 질문에 싣고, 다시 받기에는 같은 내용을 쓴다', async () => {
    const stream = spyOnHanging();
    const { service } = setup({ stream });
    const pageContext = { ...context, pages: [{ page: 5, text: '본문' }] };
    const first = await service.ask({ ...newRequest, scope: material, context: pageContext });
    if (first.status !== 'started') throw new Error('시작되지 않았다');
    await tick();
    service.stop(first.requestId);
    await tick();

    const again = await service.ask({ mode: 'again', documentId: DOC, requestId: first.requestId, correction: '고침' });
    if (again.status !== 'started') throw new Error('시작되지 않았다');
    expect(stream.mock.calls[1]?.[0]).toMatchObject({ correction: '고침', corrections: ['고침'], context: pageContext });
    await tick();
    service.stop(again.requestId);
    await tick();

    await service.ask({ ...newRequest, question: '후속', scope: material });
    expect(stream.mock.calls[2]?.[0]).toMatchObject({
      correction: null,
      corrections: ['고침'],
      history: [
        { question: '질문', answer: 'x' },
        { question: '질문', answer: 'x' },
      ],
    });
  });

  it('받은 글자가 없는 답변은 이전 대화로 세지 않는다', async () => {
    const empty: TutorProvider = {
      // eslint-disable-next-line require-yield
      async *stream() {
        await Promise.resolve();
      },
    };
    const { service } = setup(empty);
    await askNew(service);
    await tick();
    expect(service.resolveScope(material)).toMatchObject({ scope: { previousTurns: 0 } });
  });

  it('알 수 없는 요청은 다시 받을 수 없다', async () => {
    const { service } = setup();
    await expect(
      service.ask({ mode: 'again', documentId: DOC, requestId: OTHER, correction: null }),
    ).resolves.toEqual({ status: 'no-document' });
  });

  it('제공사 오류는 메시지 없이 error로 알린다', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const failing: TutorProvider = {
      // eslint-disable-next-line require-yield
      async *stream() {
        await Promise.resolve();
        throw new TypeError('secret-key-value');
      },
    };
    const { service, events } = setup(failing);
    const { requestId } = await askNew(service);
    await tick();
    expect(events).toEqual([{ requestId, type: 'error', code: 'provider' }]);
    expect(JSON.stringify(logged.mock.calls)).not.toContain('secret-key-value');
    logged.mockRestore();
  });

  it('가짜 응답은 가짜임을 밝히고 범위 밖 근거를 글자로 바꾼다', async () => {
    const { service, events } = setup(fakeTutorProvider);
    const response = await service.ask({
      ...newRequest,
      question: '이 수식이 뭔가요',
      scope: { ...material, selection: { kind: 'area', page: 5 } },
    });
    expect(response.status).toBe('started');
    await vi.waitFor(
      () => {
        expect(events.at(-1)?.type).toBe('done');
      },
      { timeout: 10_000, interval: 50 },
    );
    expect(events[0]?.type).toBe('recap');
    const text = events.flatMap((event) => (event.type === 'delta' ? [event.text] : [])).join('');
    expect(text).toContain('[가짜 응답]');
    const sources = events.flatMap((event) => (event.type === 'paragraph-end' ? [event.source] : []));
    expect(sources).toEqual([{ kind: 'page', page: 5 }, { kind: 'general' }, { kind: 'plain', text: 'p.56' }]);
  }, 15_000);
});
