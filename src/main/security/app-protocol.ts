import { net, protocol } from 'electron';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveBundledAsset } from './asset-path';
import { PRODUCTION_CSP } from './csp';
import { APP_HOST, APP_PROTOCOL } from './trusted-origin';

// app.whenReady() 전에 호출해야 한다.
export function registerAppSchemePrivileges(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: APP_PROTOCOL, privileges: { standard: true, secure: true, supportFetchAPI: true } },
  ]);
}

// 렌더러 번들만 제공한다. file://로 띄우지 않으므로 페이지가 파일 시스템과 같은 출처가 되지 않는다.
export function registerAppProtocol(): void {
  const rendererRoot = join(__dirname, '../renderer');

  protocol.handle(APP_PROTOCOL, async (request) => {
    const assetPath = request.method === 'GET' ? resolveBundledAsset(rendererRoot, request.url, APP_HOST) : null;
    if (assetPath === null) return new Response('Not found', { status: 404 });

    const asset = await net.fetch(pathToFileURL(assetPath).toString());
    if (!asset.ok) return new Response('Not found', { status: 404 });

    const headers = new Headers(asset.headers);
    headers.set('Content-Security-Policy', PRODUCTION_CSP);
    headers.set('X-Content-Type-Options', 'nosniff');
    return new Response(asset.body, { status: 200, headers });
  });
}
