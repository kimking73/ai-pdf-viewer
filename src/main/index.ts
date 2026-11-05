import { app } from 'electron';
import { APP_NAME } from '../shared/app-config';
import { registerIpcHandlers } from './ipc/register';
import { installApplicationMenu } from './menu';
import { registerAppProtocol, registerAppSchemePrivileges } from './security/app-protocol';
import { applySessionPolicy, applyWebContentsPolicy } from './security/hardening';
import { createMainWindow, getFocusedSettingsWindow, getMainWindow, openSettingsWindow } from './window';

// 패키징된 앱은 환경 변수로 로드 대상이나 신뢰 출처를 바꿀 수 없어야 한다.
const devServerUrl = app.isPackaged ? undefined : process.env.ELECTRON_RENDERER_URL;

let onMainWindowClosed = (): void => undefined;

function showWindow(): void {
  createMainWindow(devServerUrl, () => {
    onMainWindowClosed();
  }).catch((error: unknown) => {
    console.error(`[main] 창을 열지 못했다: ${error instanceof Error ? error.name : 'UnknownError'}`);
    app.exit(1);
  });
}

app.setName(APP_NAME);
if (!app.isPackaged && !app.commandLine.hasSwitch('user-data-dir')) {
  // 개발 실행이 사용자 데이터(이후 저장될 API 키 포함)를 건드리지 않게 분리한다.
  app.setPath('userData', `${app.getPath('userData')} Dev`);
}

app.enableSandbox();
registerAppSchemePrivileges();
applyWebContentsPolicy(devServerUrl);

void app.whenReady().then(() => {
  applySessionPolicy(devServerUrl);
  registerAppProtocol();
  onMainWindowClosed = registerIpcHandlers(devServerUrl);
  installApplicationMenu({
    getMainWindow,
    getFocusedSettingsWindow,
    openSettings: () => {
      openSettingsWindow(devServerUrl, false).catch((error: unknown) => {
        console.error(`[main] 설정 창을 열지 못했다: ${error instanceof Error ? error.name : 'UnknownError'}`);
      });
    },
  });
  showWindow();

  app.on('activate', () => {
    if (getMainWindow() === null) showWindow();
  });
});

// macOS 관례: 창을 모두 닫아도 앱은 종료하지 않는다.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
