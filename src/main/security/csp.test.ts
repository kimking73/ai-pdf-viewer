import { describe, expect, it } from 'vitest';
import { buildDevCsp, PRODUCTION_CSP } from './csp';

describe('CSP', () => {
  it('배포용 정책은 인라인, eval, 외부 연결을 허용하지 않는다', () => {
    expect(PRODUCTION_CSP).toContain("default-src 'none'");
    expect(PRODUCTION_CSP).toContain("script-src 'self'");
    expect(PRODUCTION_CSP).toContain("connect-src 'none'");
    expect(PRODUCTION_CSP).not.toContain('unsafe');
    expect(PRODUCTION_CSP).not.toMatch(/https?:/);
  });

  it('개발용 정책은 개발 서버의 웹소켓만 추가로 연다', () => {
    const csp = buildDevCsp('http://localhost:5173');
    expect(csp).toContain("connect-src 'self' ws://localhost:5173");
    expect(csp).not.toContain('unsafe-eval');
  });
});
