export const APP_PROTOCOL = 'app';
export const APP_HOST = 'bundle';
export const APP_ENTRY_URL = `${APP_PROTOCOL}://${APP_HOST}/index.html`;

// devServerUrl은 패키징되지 않은 실행에서만 넘긴다. 패키징된 앱은 환경 변수로 신뢰 출처를 늘릴 수 없다.
export function isTrustedRendererUrl(url: string | undefined, devServerUrl?: string): boolean {
  if (url === undefined) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol === `${APP_PROTOCOL}:` && parsed.host === APP_HOST) return true;
  if (devServerUrl !== undefined) return parsed.origin === new URL(devServerUrl).origin;
  return false;
}
