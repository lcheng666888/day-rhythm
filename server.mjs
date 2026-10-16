import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
const root = path.dirname(fileURLToPath(import.meta.url));
const mime = {'.html': 'text/html; charset=utf-8', '.css': 'text/css', '.mjs': 'text/javascript', '.js': 'text/javascript', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.wav': 'audio/wav', '.svg': 'image/svg+xml', '.json': 'application/json'};
const projectId = createHash('sha256').update(process.platform === 'win32' ? root.toLowerCase() : root).digest('hex');
function createServer() {return http.createServer(async (req, res) => {
  try {
    const name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (name === '/__day-rhythm/health') {
      res.writeHead(200, {'Content-Type':'application/json', 'Cache-Control':'no-store'});
      res.end(JSON.stringify({app:'day-rhythm',projectId})); return;
    }
    const target = path.resolve(root, '.' + (name === '/' ? '/index.html' : name));
    if (!target.startsWith(root + path.sep)) {res.writeHead(403).end(); return;}
    const info = await stat(target);
    if (!info.isFile()) throw new Error('not file');
    const data = await readFile(target);
    const range = req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
    const headers = {'Content-Type': mime[path.extname(target)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'Accept-Ranges': 'bytes'};
    if (range) {
      const start = Number(range[1]), end = Math.min(range[2] ? Number(range[2]) : data.length - 1, data.length - 1);
      if (start > end) {res.writeHead(416, {'Content-Range': `bytes */${data.length}`}).end(); return;}
      res.writeHead(206, {...headers, 'Content-Range': `bytes ${start}-${end}/${data.length}`, 'Content-Length': end - start + 1}); res.end(data.subarray(start, end + 1));
    } else {res.writeHead(200, {...headers, 'Content-Length': data.length}); res.end(data);}
  } catch {res.writeHead(404).end('Not found');}
});}

// Probe only loopback, and verify the project before reusing an occupied port.
function requestText(port, pathname) {
  return new Promise(resolve => {
    const request = http.get({hostname:'127.0.0.1',port,path:pathname,agent:false},response=>{
      let body='', size=0;
      response.setEncoding('utf8');
      response.on('data',chunk=>{size+=Buffer.byteLength(chunk); if(size>512_000){request.destroy();return;} body+=chunk;});
      response.on('end',()=>resolve(response.statusCode===200 ? body : null));
      response.on('error',()=>resolve(null));
    });
    request.setTimeout(700,()=>request.destroy());
    request.on('error',()=>resolve(null));
  });
}
async function isSameProject(port) {
  const health=await requestText(port,'/__day-rhythm/health');
  if (health) {
    try {const info=JSON.parse(health);if(info.app==='day-rhythm')return info.projectId===projectId;} catch {}
  }
  // The first release has no health endpoint. Compare both entry files so it
  // can be reused without terminating the user's already running server.
  const html=await requestText(port,'/');
  if (html !== await readFile(path.join(root,'index.html'),'utf8')) return false;
  return await requestText(port,'/app.mjs') === await readFile(path.join(root,'app.mjs'),'utf8');
}
function listen(port) {
  return new Promise((resolve,reject)=>{
    const server=createServer();
    server.once('error',reject);
    server.listen(port,'0.0.0.0',()=>{
      server.removeListener('error',reject);
      server.on('error',error=>{console.error(`Day Rhythm server error: ${error.message}`);});
      resolve(server);
    });
  });
}
function openBrowser(url) {
  const command=process.platform==='win32' ? 'rundll32.exe' : process.platform==='darwin' ? 'open' : 'xdg-open';
  const args=process.platform==='win32' ? ['url.dll,FileProtocolHandler',url] : [url];
  const opener=spawn(command,args,{detached:true,stdio:'ignore',windowsHide:true});
  opener.on('error',()=>console.error(`Could not open a browser automatically. Open ${url} manually.`));
  opener.unref();
}
async function start() {
  const raw=process.env.PORT || '4173', preferred=Number(raw);
  if(!/^\d+$/.test(raw)||!Number.isInteger(preferred)||preferred<0||preferred>65535)throw new Error('PORT must be an integer from 0 to 65535.');
  for(let attempt=0;attempt<20 && preferred+attempt<=65535;attempt++) {
    const candidate=preferred+attempt;
    try {
      const server=await listen(candidate);
      const url=`http://localhost:${server.address().port}`;
      console.log(`Day Rhythm ready: ${url}`);
      console.log('Keep this window open while using reminders.');
      if(process.argv.includes('--open'))openBrowser(url);
      return;
    } catch(error) {
      if(error.code!=='EADDRINUSE' && error.code!=='EACCES')throw error;
      if(error.code==='EADDRINUSE' && await isSameProject(candidate)) {
        const url=`http://localhost:${candidate}`;
        console.log(`Day Rhythm already running: ${url}`);
        console.log('Reusing the existing server. No second server is needed.');
        if(process.argv.includes('--open'))openBrowser(url);
        return;
      }
      console.log(`Port ${candidate} is unavailable; trying the next port.`);
    }
  }
  throw new Error('No available port found. Close an unused server or set PORT to another port.');
}
start().catch(error=>{console.error(`Day Rhythm could not start: ${error.message}`);process.exitCode=1;});
