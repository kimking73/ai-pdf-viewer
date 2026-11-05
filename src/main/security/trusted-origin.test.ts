import { describe, expect, it } from 'vitest';
import { isTrustedRendererUrl } from './trusted-origin';

describe('isTrustedRendererUrl', () => {
  it('앱 번들 출처를 신뢰한다', () => {
    expect(isTrustedRendererUrl('app://bundle/index.html')).toBe(true);
  });

  it.each([
    'app://evil/index.html',
    'https://example.com/',
    'file:///etc/passwd',
    'http://localhost:5173/',
    'not a url',
    undefined,
  ])('%s은 신뢰하지 않는다', (url) => {
    expect(isTrustedRendererUrl(url)).toBe(false);
  });

  it('개발 서버 출처는 명시적으로 넘길 때만 신뢰한다', () => {
    const dev = 'http://localhost:5173';
    expect(isTrustedRendererUrl('http://localhost:5173/src/main.tsx', dev)).toBe(true);
    expect(isTrustedRendererUrl('http://localhost:9999/', dev)).toBe(false);
  });
});
