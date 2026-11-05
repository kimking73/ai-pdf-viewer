import { app, session } from 'electron';
import { buildDevCsp } from './csp';
import { isTrustedRendererUrl } from './trusted-origin';

export function applySessionPolicy(devServerUrl: string | undefined): void {
  const { defaultSession } = session;

  // 지금은 어떤 권한(카메라, 위치, 알림 등)도 필요 없다. 필요해지면 항목별로 연다.
  defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
  defaultSession.setPermissionCheckHandler(() => false);

  // 개발 서버 응답에는 프로토콜 처리기를 거치지 않으므로 여기서 CSP를 붙인다.
  if (devServerUrl !== undefined) {
    const csp = buildDevCsp(devServerUrl);
    defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] } });
    });
  }
}

export function applyWebContentsPolicy(devServerUrl: string | undefined): void {
  app.on('web-contents-created', (_event, contents) => {
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-attach-webview', (event) => {
      event.preventDefault();
    });

    const blockUntrusted = (event: { preventDefault(): void }, url: string): void => {
      if (!isTrustedRendererUrl(url, devServerUrl)) event.preventDefault();
    };
    contents.on('will-navigate', blockUntrusted);
    contents.on('will-redirect', blockUntrusted);
  });
}
