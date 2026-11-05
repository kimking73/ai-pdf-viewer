import type { PdfRejectionReason } from '../../../shared/ipc/contract';

// 문서를 열 수 없는 이유. 문구는 docs/design-contract.md 4.2, 4.3절을 따른다.
export type OpenFailure = PdfRejectionReason | 'password';

export const OPEN_FAILURE_MESSAGES: Record<OpenFailure, string> = {
  'not-pdf': 'PDF 파일만 열 수 있습니다.',
  'too-large': '파일이 너무 커서 열 수 없습니다.',
  corrupt: '이 파일은 손상되어 열 수 없습니다.',
  unreadable: '파일을 읽을 수 없습니다. 파일이 옮겨졌거나 읽기 권한이 없는지 확인해 주세요.',
  password: '암호가 걸린 PDF는 열 수 없습니다.',
};

// pdf.js의 오류를 이유로 바꾼다. 원문 메시지에는 문서 정보가 섞일 수 있어 화면과 로그에 쓰지 않는다.
export function classifyPdfError(error: unknown): OpenFailure {
  return error instanceof Error && error.name === 'PasswordException' ? 'password' : 'corrupt';
}
