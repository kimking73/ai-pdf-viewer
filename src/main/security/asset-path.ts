import { isAbsolute, relative, resolve } from 'node:path';

// app:// 요청 URL을 번들 안의 파일 경로로 바꾼다. 번들 밖을 가리키면 null을 돌려준다.
export function resolveBundledAsset(root: string, requestUrl: string, expectedHost: string): string | null {
  let pathname: string;
  try {
    const url = new URL(requestUrl);
    if (url.host !== expectedHost) return null;
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  if (pathname.includes('\0')) return null;

  const target = resolve(root, `.${pathname}`);
  const fromRoot = relative(root, target);
  if (fromRoot === '' || fromRoot.startsWith('..') || isAbsolute(fromRoot)) return null;
  return target;
}
