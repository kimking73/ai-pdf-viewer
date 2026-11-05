import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AiProviderId } from '../../shared/ipc/contract';

export const DEFAULT_PROVIDER: AiProviderId = 'openai';

// 사용자가 고른 제공사를 기억한다. 비밀이 아니므로 일반 파일에 둔다. 파일이 없거나 깨졌으면 기본값을 쓴다.
export class ProviderSelection {
  private current: AiProviderId;

  constructor(private readonly filePath: string) {
    this.current = readSaved(filePath);
  }

  get(): AiProviderId {
    return this.current;
  }

  set(provider: AiProviderId): void {
    this.current = provider;
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify({ provider }));
  }
}

function readSaved(filePath: string): AiProviderId {
  try {
    const parsed: unknown = JSON.parse(readFileSync(filePath, 'utf8'));
    if (typeof parsed === 'object' && parsed !== null && 'provider' in parsed) {
      if (parsed.provider === 'openai' || parsed.provider === 'postech') return parsed.provider;
    }
  } catch {
    // 처음 실행이거나 파일이 깨진 경우다. 기본값으로 시작한다.
  }
  return DEFAULT_PROVIDER;
}
