import { BrowserWindow, type WebPreferences } from 'electron';
import { join } from 'node:path';
import { APP_NAME } from '../shared/app-config';
import { IPC_EVENTS } from '../shared/ipc/channels';
import type { MenuCommand } from '../shared/ipc/menu-commands';
import { APP_ENTRY_URL } from './security/trusted-origin';

let mainWindow: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;
// 튜터의 [키 설정]에서 열었으면 닫을 때 입력창으로 돌아간다(계약 4.5절).
let returnFocusOnClose = false;

function securePreferences(): WebPreferences {
  return {
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
    preload: join(__dirname, '../preload/index.js'),
  };
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

export function getFocusedSettingsWindow(): BrowserWindow | null {
  return settingsWindow?.isFocused() === true ? settingsWindow : null;
}

export async function createMainWindow(devServerUrl: string | undefined, onClosed: () => void): Promise<void> {
  const window = new BrowserWindow({
    title: APP_NAME,
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    show: false,
    // 도구 막대가 제목 막대를 겸한다(docs/design-contract.md 2.5, 7.5절). 신호등은 44px 막대의 가운데에 둔다.
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 15 },
    webPreferences: securePreferences(),
  });
  mainWindow = window;

  window.once('ready-to-show', () => {
    window.show();
  });
  window.once('closed', () => {
    mainWindow = null;
    onClosed();
  });

  await window.loadURL(devServerUrl ?? APP_ENTRY_URL);
}

// 설정은 별도 창이다(계약 4.10절). 본 창과 같은 보안 설정과 같은 번들을 쓰고, 주소의 #settings로 화면을 고른다.
export async function openSettingsWindow(devServerUrl: string | undefined, returnFocus: boolean): Promise<void> {
  returnFocusOnClose = returnFocus;
  if (settingsWindow !== null) {
    settingsWindow.focus();
    return;
  }
  const window = new BrowserWindow({
    title: '설정',
    width: 480,
    height: 420,
    resizable: false,
    minimizable: false,
    fullscreenable: false,
    show: false,
    webPreferences: securePreferences(),
  });
  settingsWindow = window;

  window.once('ready-to-show', () => {
    window.show();
  });
  window.once('closed', () => {
    settingsWindow = null;
    if (returnFocusOnClose && mainWindow !== null) {
      mainWindow.focus();
      const command: MenuCommand = 'focus-question';
      mainWindow.webContents.send(IPC_EVENTS.menuCommand, command);
    }
    returnFocusOnClose = false;
  });

  await window.loadURL(`${devServerUrl ?? APP_ENTRY_URL}#settings`);
}
