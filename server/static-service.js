import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sendJson, sendStaticContent, staticCacheControl } from './http-utils.js';

export const DEFAULT_MIME_TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.webmanifest', 'application/manifest+json; charset=utf-8'],
  ['.cer', 'application/x-x509-ca-cert'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.ico', 'image/x-icon']
]);

export function resolveLocalImagePath(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }
  if (/^file:\/\//i.test(raw)) {
    return fileURLToPath(raw);
  }
  if (raw === '~') {
    return os.homedir();
  }
  if (raw.startsWith('~/') || raw.startsWith('~\\')) {
    return path.join(os.homedir(), raw.slice(2));
  }
  return raw;
}

export function safeDecodeLocalPath(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export async function sendLocalImage(req, res, url, {
  mimeTypes = DEFAULT_MIME_TYPES
} = {}) {
  const requestedPath = resolveLocalImagePath(url.searchParams.get('path'));
  const decodedPath = /%[0-9a-f]{2}/i.test(requestedPath) ? resolveLocalImagePath(safeDecodeLocalPath(requestedPath)) : '';
  const candidates = [...new Set([requestedPath, decodedPath].filter(Boolean))];
  if (!candidates.length || !candidates.some((candidate) => path.isAbsolute(candidate))) {
    sendJson(res, 400, { error: 'Image path must be absolute' });
    return;
  }

  for (const candidate of candidates) {
    if (!path.isAbsolute(candidate)) {
      continue;
    }
    const filePath = path.resolve(candidate);
    const ext = path.extname(filePath).toLowerCase();
    const contentType = mimeTypes.get(ext) || '';
    if (!contentType.startsWith('image/')) {
      continue;
    }
    try {
      const stat = await fs.stat(filePath);
      if (!stat.isFile()) {
        continue;
      }
      const content = await fs.readFile(filePath);
      sendStaticContent(req, res, 200, content, {
        'content-type': contentType,
        'cache-control': 'private, max-age=3600',
        'x-content-type-options': 'nosniff'
      }, ext);
      return;
    } catch {
      // Try the decoded candidate before reporting a miss.
    }
  }

  sendJson(res, 404, { error: 'Image not found' });
}

export async function serveFileFromRoot(req, res, rootDir, requestedPath, cacheControl, {
  mimeTypes = DEFAULT_MIME_TYPES
} = {}) {
  const relativePath = requestedPath.replace(/^\/+/, '');
  const candidate = path.normalize(path.join(rootDir, relativePath));
  const rootWithSep = rootDir.endsWith(path.sep) ? rootDir : `${rootDir}${path.sep}`;
  if (candidate !== rootDir && !candidate.startsWith(rootWithSep)) {
    res.writeHead(403);
    res.end('Forbidden');
    return true;
  }

  try {
    const stat = await fs.stat(candidate);
    if (!stat.isFile()) {
      res.writeHead(404);
      res.end('Not found');
      return true;
    }
    const ext = path.extname(candidate);
    const content = await fs.readFile(candidate);
    sendStaticContent(req, res, 200, content, {
      'content-type': mimeTypes.get(ext) || 'application/octet-stream',
      'cache-control': cacheControl,
      'x-content-type-options': 'nosniff'
    }, ext);
    return true;
  } catch {
    res.writeHead(404);
    res.end('Not found');
    return true;
  }
}

export function createStaticService({
  clientDist,
  generatedRoot,
  httpsRootCaPath,
  mimeTypes = DEFAULT_MIME_TYPES
}) {
  async function serveStatic(req, res, url) {
    let requestedPath = decodeURIComponent(url.pathname);
    if (requestedPath === '/codexmobile-root-ca.cer') {
      try {
        const stat = await fs.stat(httpsRootCaPath);
        const content = await fs.readFile(httpsRootCaPath);
        res.writeHead(200, {
          'content-type': 'application/x-x509-ca-cert',
          'content-length': stat.size,
          'cache-control': 'no-store',
          'content-disposition': 'attachment; filename="codexmobile-root-ca.cer"',
          'x-content-type-options': 'nosniff'
        });
        res.end(content);
      } catch {
        res.writeHead(404);
        res.end('Certificate not found');
      }
      return;
    }

    if (requestedPath.startsWith('/generated/')) {
      await serveFileFromRoot(
        req,
        res,
        generatedRoot,
        requestedPath.slice('/generated/'.length),
        'private, max-age=86400',
        { mimeTypes }
      );
      return;
    }

    if (requestedPath === '/') {
      requestedPath = '/index.html';
    }

    const candidate = path.normalize(path.join(clientDist, requestedPath));
    if (!candidate.startsWith(clientDist)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    try {
      const stat = await fs.stat(candidate);
      const filePath = stat.isDirectory() ? path.join(candidate, 'index.html') : candidate;
      const ext = path.extname(filePath);
      const content = await fs.readFile(filePath);
      sendStaticContent(req, res, 200, content, {
        'content-type': mimeTypes.get(ext) || 'application/octet-stream',
        'cache-control': staticCacheControl(ext, filePath),
        'x-content-type-options': 'nosniff'
      }, ext);
    } catch {
      const indexPath = path.join(clientDist, 'index.html');
      try {
        const content = await fs.readFile(indexPath);
        sendStaticContent(req, res, 200, content, {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff'
        }, '.html');
      } catch {
        res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('CodexMobile server is running. Build the PWA with: npm run build');
      }
    }
  }

  async function sendLocalImageFromRequest(req, res, url) {
    await sendLocalImage(req, res, url, { mimeTypes });
  }

  return {
    serveStatic,
    sendLocalImage: sendLocalImageFromRequest
  };
}
