import http from 'node:http';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const allowed = new Set(['view.html', 'view.css', 'view.js', 'model.js', 'search-model.js', 'background.js', 'danawa.js', 'collector.js', 'content.js']);
const fixture = `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>??? ?? ?? ? ??? ??? ?? ??</title>
<style>body{font:15px/1.6 system-ui;margin:0;background:#f1f4f8;color:#202d42}header,main{max-width:1080px;margin:auto;padding:24px}header{background:#fff}h1{font-size:24px;margin:0}section{background:#fff;padding:20px;border:1px solid #d4ddea;border-radius:10px;margin:16px 0}h2{font-size:18px}label{margin-right:16px}#productListArea article{padding:16px;border-top:1px solid #d4ddea}a{color:#164f9e}</style>
<header><h1>??? ?? ??</h1><p>???? ??? ?? ?? ?? ??????. ?? ??? ???? ??? ?? ????? ????.</p></header>
<main id="DnwListContents"><section id="original-filters"><h2>????</h2>
<div><div><div>CPU ??</div><div><div><button id="attr-cpu-5-0" role="checkbox" aria-checked="true"></button><label for="attr-cpu-5-0">??i5</label></div><div><button id="attr-cpu-7-1" role="checkbox" aria-checked="false"></button><label for="attr-cpu-7-1">??i7</label></div></div></div></div>
<div><div><div>GPU ??</div><div><div><button id="attr-gpu-5060-0" role="checkbox" aria-checked="true"></button><label for="attr-gpu-5060-0">RTX5060</label></div></div></div></div>
<div><div><div>?</div><div><div><button id="attr-ram-32-0" role="checkbox" aria-checked="true"></button><label for="attr-ram-32-0">32GB</label></div></div></div></div>
<div><div>???</div><div><input aria-label="?? ??" placeholder="?? ??"><input aria-label="?? ??" placeholder="?? ??"><button>??</button></div></div></section>
<label>?????<button id="preview-shipping" role="switch" aria-checked="false">OFF</button></label>
<section id="productListArea"><h2>?? ???? ?? ??</h2><article>?? ?? ?? ? ? ???? ?? ??? ??</article><article>?? ?? ?? ? ? ?? ??? ?? ??</article></section></main>
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
