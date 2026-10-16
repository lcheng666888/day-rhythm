"""Parse the delivery, validate local dependencies, and fingerprint every file.
Run: python artifacts/source/tools/parse_delivery.py (Python standard library).
Reports are written outside the committed source, under artifacts/evidence/.
"""
from pathlib import Path
from html.parser import HTMLParser
from datetime import datetime, timezone
import hashlib
import json
import re
import struct
import subprocess
import wave
from array import array
import math

SOURCE = Path(__file__).resolve().parents[1]
RUNTIME = SOURCE.parent
EVIDENCE = RUNTIME / 'evidence'
ERRORS = []


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def inspect_file(path, root):
    return {'path': path.relative_to(root).as_posix(), 'bytes': path.stat().st_size, 'sha256': digest(path)}


def dependency(value, parent):
    if not value or value.startswith(('#', 'data:')):
        return None
    if re.match(r'^(https?:)?//', value):
        ERRORS.append(f'External runtime dependency: {value}')
        return None
    path = (parent / value.split('#')[0].split('?')[0]).resolve()
    if not path.is_relative_to(RUNTIME) or not path.is_file():
        ERRORS.append(f'Unresolved runtime dependency: {value}')
    return path


class PageParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.ids = []
        self.resources = []
        self.tags = {}
        self.language = None
        self.viewport = None

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        self.tags[tag] = self.tags.get(tag, 0) + 1
        if 'id' in attrs:
            self.ids.append(attrs['id'])
        if tag == 'html':
            self.language = attrs.get('lang')
        if tag == 'meta' and attrs.get('name') == 'viewport':
            self.viewport = attrs.get('content')
        if tag in ('link', 'script', 'img', 'audio', 'source'):
            value = attrs.get('src') or attrs.get('href')
            if value:
                self.resources.append({'tag': tag, 'url': value})
                dependency(value, RUNTIME)


EVIDENCE.mkdir(exist_ok=True)
page = PageParser()
page.feed((RUNTIME / 'index.html').read_text(encoding='utf-8'))
duplicates = sorted({value for value in page.ids if page.ids.count(value) > 1})
if duplicates:
    ERRORS.append(f'Duplicate HTML IDs: {duplicates}')
if page.language != 'zh-CN' or not page.viewport:
    ERRORS.append('Missing Chinese language or responsive viewport metadata')

modules = []
for path in sorted(RUNTIME.glob('*.mjs')):
    content = path.read_text(encoding='utf-8')
    imports = re.findall(r'(?:from\s*|import\s*)[\'"]([^\'"\n]+)[\'"]', content)
    for value in imports:
        if value.startswith('.'):
            dependency(value, path.parent)
    syntax = subprocess.run(['node', '--check', str(path)], capture_output=True, text=True, encoding='utf-8')
    if syntax.returncode:
        ERRORS.append(f'Syntax error: {path.name}: {syntax.stderr}')
    modules.append({'path': path.name, 'imports': imports, 'nodeSyntaxCheck': syntax.returncode == 0})

css_urls = re.findall(r'url\(\s*([\'"]?)(.*?)\1\s*\)', (RUNTIME / 'styles.css').read_text(encoding='utf-8'))
for _, value in css_urls:
    dependency(value, RUNTIME)

assets = []
for path in sorted((RUNTIME / 'assets').iterdir()):
    item = inspect_file(path, RUNTIME)
    if path.suffix == '.png':
        data = path.read_bytes()
        if data[:8] != b'\x89PNG\r\n\x1a\n':
            ERRORS.append(f'Invalid PNG: {path.name}')
        item['width'], item['height'] = struct.unpack('>II', data[16:24])
    if path.suffix == '.wav':
        with wave.open(str(path), 'rb') as audio:
            item.update(channels=audio.getnchannels(), sampleRate=audio.getframerate(), sampleBits=audio.getsampwidth()*8, durationSeconds=audio.getnframes()/audio.getframerate())
            samples = array('h', audio.readframes(audio.getnframes()))
            item['peak'] = round(max(abs(v) for v in samples)/32768, 6)
            if path.name != 'silence.wav' and (item['peak'] == 0 or item['peak'] >= 1):
                ERRORS.append(f'Silent or clipped music: {path.name}')
            if path.name == 'morning.wav':
                rate = item['sampleRate']
                def rms(a, b):
                    return round(math.sqrt(sum(v*v for v in samples[a*rate:b*rate])/((b-a)*rate))/32768, 6)
                item['crescendoRms'] = [rms(0,4),rms(8,12),rms(12,15)]
                if item['crescendoRms'] != sorted(item['crescendoRms']):
                    ERRORS.append('Morning melody did not gradually increase')
    assets.append(item)

expected = ['morning.png','afternoon.png','night.png','morning.wav','nap.wav','night.wav','silence.wav','favicon.svg']
for name in expected:
    if not (RUNTIME / 'assets' / name).is_file():
        ERRORS.append(f'Missing dynamically referenced asset: {name}')

runtime_files = sorted([p for p in RUNTIME.iterdir() if p.is_file()] + list((RUNTIME / 'assets').glob('*')))
runtime_manifest = []
for path in runtime_files:
    item = inspect_file(path, RUNTIME)
    original = SOURCE / path.relative_to(RUNTIME)
    item['matchesSource'] = original.is_file() and digest(original) == item['sha256']
    if not item['matchesSource']:
        ERRORS.append(f'Runtime differs from source: {item["path"]}')
    runtime_manifest.append(item)

source_manifest = [inspect_file(p, SOURCE) for p in sorted(SOURCE.rglob('*')) if p.is_file() and '.git' not in p.relative_to(SOURCE).parts and '__pycache__' not in p.parts]
git = subprocess.run(['git','-C',str(SOURCE),'rev-parse','HEAD'],capture_output=True,text=True)
report = {'generatedAt': datetime.now(timezone.utc).isoformat(), 'sourceCommit': git.stdout.strip() if git.returncode == 0 else None,
          'html': {'parser':'Python html.parser.HTMLParser','language':page.language,'viewport':page.viewport,'tagCounts':page.tags,'uniqueIds':len(set(page.ids)),'duplicateIds':duplicates,'resources':page.resources},
          'modules':modules,'css':{'urls':len(css_urls),'externalDependencies':0},'assets':assets,
          'runtimeFileCount':len(runtime_manifest),'sourceFileCount':len(source_manifest),'errors':ERRORS,'passed':not ERRORS}
manifest = {'algorithm':'SHA-256','runtimeBase':'artifacts/','sourceBase':'artifacts/source/','runtime':runtime_manifest,'source':source_manifest}
(EVIDENCE/'parse-record.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
(EVIDENCE/'file-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'passed':not ERRORS,'runtimeFiles':len(runtime_manifest),'sourceFiles':len(source_manifest),'htmlIds':len(set(page.ids)),'modules':len(modules),'assets':len(assets),'errors':ERRORS},ensure_ascii=False))
raise SystemExit(1 if ERRORS else 0)
