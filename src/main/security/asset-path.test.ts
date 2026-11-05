import { describe, expect, it } from 'vitest';
import { resolveBundledAsset } from './asset-path';

const ROOT = '/bundle/renderer';
const resolveUrl = (url: string) => resolveBundledAsset(ROOT, url, 'bundle');

describe('resolveBundledAsset', () => {
  it('번들 안의 파일을 찾는다', () => {
    expect(resolveUrl('app://bundle/index.html')).toBe('/bundle/renderer/index.html');
    expect(resolveUrl('app://bundle/assets/a%20b.js')).toBe('/bundle/renderer/assets/a b.js');
  });

  it.each([
    ['상위 경로', 'app://bundle/../../etc/passwd'],
    ['인코딩된 상위 경로', 'app://bundle/%2e%2e/%2e%2e/etc/passwd'],
    ['인코딩된 구분자', 'app://bundle/..%2f..%2fetc%2fpasswd'],
    ['널 문자', 'app://bundle/index.html%00.png'],
    ['잘못된 인코딩', 'app://bundle/%E0%A4%A'],
    ['다른 호스트', 'app://other/index.html'],
    ['루트 자체', 'app://bundle/'],
  ])('%s은 거부하거나 번들 밖으로 나가지 않는다', (_name, url) => {
    const result = resolveUrl(url);
    if (result !== null) expect(result.startsWith(`${ROOT}/`)).toBe(true);
    if (!url.includes('etc')) expect(result).toBeNull();
  });
});
