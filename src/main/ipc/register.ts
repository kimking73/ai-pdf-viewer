import { app, BrowserWindow, dialog, ipcMain, safeStorage } from 'electron';
import { join } from 'node:path';
import { IPC_CHANNELS, IPC_EVENTS, type IpcChannel } from '../../shared/ipc/channels';
import type { AiProviderId, IpcRequest, IpcResponse, PdfOpenResponse } from '../../shared/ipc/contract';
import { checkAndSaveKey } from '../ai/key-service';
import { ApiKeyStore } from '../ai/key-store';
import { OpenAiProvider } from '../ai/openai-provider';
import { PostechProvider } from '../ai/postech-provider';
import { ProviderSelection } from '../ai/provider-selection';
import { DocumentGrant, inspectPdfFile } from '../documents/document-access';
import { RecentDocuments } from '../documents/recent-documents';
import { isTrustedRendererUrl } from '../security/trusted-origin';
import { fakeTutorProvider } from '../tutor/fake-provider';
import { routeProvider } from '../tutor/provider';
import { TutorService } from '../tutor/tutor-service';
import { getMainWindow, openSettingsWindow } from '../window';
import { createIpcHandler, type IpcGuards } from './create-handler';

// 창을 닫을 때 호출할 함수를 돌려준다.
export function registerIpcHandlers(devServerUrl: string | undefined): () => void {
  const guards: IpcGuards = {
    isTrustedUrl: (url) => isTrustedRendererUrl(url, devServerUrl),
    logError: (channel, errorName) => {
      console.error(`[ipc] ${channel} 실패: ${errorName}`);
    },
  };

  function handle<C extends IpcChannel>(
    channel: C,
    handler: (request: IpcRequest<C>) => IpcResponse<C> | Promise<IpcResponse<C>>,
  ): void {
    const run = createIpcHandler(channel, handler, guards);
    ipcMain.handle(channel, (event, rawRequest: unknown) => {
      const frame = event.senderFrame;
      return run({ url: frame?.url, isMainFrame: frame?.parent === null }, rawRequest);
    });
  }

  const documents = new DocumentGrant();

  const userData = app.getPath('userData');
  // 키는 제공사별로 따로 저장하고, 각 어댑터는 자기 키만 읽는다.
  const keys: Record<AiProviderId, ApiKeyStore> = {
    openai: new ApiKeyStore(join(userData, 'openai-key.bin'), safeStorage),
    postech: new ApiKeyStore(join(userData, 'postech-key.bin'), safeStorage),
  };
  const adapters = {
    openai: new OpenAiProvider({ loadApiKey: () => keys.openai.load() }),
    postech: new PostechProvider({ loadApiKey: () => keys.postech.load() }),
  };
  const selection = new ProviderSelection(join(userData, 'ai-provider.json'));
  // 개발 실행과 E2E에서만 쓰는 가짜 응답. 패키징된 앱은 환경 변수로 바꿀 수 없다.
  const useFake = !app.isPackaged && process.env.AI_PDF_VIEWER_FAKE_PROVIDER === '1';

  const recentDocuments = new RecentDocuments(join(userData, 'recent-documents.json'));

  const tutor = new TutorService({
    provider: routeProvider({ fake: fakeTutorProvider, ...adapters }),
    getProviderId: () => (useFake ? 'fake' : selection.get()),
    hasKey: async () => useFake || (await keys[selection.get()].status()) === 'stored',
    isIssuedDocument: (id) => documents.wasIssued(id),
    send: (event) => {
      getMainWindow()?.webContents.send(IPC_EVENTS.tutorEvent, event);
    },
  });

  const notifyKeyChanged = (): void => {
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send(IPC_EVENTS.keyChanged);
  };

  handle(IPC_CHANNELS.keyGetStatus, async () => {
    const [openai, postech] = await Promise.all([keys.openai.status(), keys.postech.status()]);
    const statuses = { openai, postech };
    return {
      status: useFake ? 'stored' : statuses[selection.get()],
      provider: useFake ? 'fake' : selection.get(),
      keys: statuses,
    };
  });
  handle(IPC_CHANNELS.keySave, async ({ provider, apiKey }) => {
    const response = await checkAndSaveKey(apiKey, {
      store: keys[provider],
      // 입력한 키는 사용자가 고른 제공사로만 보내 확인한다.
      validate: (key) => adapters[provider].validateKey(key),
    });
    notifyKeyChanged();
    return response;
  });
  handle(IPC_CHANNELS.keyDelete, async ({ provider }) => {
    await keys[provider].delete();
    notifyKeyChanged();
    return { status: await keys[provider].status() };
  });
  handle(IPC_CHANNELS.providerSet, ({ provider }) => {
    selection.set(provider);
    notifyKeyChanged();
    return {};
  });
  handle(IPC_CHANNELS.settingsOpen, async ({ returnFocus }) => {
    await openSettingsWindow(devServerUrl, returnFocus);
    return {};
  });

  async function grantFile(path: string): Promise<Exclude<PdfOpenResponse, { status: 'cancelled' }>> {
    const inspected = await inspectPdfFile(path);
    if (!inspected.ok) return { status: 'rejected', reason: inspected.reason };
    recentDocuments.add(inspected.realPath, inspected.name);
    return { status: 'opened', document: { id: documents.grant(inspected.realPath), name: inspected.name } };
  }

  handle(IPC_CHANNELS.appGetVersion, ({ component }) => {
    switch (component) {
      case 'app':
        return { version: app.getVersion() };
      case 'electron':
        return { version: process.versions.electron };
      case 'chromium':
        return { version: process.versions.chrome };
    }
  });

  handle(IPC_CHANNELS.pdfShowOpenDialog, async () => {
    const options: Electron.OpenDialogOptions = {
      title: 'PDF 열기',
      properties: ['openFile'],
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    };
    const parent = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const { canceled, filePaths } = parent
      ? await dialog.showOpenDialog(parent, options)
      : await dialog.showOpenDialog(options);
    const [path] = filePaths;
    if (canceled || path === undefined) return { status: 'cancelled' } as const;
    return grantFile(path);
  });

  handle(IPC_CHANNELS.pdfOpenDropped, ({ path }) => grantFile(path));
  handle(IPC_CHANNELS.pdfListRecent, async () => ({ documents: await recentDocuments.list() }));
  handle(IPC_CHANNELS.pdfOpenRecent, async ({ id }) => {
    const path = recentDocuments.pathFor(id);
    if (path === null) return { status: 'rejected', reason: 'unreadable' } as const;
    const opened = await grantFile(path);
    // 더 이상 열 수 없는 파일은 목록에 남기지 않는다.
    if (opened.status === 'rejected') recentDocuments.remove(id);
    return opened;
  });

  handle(IPC_CHANNELS.tutorResolveScope, (request) => tutor.resolveScope(request));
  handle(IPC_CHANNELS.tutorAsk, (request) => tutor.ask(request));
  handle(IPC_CHANNELS.tutorStop, ({ requestId }) => ({ stopped: tutor.stop(requestId) }));

  handle(IPC_CHANNELS.pdfReadDocument, async ({ id }) => {
    // 발급하지 않은 ID는 어떤 파일 정보도 주지 않고 같은 이유로 거부한다.
    return (await documents.read(id)) ?? ({ status: 'rejected', reason: 'unreadable' } as const);
  });

  // 본 창을 닫으면 읽기 권한도 끝나고 진행 중인 답변도 멈춘다. 설정 창을 닫는 것과는 무관하다.
  return () => {
    documents.revoke();
    tutor.reset();
  };
}
