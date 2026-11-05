import type { IPC_CHANNELS } from './channels';
import type { IpcRequest, IpcResponse, IpcResult, TutorEvent } from './contract';
import type { MenuCommand } from './menu-commands';

type GetVersion = typeof IPC_CHANNELS.appGetVersion;
type ShowOpenDialog = typeof IPC_CHANNELS.pdfShowOpenDialog;
type OpenDropped = typeof IPC_CHANNELS.pdfOpenDropped;
type ReadDocument = typeof IPC_CHANNELS.pdfReadDocument;
type ListRecent = typeof IPC_CHANNELS.pdfListRecent;
type OpenRecent = typeof IPC_CHANNELS.pdfOpenRecent;
type ResolveScope = typeof IPC_CHANNELS.tutorResolveScope;
type TutorAsk = typeof IPC_CHANNELS.tutorAsk;
type TutorStop = typeof IPC_CHANNELS.tutorStop;
type KeyGetStatus = typeof IPC_CHANNELS.keyGetStatus;
type KeySave = typeof IPC_CHANNELS.keySave;
type KeyDelete = typeof IPC_CHANNELS.keyDelete;
type ProviderSet = typeof IPC_CHANNELS.providerSet;
type SettingsOpen = typeof IPC_CHANNELS.settingsOpen;

// 렌더러가 볼 수 있는 API의 전부. preload가 이 타입대로 window.api를 노출한다.
export interface RendererApi {
  getVersion(request: IpcRequest<GetVersion>): Promise<IpcResult<IpcResponse<GetVersion>>>;
  /** 메인의 파일 선택 대화상자를 연다. 렌더러는 경로를 넘기지도 받지도 않는다. */
  openPdfDialog(): Promise<IpcResult<IpcResponse<ShowOpenDialog>>>;
  /** 사용자가 끌어 놓은 File만 받는다. 경로는 preload에서 얻고 렌더러에 돌려주지 않는다. */
  openDroppedFile(file: File): Promise<IpcResult<IpcResponse<OpenDropped>>>;
  readDocument(request: IpcRequest<ReadDocument>): Promise<IpcResult<IpcResponse<ReadDocument>>>;
  /** 최근 문서의 파일명과 ID. 경로는 받지 않는다. */
  listRecentDocuments(): Promise<IpcResult<IpcResponse<ListRecent>>>;
  openRecentDocument(request: IpcRequest<OpenRecent>): Promise<IpcResult<IpcResponse<OpenRecent>>>;
  /** 메뉴 동작을 구독한다. 돌려받은 함수를 호출하면 구독을 끝낸다. */
  onMenuCommand(listener: (command: MenuCommand) => void): () => void;
  /** 다음 질문의 전송 범위를 메인에게 확정받는다. */
  resolveSendScope(request: IpcRequest<ResolveScope>): Promise<IpcResult<IpcResponse<ResolveScope>>>;
  askTutor(request: IpcRequest<TutorAsk>): Promise<IpcResult<IpcResponse<TutorAsk>>>;
  stopTutor(request: IpcRequest<TutorStop>): Promise<IpcResult<IpcResponse<TutorStop>>>;
  onTutorEvent(listener: (event: TutorEvent) => void): () => void;
  /** 키의 등록 여부만 알 수 있다. 저장된 키를 읽어 오는 방법은 없다. */
  getKeyStatus(): Promise<IpcResult<IpcResponse<KeyGetStatus>>>;
  saveKey(request: IpcRequest<KeySave>): Promise<IpcResult<IpcResponse<KeySave>>>;
  deleteKey(request: IpcRequest<KeyDelete>): Promise<IpcResult<IpcResponse<KeyDelete>>>;
  setProvider(request: IpcRequest<ProviderSet>): Promise<IpcResult<IpcResponse<ProviderSet>>>;
  openSettings(request: IpcRequest<SettingsOpen>): Promise<IpcResult<IpcResponse<SettingsOpen>>>;
  /** 키나 고른 제공사가 바뀌면 알린다. */
  onKeyChanged(listener: () => void): () => void;
}
