import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { KeyStatus } from '../../shared/ipc/contract';

// Electron safeStorage 중 이 모듈이 쓰는 부분. Electron을 가져오지 않으므로 단위 테스트에서 그대로 실행한다.
export interface KeyCipher {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

export type KeySaveResult = 'saved' | 'unavailable';

type ReadResult = { state: 'ok'; apiKey: string } | { state: 'missing' | 'unreadable' | 'unavailable' };

// API 키의 암호문 파일을 관리한다(docs/architecture.md 3절). 평문을 캐시하지 않고 평문으로 대신 저장하지도 않는다.
export class ApiKeyStore {
  constructor(
    private readonly filePath: string,
    private readonly cipher: KeyCipher,
  ) {}

  // 복호화까지 해 봐야 실제로 쓸 수 있는 키인지 알 수 있다. 파일만 있고 못 읽으면 다시 입력받는다.
  async status(): Promise<KeyStatus> {
    const { state } = await this.read();
    if (state === 'ok') return 'stored';
    return state === 'missing' ? 'none' : state;
  }

  async save(apiKey: string): Promise<KeySaveResult> {
    if (!this.cipher.isEncryptionAvailable()) return 'unavailable';
    const encrypted = this.cipher.encryptString(apiKey);
    await mkdir(dirname(this.filePath), { recursive: true });
    // 쓰는 도중 앱이 꺼져도 기존 키가 깨지지 않게 임시 파일을 만든 뒤 바꿔 넣는다.
    const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, encrypted, { mode: 0o600, flag: 'wx' });
      await rename(temporaryPath, this.filePath);
    } catch (error) {
      await rm(temporaryPath, { force: true });
      throw error;
    }
    return 'saved';
  }

  // 메인 프로세스 안에서 요청을 만들 때만 부른다. 결과를 렌더러로 보내지 않는다.
  async load(): Promise<string | null> {
    const result = await this.read();
    return result.state === 'ok' ? result.apiKey : null;
  }

  async delete(): Promise<void> {
    await rm(this.filePath, { force: true });
  }

  private async read(): Promise<ReadResult> {
    try {
      // 파일부터 읽는다. 저장된 키가 없으면 키체인에 접근하지 않아 실행만으로 권한 창이 뜨지 않는다.
      const encrypted = await readFile(this.filePath);
      if (!this.cipher.isEncryptionAvailable()) return { state: 'unavailable' };
      const apiKey = this.cipher.decryptString(encrypted);
      return apiKey === '' ? { state: 'unreadable' } : { state: 'ok', apiKey };
    } catch (error) {
      if (isFileMissing(error)) return { state: 'missing' };
      // 오류 문구에는 경로가 들어 있을 수 있어 이름만 남긴다.
      console.error(`[key-store] 키를 읽지 못함: ${error instanceof Error ? error.name : 'UnknownError'}`);
      return { state: 'unreadable' };
    }
  }
}

function isFileMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
