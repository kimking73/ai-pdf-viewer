import { z } from 'zod';
import { IPC_CHANNELS, type IpcChannel } from './channels';

export const VersionComponent = z.enum(['app', 'electron', 'chromium']);

// 파일을 열 수 없는 이유. 경로와 원문 오류는 렌더러로 보내지 않는다.
const PdfRejectionReason = z.enum(['not-pdf', 'too-large', 'corrupt', 'unreadable']);
export type PdfRejectionReason = z.infer<typeof PdfRejectionReason>;

const PdfOpened = z.strictObject({
  status: z.literal('opened'),
  document: z.strictObject({ id: z.uuid(), name: z.string().min(1).max(1024) }),
});
const PdfCancelled = z.strictObject({ status: z.literal('cancelled') });
const PdfRejected = z.strictObject({ status: z.literal('rejected'), reason: PdfRejectionReason });

const PdfOpenResponse = z.discriminatedUnion('status', [PdfOpened, PdfCancelled, PdfRejected]);
export type PdfOpenResponse = z.infer<typeof PdfOpenResponse>;

const PATH_MAX_LENGTH = 4096;
const QUESTION_MAX_LENGTH = 8000;
const CORRECTION_MAX_LENGTH = 2000;
const MAX_PAGE_COUNT = 1_000_000;
const API_KEY_MAX_LENGTH = 512;

// 선택의 종류와 쪽만 메인으로 넘긴다. 선택한 글과 이미지는 실제 전송을 만들 때 다룬다.
const ScopeSelection = z.strictObject({
  kind: z.enum(['text', 'area']),
  page: z.int().min(1).max(MAX_PAGE_COUNT),
});

// 렌더러가 알리는 재료. 값이 서로 맞는지도 메인에서 확인한다.
const ScopeInput = z
  .strictObject({
    documentId: z.uuid(),
    currentPage: z.int().min(1).max(MAX_PAGE_COUNT),
    pageCount: z.int().min(1).max(MAX_PAGE_COUNT),
    selection: ScopeSelection.nullable(),
    // 기준 쪽에 쓸 만한 글자가 없어 쪽 전체를 이미지로 보낼지. 글자는 렌더러의 pdf.js만 읽을 수 있다.
    pageImage: z.boolean().optional(),
  })
  .refine(
    ({ currentPage, pageCount, selection }) =>
      currentPage <= pageCount && (selection === null || selection.page <= pageCount),
  );

// 메인이 확정한 전송 범위(docs/design-contract.md 3.3절). 화면 표시는 이 값에서만 만든다.
const SendScope = z.strictObject({
  basePage: z.int().min(1),
  firstPage: z.int().min(1),
  lastPage: z.int().min(1),
  currentPage: z.int().min(1),
  selection: ScopeSelection.nullable(),
  previousTurns: z.int().min(0),
  corrections: z.int().min(0),
  // 기준 쪽 전체를 이미지로 보내는지. 범위 표시에 그대로 나온다.
  pageImage: z.boolean().optional(),
  // 'fake'는 개발·E2E 전용이다. 패키징된 앱은 항상 실제 제공사를 쓴다.
  provider: z.enum(['fake', 'openai', 'postech']),
});
export type SendScope = z.infer<typeof SendScope>;
export type ScopeSelection = z.infer<typeof ScopeSelection>;

const PAGE_TEXT_MAX_LENGTH = 20_000;
const SELECTION_TEXT_MAX_LENGTH = 20_000;
const AREA_IMAGE_MAX_LENGTH = 16 * 1024 * 1024;
const CONTEXT_MAX_PAGES = 16;

// 실제로 보낼 내용. 메인이 확정한 범위에 맞는 것만 남겨 제공사로 보낸다.
const TutorContext = z.strictObject({
  pages: z
    .array(z.strictObject({ page: z.int().min(1).max(MAX_PAGE_COUNT), text: z.string().max(PAGE_TEXT_MAX_LENGTH) }))
    .max(CONTEXT_MAX_PAGES),
  selectionText: z.string().max(SELECTION_TEXT_MAX_LENGTH).nullable(),
  areaImage: z
    .string()
    .max(AREA_IMAGE_MAX_LENGTH)
    .regex(/^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/=]+$/)
    .nullable(),
  pageImage: z
    .string()
    .max(AREA_IMAGE_MAX_LENGTH)
    .regex(/^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/=]+$/)
    .nullable()
    .optional(),
});
export type TutorContext = z.infer<typeof TutorContext>;

