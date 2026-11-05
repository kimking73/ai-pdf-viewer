import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron';
import { IPC_CHANNELS, IPC_EVENTS } from '../shared/ipc/channels';
import type { TutorEvent } from '../shared/ipc/contract';
import type { MenuCommand } from '../shared/ipc/menu-commands';
import type { RendererApi } from '../shared/ipc/renderer-api';

// 렌더러에 노출되는 전부다. ipcRenderer 자체나 범용 invoke를 넘기지 않는다.
// 입력 검증은 메인 프로세스의 몫이고, preload는 동작 하나를 채널 하나에 잇기만 한다.
const api: RendererApi = {
  getVersion: (request) => ipcRenderer.invoke(IPC_CHANNELS.appGetVersion, request),
  openPdfDialog: () => ipcRenderer.invoke(IPC_CHANNELS.pdfShowOpenDialog, {}),
  // 렌더러가 임의 경로를 보낼 수 없도록 경로 인수를 받지 않는다. 스크립트로 만든 File의 경로는
  // 빈 문자열이므로 메인이 INVALID_INPUT으로 거부한다.
  openDroppedFile: (file) =>
    ipcRenderer.invoke(IPC_CHANNELS.pdfOpenDropped, { path: webUtils.getPathForFile(file) }),
  readDocument: (request) => ipcRenderer.invoke(IPC_CHANNELS.pdfReadDocument, request),
  listRecentDocuments: () => ipcRenderer.invoke(IPC_CHANNELS.pdfListRecent, {}),
  openRecentDocument: (request) => ipcRenderer.invoke(IPC_CHANNELS.pdfOpenRecent, request),
  onMenuCommand: (listener) => {
    const forward = (_event: IpcRendererEvent, command: MenuCommand): void => {
      listener(command);
    };
    ipcRenderer.on(IPC_EVENTS.menuCommand, forward);
    return () => {
      ipcRenderer.removeListener(IPC_EVENTS.menuCommand, forward);
    };
  },
  resolveSendScope: (request) => ipcRenderer.invoke(IPC_CHANNELS.tutorResolveScope, request),
  askTutor: (request) => ipcRenderer.invoke(IPC_CHANNELS.tutorAsk, request),
  stopTutor: (request) => ipcRenderer.invoke(IPC_CHANNELS.tutorStop, request),
  onTutorEvent: (listener) => {
    const forward = (_event: IpcRendererEvent, tutorEvent: TutorEvent): void => {
      listener(tutorEvent);
    };
    ipcRenderer.on(IPC_EVENTS.tutorEvent, forward);
    return () => {
      ipcRenderer.removeListener(IPC_EVENTS.tutorEvent, forward);
    };
  },
  getKeyStatus: () => ipcRenderer.invoke(IPC_CHANNELS.keyGetStatus, {}),
  saveKey: (request) => ipcRenderer.invoke(IPC_CHANNELS.keySave, request),
  deleteKey: (request) => ipcRenderer.invoke(IPC_CHANNELS.keyDelete, request),
  setProvider: (request) => ipcRenderer.invoke(IPC_CHANNELS.providerSet, request),
  openSettings: (request) => ipcRenderer.invoke(IPC_CHANNELS.settingsOpen, request),
  onKeyChanged: (listener) => {
    const forward = (): void => {
      listener();
    };
    ipcRenderer.on(IPC_EVENTS.keyChanged, forward);
    return () => {
      ipcRenderer.removeListener(IPC_EVENTS.keyChanged, forward);
    };
  },
};

contextBridge.exposeInMainWorld('api', api);
