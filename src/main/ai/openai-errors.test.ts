import { describe, expect, it } from 'vitest';
import { classifyOpenAiResponse, classifyOpenAiStreamCode } from './openai-errors';

const body = (code: string | null, type = 'x'): string => JSON.stringify({ error: { code, type, message: 'raw' } });

describe('classifyOpenAiResponse', () => {
  it.each([
    [401, body('invalid_api_key'), 'invalid-key'],
    [401, 'not json', 'invalid-key'],
    [400, body('invalid_api_key'), 'invalid-key'],
    [403, body(null), 'provider'],
    [429, body('insufficient_quota'), 'insufficient-quota'],
    [429, body(null, 'insufficient_quota'), 'insufficient-quota'],
    [429, body('credit_balance_exhausted'), 'insufficient-quota'],
    [429, body('organization_spend_limit_exceeded'), 'insufficient-quota'],
    [429, body('project_spend_limit_exceeded'), 'insufficient-quota'],
    [429, body('organization_usage_limit_exceeded'), 'insufficient-quota'],
    [429, body('rate_limit_exceeded'), 'rate-limited'],
    [429, body('slow_down', 'rate_limit_error'), 'rate-limited'],
    [503, body('server_is_overloaded', 'service_unavailable_error'), 'provider'],
    [429, '', 'rate-limited'],
    [400, body('context_length_exceeded'), 'provider'],
    [404, body('model_not_found'), 'provider'],
    [500, '<html>', 'provider'],
  ])('%i %s -> %s', (status, text, expected) => {
    expect(classifyOpenAiResponse(status, text)).toBe(expected);
  });

  it.each(['null', '[]', '1', '{"error":null}', '{"error":"x"}', '{"error":{"code":1}}'])('모양이 다른 본문 %s도 실패하지 않는다', (text) => {
    expect(classifyOpenAiResponse(429, text)).toBe('rate-limited');
  });
});

describe('classifyOpenAiStreamCode', () => {
  it.each([
    [null, 'provider'],
    ['server_error', 'provider'],
    ['rate_limit_exceeded', 'rate-limited'],
    ['credit_balance_exhausted', 'insufficient-quota'],
    ['invalid_api_key', 'invalid-key'],
  ])('%s -> %s', (code, expected) => {
    expect(classifyOpenAiStreamCode(code)).toBe(expected);
  });
});
