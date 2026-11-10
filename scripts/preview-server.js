import http from 'node:http';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const allowed = new Set(['view.html', 'view.css', 'view.js', 'model.js', 'background.js', 'content.js']);
const fixture = `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>조건픽 표시 검증 · 다나와 구조의 로컬 예시</title>
<style>body{font:15px/1.6 system-ui;margin:0;background:#f1f4f8;color:#202d42}header,main{max-width:1080px;margin:auto;padding:24px}header{background:#fff}h1{font-size:24px;margin:0}section{background:#fff;padding:20px;border:1px solid #d4ddea;border-radius:10px;margin:16px 0}h2{font-size:18px}label{margin-right:16px}#productListArea article{padding:16px;border-top:1px solid #d4ddea}a{color:#164f9e}</style>
<header><h1>조건픽 표시 검증</h1><p>다나와의 구조를 본뜬 로컬 검증 페이지입니다. 실제 다나와 사이트나 설치된 확장 프로그램이 아닙니다.</p></header>
<main id="DnwListContents"><section id="original-filters"><h2>원래 사이트의 옵션 영역</h2><label><input id="original-cpu" type="checkbox" checked>코어i5</label><label><input type="checkbox" checked>RTX5060</label><label><input type="checkbox" checked>32GB</label></section>
<section id="productListArea"><h2>원래 사이트의 상품 목록</h2><article>원래 상품 목록 ① · 조건픽을 열고 닫아도 유지</article><article>원래 상품 목록 ② · 기존 링크와 옵션 유지</article></section></main>
<script type="module" src="/preview-host.js"></script></html>`;
const mime = { '.js': 'text/javascript; charset=utf-8', '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const port = Number(new URL(import.meta.url).searchParams.get('port')) || 4173;
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
  try {
    let body, ext = path.extname(pathname);
    if (pathname === '/') { body = fixture; ext = '.html'; }
    else if (pathname === '/preview-host.js' || pathname === '/preview-frame.js') body = readFileSync(path.join(root, 'scripts', path.basename(pathname)));
    else if (pathname.startsWith('/extension/') && allowed.has(path.basename(pathname))) {
      body = readFileSync(path.join(root, 'extension', path.basename(pathname)));
      if (pathname === '/extension/view.html') body = body.toString().replace('src="view.js"', 'src="/preview-frame.js"');
    } else { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': mime[ext] || 'text/plain', 'Cache-Control': 'no-store' });
    res.end(body);
  } catch (error) { res.writeHead(500); res.end(error.message); }
});
server.on('error', error => console.error('Preview server:', error.message));
server.listen(port, '127.0.0.1', () => console.log('Local display fixture: http://127.0.0.1:' + port));
