import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

const entry = fileURLToPath(new URL('../server.mjs',import.meta.url));
function launch(port, t) {
  const child = spawn(process.execPath,[entry],{env:{...process.env,PORT:String(port)},windowsHide:true});
  let output='', errors='';
  const exited = new Promise(resolve=>child.once('exit',code=>resolve(code)));
  const ready = new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(new Error('startup timeout: '+output+errors)),8000);
    child.stdout.on('data',chunk=>{
      output+=chunk;
      const match=output.match(/http:\/\/localhost:(\d+)/);
      if(match){clearTimeout(timeout);resolve('http://localhost:'+match[1]);}
    });
    child.stderr.on('data',chunk=>errors+=chunk);
    child.once('exit',code=>{clearTimeout(timeout); if(!output.match(/http:\/\/localhost:(\d+)/)) reject(new Error(`server exited ${code}: ${errors}`));});
  });
  ready.catch(()=>{});
  t.after(()=>{if(child.exitCode===null)child.kill();});
  return {ready,exited,output:()=>output,errors:()=>errors};
}
async function mockServer(handler,t) {
  const server=http.createServer(handler);
  await new Promise(resolve=>server.listen(0,'0.0.0.0',resolve));
  t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  return server.address().port;
}
test('an unrelated occupied port falls back and serves Day Rhythm',async t=>{
  const port=await mockServer((req,res)=>res.end('another application'),t);
  const app=launch(port,t);
  const url=await app.ready;
  assert.notEqual(url,'http://localhost:'+port);
  const response=await fetch(url);
  assert.equal(response.status,200);
  assert.match(await response.text(),/Day Rhythm · 日常有声/);
  assert.equal(await (await fetch('http://localhost:'+port)).text(),'another application');
});
test('a repeated launch reuses the existing project and exits cleanly',async t=>{
  const first=launch(0,t), url=await first.ready;
  assert.notEqual(new URL(url).port,'0');
  const second=launch(Number(new URL(url).port),t);
  assert.equal(await second.ready,url);
  assert.equal(await second.exited,0);
  assert.match(second.output(),/already running/i);
  assert.equal(second.errors(),'');
  assert.equal((await fetch(url)).status,200);
});
test('a running first-version server is also reused without a health endpoint',async t=>{
  const html=await readFile(new URL('../index.html',import.meta.url));
  const app=await readFile(new URL('../app.mjs',import.meta.url));
  const port=await mockServer((req,res)=>{
    if(req.url==='/')res.end(html);
    else if(req.url==='/app.mjs')res.end(app);
    else res.writeHead(404).end('Not found');
  },t);
  const repeat=launch(port,t);
  assert.equal(await repeat.ready,'http://localhost:'+port);
  assert.equal(await repeat.exited,0);
  assert.equal(repeat.errors(),'');
});
test('an invalid port produces a readable error without a Node stack trace',async t=>{
  const app=launch('not-a-port',t);
  assert.equal(await app.exited,1);
  assert.match(app.errors(),/PORT must be/);
  assert.doesNotMatch(app.errors(),/node:events|throw er|at Server/);
});
