import { describe, expect, it } from 'vitest';
import { AiError, classifyFailure } from './ai-error';

const live = new AbortController().signal;
describe('classifyFailure', () => {
  it('사용자가 멈추면 어떤 오류든 취소로 본다', () => {
    const abort = new AbortController();
    abort.abort();
    expect(classifyFailure(new AiError('invalid-key'), abort.signal)).toBe('cancelled');
    expect(classifyFailure(new DOMException('x', 'AbortError'), abort.signal)).toBe('cancelled');
  });

  it('AiError의 코드를 그대로 쓴다', () => {
    expect(classifyFailure(new AiError('rate-limited'), live)).toBe('rate-limited');
  });

  it.each([
    ['undici 연결 실패', new TypeError('fetch failed')],
    ['스트림 중단', new TypeError('terminated')],
    ['Chromium 오류', new Error('net::ERR_INTERNET_DISCONNECTED')],
    ['시간 초과', new DOMException('x', 'TimeoutError')],
    ['원인 안의 코드', new TypeError('other', { cause: Object.assign(new Error('x'), { code: 'ECONNRESET' }) })],
  ])('%s는 네트워크 오류다', (_name, error) => {
    expect(classifyFailure(error, live)).toBe('network');
  });

  it.each([
    ['코드 버그', new TypeError('x is not a function')],
    ['문자열', 'boom'],
    ['null', null],
  ])('%s는 네트워크 오류로 보지 않는다', (_name, error) => {
    expect(classifyFailure(error, live)).toBe('provider');
  });
});

describe('AiError', () => {
  it('문구에 코드만 담는다', () => {
    const error = new AiError('invalid-key');
    expect(error.message).toBe('invalid-key');
    expect(error.name).toBe('AiError');
  });
});
