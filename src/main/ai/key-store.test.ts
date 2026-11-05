import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { ApiKeyStore, type KeyCipher } from './key-store';

const KEY = 'test-key-value-1234';
const root = mkdtempSync(join(tmpdir(), 'key-store-'));
let count = 0;
const newDir = (): string => {
  count += 1;
  const dir = join(root, String(count));
  mkdirSync(dir);
  return dir;
};
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

// 실제 암호화 대신 base64로 바꾸기만 한다. 파일에 평문이 없는지 확인하기에는 충분하다.
const cipher: KeyCipher = {
  isEncryptionAvailable: () => true,
  encryptString: (text) => Buffer.from(`enc:${Buffer.from(text).toString('base64')}`),
  decryptString: (encrypted) => {
    const text = encrypted.toString();
    if (!text.startsWith('enc:')) throw new Error('decrypt failed');
    return Buffer.from(text.slice(4), 'base64').toString();
  },
};
const unavailable: KeyCipher = { ...cipher, isEncryptionAvailable: () => false };

describe('ApiKeyStore', () => {
  it('저장한 키를 새 인스턴스에서 다시 읽는다', async () => {
    const path = join(newDir(), 'key.bin');
    await expect(new ApiKeyStore(path, cipher).save(KEY)).resolves.toBe('saved');
    const reopened = new ApiKeyStore(path, cipher);
    await expect(reopened.load()).resolves.toBe(KEY);
    await expect(reopened.status()).resolves.toBe('stored');
  });

  it('파일에 평문을 남기지 않고 권한을 0600으로 둔다', async () => {
    const dir = newDir();
    const path = join(dir, 'key.bin');
    await new ApiKeyStore(path, cipher).save(KEY);
    expect(readFileSync(path).toString()).not.toContain(KEY);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(readdirSync(dir)).toEqual(['key.bin']);
  });

  it('기존 키를 덮어써도 권한이 유지된다', async () => {
    const path = join(newDir(), 'key.bin');
    const store = new ApiKeyStore(path, cipher);
    await store.save('old-key');
    await store.save(KEY);
    await expect(store.load()).resolves.toBe(KEY);
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it('없는 폴더도 만들어 저장한다', async () => {
    const path = join(newDir(), 'nested', 'key.bin');
    await expect(new ApiKeyStore(path, cipher).save(KEY)).resolves.toBe('saved');
  });

  it('파일이 없으면 키 없음으로 처리한다', async () => {
    const store = new ApiKeyStore(join(newDir(), 'key.bin'), cipher);
    await expect(store.load()).resolves.toBeNull();
    await expect(store.status()).resolves.toBe('none');
  });

  it('복호화에 실패하면 키를 쓰지 않고 다시 입력을 요청하며 오류 문구를 로그에 남기지 않는다', async () => {
    const path = join(newDir(), 'key.bin');
    writeFileSync(path, 'broken');
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const store = new ApiKeyStore(path, cipher);
    await expect(store.load()).resolves.toBeNull();
    await expect(store.status()).resolves.toBe('unreadable');
    expect(log.mock.calls.flat().join(' ')).not.toContain('decrypt failed');
    log.mockRestore();
  });

  it('복호화 실패 뒤 다시 저장할 수 있다', async () => {
    const path = join(newDir(), 'key.bin');
    writeFileSync(path, 'broken');
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const store = new ApiKeyStore(path, cipher);
    await store.load();
    log.mockRestore();
    await store.save(KEY);
    await expect(store.load()).resolves.toBe(KEY);
  });

  it('암호화를 쓸 수 없으면 평문으로 저장하지 않는다', async () => {
    const dir = newDir();
    const store = new ApiKeyStore(join(dir, 'key.bin'), unavailable);
    await expect(store.save(KEY)).resolves.toBe('unavailable');
    await expect(store.load()).resolves.toBeNull();
    expect(readdirSync(dir)).toEqual([]);
  });

  it('암호화를 쓸 수 없으면 저장된 키도 읽지 않는다', async () => {
    const path = join(newDir(), 'key.bin');
    await new ApiKeyStore(path, cipher).save(KEY);
    const store = new ApiKeyStore(path, unavailable);
    await expect(store.status()).resolves.toBe('unavailable');
    await expect(store.load()).resolves.toBeNull();
  });

  it('저장된 키가 없으면 키체인에 접근하지 않는다', async () => {
    const isEncryptionAvailable = vi.fn(() => true);
    const store = new ApiKeyStore(join(newDir(), 'key.bin'), { ...cipher, isEncryptionAvailable });
    await expect(store.status()).resolves.toBe('none');
    expect(isEncryptionAvailable).not.toHaveBeenCalled();
  });

  it('쓰기에 실패하면 임시 파일을 남기지 않는다', async () => {
    const dir = newDir();
    const path = join(dir, 'key.bin');
    // 대상이 폴더면 바꿔 넣기가 실패한다.
    mkdirSync(join(path, 'occupied'), { recursive: true });
    await expect(new ApiKeyStore(path, cipher).save(KEY)).rejects.toThrow();
    expect(readdirSync(dir)).toEqual(['key.bin']);
  });

  it('삭제하면 파일이 사라지고, 없어도 실패하지 않는다', async () => {
    const path = join(newDir(), 'key.bin');
    const store = new ApiKeyStore(path, cipher);
    await store.save(KEY);
    await store.delete();
    expect(existsSync(path)).toBe(false);
    await expect(store.status()).resolves.toBe('none');
    await expect(store.delete()).resolves.toBeUndefined();
  });

  it('암호화를 쓸 수 없어도 삭제할 수 있다', async () => {
    const path = join(newDir(), 'key.bin');
    await new ApiKeyStore(path, cipher).save(KEY);
    await new ApiKeyStore(path, unavailable).delete();
    expect(existsSync(path)).toBe(false);
  });
});