const TutorAskRequest = z.discriminatedUnion('mode', [
  z.strictObject({
    mode: z.literal('new'),
    question: z.string().trim().min(1).max(QUESTION_MAX_LENGTH),
    scope: ScopeInput,
    context: TutorContext,
    // 문서 권한은 렌더러의 pdf.js가 읽는다. 거짓이면 메인이 전송을 거부한다.
    copyAllowed: z.boolean(),
  }),
  // 같은 범위로 다시 받는다. 고친 내용이 있으면 진행 중인 답변을 멈추고 새로 받는다.
  z.strictObject({
    mode: z.literal('again'),
    documentId: z.uuid(),
    requestId: z.uuid(),
    correction: z.string().trim().min(1).max(CORRECTION_MAX_LENGTH).nullable(),
  }),
]);
export type TutorAskRequest = z.infer<typeof TutorAskRequest>;

// 렌더러는 등록된 제공사 중에서만 고른다. 주소나 임의의 값을 넘길 수 없다.
const AiProviderId = z.enum(['openai', 'postech']);
export type AiProviderId = z.infer<typeof AiProviderId>;

// 키 확인 결과. 키 값과 원문 오류는 렌더러로 보내지 않는다.
const KeyStatus = z.enum(['stored', 'none', 'unreadable', 'unavailable']);
export type KeyStatus = z.infer<typeof KeyStatus>;

const KeySaveResponse = z.strictObject({
  result: z.enum(['saved', 'saved-low-balance', 'invalid-key', 'network', 'provider', 'storage-failed']),
});
export type KeySaveResponse = z.infer<typeof KeySaveResponse>;

