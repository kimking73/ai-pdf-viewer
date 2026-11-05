import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { ProviderSelection } from './provider-selection';

const dir = mkdtempSync(join(tmpdir(), 'provider-selection-'));
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('ProviderSelection', () => {
  it('기본값은 OpenAI다', () => {
    expect(new ProviderSelection(join(dir, 'none.json')).get()).toBe('openai');
  });

  it('고른 제공사를 다음 실행에도 기억한다', () => {
    const path = join(dir, 'nested', 'saved.json');
    new ProviderSelection(path).set('postech');
    expect(new ProviderSelection(path).get()).toBe('postech');
  });

  it.each(['broken', '{}', '{"provider":"evil"}', 'null'])('잘못된 내용 %s는 기본값으로 처리한다', (content) => {
    const path = join(dir, 'bad.json');
    writeFileSync(path, content);
    expect(new ProviderSelection(path).get()).toBe('openai');
  });
});
