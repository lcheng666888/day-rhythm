import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const source=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const runtime=path.dirname(source), base=process.argv[2] || 'http://localhost:4173';
const manifest=JSON.parse(await readFile(path.join(runtime,'evidence/file-manifest.json'),'utf8'));
const records=[];
for(const item of manifest.runtime.filter(i=>/\.(html|css|mjs|png|wav|svg)$/.test(i.path))) {
  const response=await fetch(new URL(item.path,base));
  const bytes=Buffer.from(await response.arrayBuffer());
  records.push({path:item.path,status:response.status,mime:response.headers.get('content-type'),bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),passed:response.ok&&createHash('sha256').update(bytes).digest('hex')===item.sha256});
}
const range=await fetch(new URL('assets/nap.wav',base),{headers:{Range:'bytes=0-43'}});
records.push({path:'assets/nap.wav (range 0-43)',status:range.status,range:range.headers.get('content-range'),passed:range.status===206&&(await range.arrayBuffer()).byteLength===44});
const missing=await fetch(new URL('missing-file-does-not-exist.html',base));
records.push({path:'missing-file-does-not-exist.html',status:missing.status,passed:missing.status===404});
const result={checkedAt:new Date().toISOString(),base,passed:records.every(i=>i.passed),records};
await writeFile(path.join(runtime,'evidence/http-check.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({passed:result.passed,requests:records.length,base}));
if(!result.passed)process.exitCode=1;
