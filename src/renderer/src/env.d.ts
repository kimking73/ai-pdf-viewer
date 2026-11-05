import type { RendererApi } from '../../shared/ipc/renderer-api';

declare global {
  interface Window {
    readonly api: RendererApi;
  }
}
