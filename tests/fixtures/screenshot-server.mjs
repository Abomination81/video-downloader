import http from 'node:http';
import { fileURLToPath } from 'node:url';
export async function startFixtures(port = 0) {
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push(req.url);
    const u = new URL(req.url, 'http://127.0.0.1');
    if (u.pathname === '/pixel.svg') { res.setHeader('content-type', 'image/svg+xml'); res.end('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="#00cc66"/></svg>'); return; }
    const mode = u.searchParams.get('mode') || 'basic';
    const height = Number(u.searchParams.get('height')) || 3100;
    const width = Number(u.searchParams.get('width')) || 0;
    if (mode === 'csp') res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self'");
    res.setHeader('content-type', 'text/html');
    res.end(`<!doctype html><html><head><meta charset="utf-8"><title>&lt;img src=x onerror=alert(1)&gt; private-token/../../secret</title><style>
      *{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;font:20px system-ui}main{width:${width ? width + 'px' : '100%'};height:${height}px;background:repeating-linear-gradient(to bottom,#eee 0px,#eee 99px,#123456 99px,#123456 100px);position:relative}
      .label{position:absolute;left:50px}.fixed{position:fixed;top:0;left:0;right:0;height:40px;background:#ee2233;z-index:10}.footer{position:fixed;bottom:0;left:0;right:0;height:30px;background:#bb22dd;z-index:10}.sticky{position:sticky;top:0;height:40px;background:#ffcc00}.nest{overflow:auto;height:300px;width:400px;background:#ddd}
      </style></head><body><main>${mode === 'fixed' ? '<div class="fixed">Header once</div><div class="footer">Footer once</div><div style="height:500px"></div><div class="sticky">Sticky once</div>' : ''}
      ${Array.from({ length: Math.floor(height / 100) }, (_, i) => `<span class="label" style="top:${i * 100 + 40}px">Row ${i}</span>`).join('')}
      ${mode === 'lazy' ? '<img loading="lazy" src="/pixel.svg" style="position:absolute;left:0;top:2400px;width:200px;height:100px">' : ''}
      ${mode === 'nested' ? '<div class="nest"><div style="height:900px">Nested scrolling panel</div></div>' : ''}
      </main><script>
      window.__still_private_capture_v1__ = {restore(){throw new Error('Hostile main-world trap')}};
      window.postMessage({type:'capture',tabId:1},'*');
      if(${JSON.stringify(mode)}==='growth') addEventListener('scroll',()=>{document.querySelector('main').style.height=(document.querySelector('main').offsetHeight+200)+'px'});
      if(${JSON.stringify(mode)}==='complex') {const host=document.createElement('div');host.innerHTML='<i></i>'.repeat(16000);document.body.append(host)}
      </script></body></html>`);
  });
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  return { server, requests, origin: `http://127.0.0.1:${server.address().port}` };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { origin } = await startFixtures(8732); console.log(`Fixtures: ${origin}`);
}
