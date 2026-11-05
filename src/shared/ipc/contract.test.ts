import { describe, expect, it } from 'vitest';
import { IPC_CHANNELS } from './channels';
import { ipcContract } from './contract';

describe('app:get-version 계약', () => {
  const { request } = ipcContract[IPC_CHANNELS.appGetVersion];

  it('허용된 component를 받는다', () => {
    expect(request.safeParse({ component: 'app' }).success).toBe(true);
  });

  it.each([
    ['목록에 없는 값', { component: 'node' }],
    ['잘못된 타입', { component: 1 }],
    ['누락', {}],
    ['추가 필드', { component: 'app', path: '/etc/passwd' }],
    ['객체가 아닌 값', 'app'],
    ['null', null],
  ])('%s은 거부한다', (_name, input) => {
    expect(request.safeParse(input).success).toBe(false);
  });
});

describe('PDF 채널 계약', () => {
  const dropped = ipcContract[IPC_CHANNELS.pdfOpenDropped].request;
  const read = ipcContract[IPC_CHANNELS.pdfReadDocument].request;
  const dialog = ipcContract[IPC_CHANNELS.pdfShowOpenDialog].request;

  it('열기 대화상자는 입력을 받지 않는다', () => {
    expect(dialog.safeParse({}).success).toBe(true);
    expect(dialog.safeParse({ defaultPath: '/etc' }).success).toBe(false);
  });

  it.each([
    ['빈 경로', { path: '' }],
    ['너무 긴 경로', { path: `/${'a'.repeat(5000)}` }],
    ['문자열이 아닌 경로', { path: 1 }],
    ['추가 필드', { path: '/a.pdf', offset: 0 }],
  ])('끌어 놓기에서 %s은 거부한다', (_name, input) => {
    expect(dropped.safeParse(input).success).toBe(false);
  });

  it.each([
    ['경로', { id: '/etc/passwd' }],
    ['UUID가 아닌 값', { id: '1' }],
    ['추가 필드', { id: '00000000-0000-4000-8000-000000000000', path: '/etc/passwd' }],
  ])('문서 읽기에서 %s은 거부한다', (_name, input) => {
    expect(read.safeParse(input).success).toBe(false);
  });

  it('문서 읽기는 문서 ID만 받는다', () => {
    expect(read.safeParse({ id: '00000000-0000-4000-8000-000000000000' }).success).toBe(true);
  });
});

describe('튜터 채널 계약', () => {
  const id = '00000000-0000-4000-8000-000000000000';
  const scope = { documentId: id, currentPage: 2, pageCount: 3, selection: null };
  const resolve = ipcContract[IPC_CHANNELS.tutorResolveScope].request;
  const ask = ipcContract[IPC_CHANNELS.tutorAsk].request;

  it('맞는 재료를 받는다', () => {
    expect(resolve.safeParse(scope).success).toBe(true);
    expect(resolve.safeParse({ ...scope, selection: { kind: 'area', page: 3 } }).success).toBe(true);
    expect(ask.safeParse({ mode: 'new', question: '질문', scope, context: { pages: [{ page: 1, text: '본문' }], selectionText: null, areaImage: null }, copyAllowed: true }).success).toBe(true);
    expect(ask.safeParse({ mode: 'again', documentId: id, requestId: id, correction: null }).success).toBe(true);
  });

  it.each([
    ['문서보다 큰 현재 쪽', { ...scope, currentPage: 4 }],
    ['문서보다 큰 선택 쪽', { ...scope, selection: { kind: 'text', page: 9 } }],
    ['0쪽', { ...scope, currentPage: 0 }],
    ['소수 쪽', { ...scope, currentPage: 1.5 }],
    ['모르는 선택 종류', { ...scope, selection: { kind: 'file', page: 1 } }],
    ['렌더러가 정한 범위', { ...scope, firstPage: 1 }],
    ['렌더러가 정한 제공사', { ...scope, provider: 'https://evil.example' }],
  ])('범위 재료에서 %s은 거부한다', (_name, input) => {
    expect(resolve.safeParse(input).success).toBe(false);
  });

  it.each([
    ['빈 질문', { mode: 'new', question: '   ', scope }],
    ['너무 긴 질문', { mode: 'new', question: 'a'.repeat(8001), scope }],
    ['모르는 방식', { mode: 'all', question: '질문', scope }],
    ['추가 필드', { mode: 'new', question: '질문', scope, apiKey: 'x' }],
    ['빈 고친 내용', { mode: 'again', documentId: id, requestId: id, correction: ' ' }],
  ])('질문에서 %s은 거부한다', (_name, input) => {
    expect(ask.safeParse(input).success).toBe(false);
  });
});
