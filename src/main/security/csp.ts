// CSP의 원본은 여기 하나다. 렌더러가 네트워크에 직접 나가지 못하도록 connect-src를 막는다.
// AI 요청은 IPC를 거쳐 메인 프로세스에서만 나간다(docs/architecture.md).
const PRODUCTION_DIRECTIVES: Record<string, string[]> = {
  'default-src': ["'none'"],
  'script-src': ["'self'"],
  'style-src': ["'self'"],
  'img-src': ["'self'", 'data:'],
  'font-src': ["'self'"],
  'connect-src': ["'none'"],
  'object-src': ["'none'"],
  'base-uri': ["'none'"],
  'form-action': ["'none'"],
  'frame-ancestors': ["'none'"],
};

function serialize(directives: Record<string, string[]>): string {
  return Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(' ')}`)
    .join('; ');
}

export const PRODUCTION_CSP = serialize(PRODUCTION_DIRECTIVES);

// Vite의 HMR과 React Refresh에 필요한 만큼만 완화한다. 패키징된 앱에는 적용되지 않는다.
export function buildDevCsp(devServerUrl: string): string {
  const { host } = new URL(devServerUrl);
  return serialize({
    ...PRODUCTION_DIRECTIVES,
    'script-src': ["'self'", "'unsafe-inline'"],
    'style-src': ["'self'", "'unsafe-inline'"],
    'connect-src': ["'self'", `ws://${host}`],
  });
}