// 모든 채널의 요청과 응답 스키마를 여기에 등록한다. 이 객체가 IPC 공개 범위의 전체 목록이다.
export const ipcContract = {
  [IPC_CHANNELS.appGetVersion]: {
    request: z.strictObject({ component: VersionComponent }),
    response: z.strictObject({ version: z.string().min(1) }),
  },
  [IPC_CHANNELS.pdfShowOpenDialog]: {
    request: z.strictObject({}),
    response: PdfOpenResponse,
  },
  // 끌어 놓은 파일의 경로. preload가 File 객체에서 얻으며, 메인이 다시 검사한다(docs/architecture.md 5절).
  [IPC_CHANNELS.pdfOpenDropped]: {
    request: z.strictObject({ path: z.string().min(1).max(PATH_MAX_LENGTH) }),
    response: z.discriminatedUnion('status', [PdfOpened, PdfRejected]),
  },
  // 경로 대신 메인이 발급한 불투명한 ID로만 읽는다.
  [IPC_CHANNELS.pdfReadDocument]: {
    request: z.strictObject({ id: z.uuid() }),
    response: z.discriminatedUnion('status', [
      z.strictObject({ status: z.literal('ok'), bytes: z.instanceof(Uint8Array) }),
      PdfRejected,
    ]),
  },
  // 경로 없이 파일명과 ID만 준다. 이 목록에 있는 파일만 ID로 다시 열 수 있다.
  [IPC_CHANNELS.pdfListRecent]: {
    request: z.strictObject({}),
    response: z.strictObject({
      documents: z.array(z.strictObject({ id: z.string().regex(/^[0-9a-f]{64}$/), name: z.string().min(1), openedAt: z.number() })),
    }),
  },
  [IPC_CHANNELS.pdfOpenRecent]: {
    request: z.strictObject({ id: z.string().regex(/^[0-9a-f]{64}$/) }),
    response: z.discriminatedUnion('status', [PdfOpened, PdfRejected]),
  },
  [IPC_CHANNELS.tutorResolveScope]: {
    request: ScopeInput,
    response: z.discriminatedUnion('status', [
      z.strictObject({ status: z.literal('ok'), scope: SendScope }),
      z.strictObject({ status: z.literal('no-document') }),
    ]),
  },
  [IPC_CHANNELS.tutorAsk]: {
    request: TutorAskRequest,
    response: z.discriminatedUnion('status', [
      z.strictObject({
        status: z.literal('started'),
        requestId: z.uuid(),
        question: z.string(),
        scope: SendScope,
      }),
      z.strictObject({ status: z.literal('busy') }),
      z.strictObject({ status: z.literal('no-document') }),
      z.strictObject({ status: z.literal('no-key') }),
      z.strictObject({ status: z.literal('blocked') }),
    ]),
  },
  [IPC_CHANNELS.tutorStop]: {
    request: z.strictObject({ requestId: z.uuid() }),
    response: z.strictObject({ stopped: z.boolean() }),
  },
  // 등록 여부만 돌려준다. 키 값이나 일부를 돌려주는 채널은 없다.
  [IPC_CHANNELS.keyGetStatus]: {
    request: z.strictObject({}),
    response: z.strictObject({
      // 지금 고른 제공사의 키 상태
      status: KeyStatus,
      provider: z.enum(['fake', 'openai', 'postech']),
      keys: z.strictObject({ openai: KeyStatus, postech: KeyStatus }),
    }),
  },
  [IPC_CHANNELS.keySave]: {
    // 인쇄 가능한 ASCII만 받아 요청 헤더에 줄바꿈이 끼어들지 못하게 한다.
    request: z.strictObject({ provider: AiProviderId, apiKey: z.string().trim().min(1).max(API_KEY_MAX_LENGTH).regex(/^[\x21-\x7e]+$/) }),
    response: KeySaveResponse,
  },
  [IPC_CHANNELS.keyDelete]: {
    request: z.strictObject({ provider: AiProviderId }),
    response: z.strictObject({ status: KeyStatus }),
  },
  [IPC_CHANNELS.providerSet]: {
    request: z.strictObject({ provider: AiProviderId }),
    response: z.strictObject({}),
  },
  [IPC_CHANNELS.settingsOpen]: {
    // 튜터의 [키 설정]에서 열었으면 닫을 때 입력창으로 포커스를 돌려준다(계약 4.5절).
    request: z.strictObject({ returnFocus: z.boolean() }),
    response: z.strictObject({}),
  },
} as const satisfies Record<IpcChannel, { request: z.ZodType; response: z.ZodType }>;

export type IpcRequest<C extends IpcChannel> = z.infer<(typeof ipcContract)[C]['request']>;
export type IpcResponse<C extends IpcChannel> = z.infer<(typeof ipcContract)[C]['response']>;

export type IpcErrorCode = 'FORBIDDEN' | 'INVALID_INPUT' | 'INTERNAL';

// 오류는 코드만 건넨다. 메시지, 스택, 경로 같은 내부 정보는 렌더러로 보내지 않는다.
export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: { code: IpcErrorCode } };

// 문단의 출처. 'plain'은 보낸 범위 밖 쪽 번호라 눌러서 이동할 수 없는 글자로 둔 경우다(계약 4.8절).
export type ParagraphSource =
  | { kind: 'page'; page: number }
  | { kind: 'general' }
  | { kind: 'plain'; text: string };

export interface RecapSegment {
  text: string;
  uncertain: boolean;
}

// 제공사와 무관한 공통 오류 코드(docs/architecture.md 4절, 계약 4.11절). 렌더러는 이 코드만 받는다.
export type AiErrorCode = 'invalid-key' | 'insufficient-quota' | 'rate-limited' | 'network' | 'provider';

// 메인이 렌더러로 보내는 답변 진행 알림.
export type TutorEvent = { requestId: string } & (
  | { type: 'recap'; segments: RecapSegment[]; correction: string | null }
  | { type: 'delta'; paragraph: number; text: string }
  | { type: 'paragraph-end'; paragraph: number; source: ParagraphSource }
  | { type: 'done' }
  | { type: 'stopped' }
  | { type: 'error'; code: AiErrorCode }
);
