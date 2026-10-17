import {IDS, GRACE, createState, normalizeState, setNap, pauseNap, collectDue, formatRemaining, planReminder, updateReminder, formatFullDate} from './scheduler.mjs';
import {Player} from './player.mjs';
import {ReminderEditor,reminderControls} from './reminder-editor.mjs';
const $ = selector => document.querySelector(selector);
const KEY = 'day-rhythm:v1';
const icon = name => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const scenes = {
  morning: {side:'A', icon:'sun', name:'晨间起床', title:'Morning light', phrase:'日出之前，把美好叫醒', subtitle:'从轻轻唤醒，到精神满满。', image:'morning', track:'晨光渐起', kind:'每日提醒', duration:'18s', note:'渐强旋律 · 温柔唤醒', ready:'新的一天，正等着你。'},
  nap: {side:'B', icon:'leaf', name:'午后小憩', title:'A little pause', phrase:'短暂休息，刚刚好', subtitle:'给自己一段恰到好处的留白。', image:'afternoon', track:'午后轻铃', kind:'倒计时', duration:'6s', note:'清晰轻快 · 轻盈归来', ready:'午睡结束，慢慢醒来吧。'},
  night: {side:'C', icon:'moon', name:'晚间入眠', title:'Softly, goodnight', phrase:'把今天，轻轻放下', subtitle:'收起忙碌，给夜晚一个晚安。', image:'night', track:'月色低语', kind:'每日提醒', duration:'16s', note:'柔和音垫 · 安心入夜', ready:'放下手边的事，准备睡觉吧。'}
};
let storageOK = true, state, armed = false, leader = !navigator.locks, lockPending = false, wakeLock, toastTimer;
try {state = normalizeState(JSON.parse(localStorage.getItem(KEY)));} catch {state = createState();}
let activeEvent = null;
function persist() {
  try {localStorage.setItem(KEY, JSON.stringify(state)); storageOK = true; $('#save-state').textContent = '已自动保存到此浏览器';}
  catch {storageOK = false; $('#save-state').textContent = '保存失败：请允许浏览器本地存储';}
}
function toast(message) {$('#toast').textContent = message; $('#toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').hidden = true, 4200);}
function renderCards() {
  $('#scene-grid').innerHTML = IDS.map(id => {
    const s = scenes[id], v = state[id];
    return `<article class="scene-card ${id}" id="card-${id}" aria-labelledby="title-${id}">
    <div class="card-top"><span class="side-tag">${icon(s.icon)} SIDE ${s.side}<span> / </span>${id === 'morning' ? 'RISE' : id === 'nap' ? 'REST' : 'UNWIND'}</span><button class="switch" role="switch" aria-checked="${v.enabled}" aria-label="${s.name}提醒开关" data-toggle="${id}"></button></div>
    <div class="turntable" aria-label="${s.name}唱片，未播放"><div class="record" aria-hidden="true"><span class="record-label"><img src="assets/${s.image}.png" alt=""></span></div><div class="sleeve"><img class="cover-art" src="assets/${s.image}.png" alt="${id === 'morning' ? '杏色晨光洒向金色丘陵' : id === 'nap' ? '午后窗边的冰茶与绿梨' : '新月映照靛蓝海湾和温暖灯火'}"><div class="cover-text"><small>DAY RHYTHM / ${s.side}</small><strong>${s.title}</strong><span>${s.phrase}</span></div></div><div class="tonearm" aria-hidden="true"><i></i></div></div>
    <div class="card-description"><h2 id="title-${id}">${s.name}</h2><span class="scene-kind">${s.kind}</span></div><p class="scene-subtitle">${s.subtitle}</p>
    ${id === 'nap' ? `<div class="schedule-label"><label for="time-nap">小憩时长</label><span>留一点时间给自己</span></div><div class="schedule-input nap-input"><input id="time-nap" type="number" min="1" max="180" step="1" value="${v.minutes}" aria-label="午睡时长（分钟）"><span id="nap-unit">分钟</span><output id="nap-time" class="nap-time" hidden aria-live="off" aria-label="午睡剩余时间"></output></div><div class="nap-presets">${[15,20,30].map(n=>`<button class="preset ${n===v.minutes ? 'selected' : ''}" data-minutes="${n}">${n} 分钟</button>`).join('')}<button class="reset-nap" id="reset-nap" aria-label="重置午睡倒计时">重置</button></div>` : reminderControls(id,s.name,v)}
    <p class="scene-next" id="next-${id}"></p>
    <div class="audio-caption"><span>${s.track}</span><span>ORIGINAL · ${s.duration}</span></div><div class="volume-row"><label for="volume-${id}" aria-label="${s.name}音量">${icon('volume')}</label><input type="range" id="volume-${id}" min="0" max="100" step="1" value="${v.volume}" style="--volume:${v.volume}%" aria-label="${s.name}音量"><output id="volume-value-${id}" aria-live="off" for="volume-${id}">${v.volume}%</output></div>
    <div class="card-actions"><button class="preview-button" data-preview="${id}" aria-label="试听${s.track}">${icon('play')}<span>试听铃声</span></button>${id==='nap' ? `<button class="nap-start" id="nap-start">开始午睡 ${icon('arrow')}</button>` : ''}</div><div class="card-bottom-note"><span>${s.note}</span><span id="status-${id}">33⅓ RPM</span></div></article>`;
  }).join('');
}
renderCards();
const editors={};
const sceneError=(id,now=Date.now())=>state[id].completedAt ? '' : planReminder(state[id],now).error;
function editReminder(id,fields) {
  cancelScene(id);
  updateReminder(state,id,fields);
  persist();syncInputs();tick();
}
for(const id of ['morning','night'])editors[id]=new ReminderEditor(id,scenes[id].name,fields=>editReminder(id,fields));
const player = new Player($('#audio'), renderPlayer, (previous, reason) => {
  if (previous.mode === 'alert' && reason !== 'switch' && activeEvent) {
    state.pending = state.pending.filter(e => e.id !== activeEvent.id || e.due !== activeEvent.due);
    activeEvent = null; persist(); queueMicrotask(processPending);
  }
});
function renderPlayer(current) {
  for (const id of IDS) {
    const playing = current?.id === id && current.status === 'playing';
    $(`#card-${id}`).classList.toggle('playing', playing);
    $(`#card-${id} .turntable`).setAttribute('aria-label', `${scenes[id].name}唱片，${playing ? '正在播放' : '未播放'}`);
    const button = $(`[data-preview="${id}"]`);
    const selected = current?.id === id && current.mode !== 'unlock';
    button.innerHTML = `${icon(selected ? 'stop' : 'play')}<span>${selected ? '停止播放' : '试听铃声'}</span>`;
    button.setAttribute('aria-label', selected ? `停止${scenes[id].track}` : `试听${scenes[id].track}`);
    $(`#status-${id}`).textContent = selected ? current.status === 'playing' ? 'NOW PLAYING' : '等待播放' : '33⅓ RPM';
  }
  const show = current && current.mode !== 'unlock';
  $('#player-bar').hidden = !show;
  if (!show) {document.title = 'Day Rhythm · 日常有声'; return;}
  const s = scenes[current.id];
  const blocked = ['blocked', 'paused'].includes(current.status);
  $('#player-title').textContent = `${current.mode === 'alert' ? '提醒时间到了' : '正在试听'} · ${s.track}`;
  $('#player-description').textContent = blocked ? '声音未能播放，请点击播放提醒。' : current.mode === 'alert' ? s.ready : '放松一下，听听今天的节奏。';
  $('#player-bar').classList.toggle('waiting', current.status !== 'playing');
  $('#resume-alert').hidden = !blocked;
  document.title = `${current.mode === 'alert' ? '该' + s.name + '了' : '♪ ' + s.track} · Day Rhythm`;
}
function soundStatus() {
  $('#sound-dot').classList.toggle('ready', armed && leader);
  $('#enable-sound span').textContent = armed ? '重新测试声音' : '启用提醒声音';
  if (!leader) {
    $('#sound-title').textContent = '另一个页面正在守候提醒';
    $('#sound-description').textContent = '请在负责提醒的页面启用声音；关闭它后，此页面会自动接手。';
  } else {
    $('#sound-title').textContent = armed ? '声音已就绪，好好过今天' : '让今天，有声一点';
    $('#sound-description').textContent = armed ? '保持页面打开和设备唤醒。后台或锁屏仍可能延迟提醒。' : '首次使用或刷新后，点击启用声音，让提醒准时被听见。';
    if (!navigator.locks) $('#sound-description').textContent += ' 此浏览器请只保留一个提醒页面。';
  }
}
async function enableSound() {
  if (player.current?.mode === 'alert') return resumeCurrent();
  const success = await player.play('unlock', 'unlock', 100);
  if (success) {armed = true; if (player.current?.mode === 'unlock') player.stop('unlock'); soundStatus(); toast('声音已启用；可试听三张唱片。'); processPending();}
  else {armed = false; soundStatus(); toast('未能启用声音，请检查浏览器权限与系统音量。');}
}
function processPending() {
  if (!leader || activeEvent || !state.pending.length) return;
  const now = Date.now();
  state.pending = state.pending.filter(e => now - e.due <= GRACE && (state[e.id].enabled || state[e.id].completedAt===e.due));
  if (!state.pending.length) {persist(); return;}
  activeEvent = state.pending[0];
  $('#announcement').textContent = `${scenes[activeEvent.id].name}提醒时间到了。${scenes[activeEvent.id].ready}${armed ? '' : '请点击播放提醒。'}`;
  if (armed) player.play(activeEvent.id, 'alert', state[activeEvent.id].volume).then(ok => {if (!ok) {armed = false; soundStatus();}});
  else {
    player.stop('switch');
    player.current = {id:activeEvent.id, mode:'alert', status:'blocked', until:null};
    renderPlayer(player.current);
  }
}
async function resumeCurrent() {
  const current = player.current;
  if (!current) return;
  const ok = await player.play(current.id, current.mode, state[current.id].volume);
  armed = ok; soundStatus();
}
function sceneDue(id) {return id === 'nap' ? state.nap.deadline : state[id].nextDue;}
function syncInputs() {
  for (const id of IDS) {
    const s = state[id];
    $(`[data-toggle="${id}"]`).setAttribute('aria-checked', s.enabled);
    $(`#volume-${id}`).value = s.volume;
    $(`#volume-${id}`).style.setProperty('--volume', s.volume+'%');
    $(`#volume-value-${id}`).textContent = `${s.volume}%`;
    if(id==='nap') {if (document.activeElement !== $('#time-nap')) $('#time-nap').value=s.minutes;}
    else {
      editors[id].sync(s,sceneError(id));
      $(`#card-${id} .scene-kind`).textContent=s.repeat==='once'?'单次提醒':'每天重复';
    }
  }
  for (const button of document.querySelectorAll('[data-minutes]')) button.classList.toggle('selected', Number(button.dataset.minutes) === state.nap.minutes);
  $('#reduced-motion').checked = state.reduced;
  document.documentElement.classList.toggle('reduced-motion', state.reduced);
}
function renderTime(now = Date.now()) {
  const date = new Date(now), parts = [date.getHours(),date.getMinutes(),date.getSeconds()].map(n=>String(n).padStart(2,'0'));
  $('#live-clock').innerHTML = `${parts[0]}<span>:</span>${parts[1]}<span>:</span><small>${parts[2]}</small>`;
  $('#today-date').textContent = date.toLocaleDateString('zh-CN',{month:'long',day:'numeric',weekday:'long'});
  for (const id of IDS) {
    const s = state[id], el = $(`#next-${id}`), due = sceneDue(id);
    el.classList.toggle('enabled', s.enabled && !!due);
    if(id==='nap') {
      el.textContent=due ? `预计结束：${formatFullDate(due,now,true)}\n还有 ${formatRemaining(due-now)}` : s.remaining ? `已暂停 · 剩余 ${formatRemaining(s.remaining)}\n继续后预计结束：${formatFullDate(now+s.remaining,now,true)}` : `开始后预计结束：${formatFullDate(now+s.minutes*60_000,now,true)}${s.enabled?'':'\n午睡提醒已关闭'}`;
    } else {
      const error=sceneError(id,now);editors[id].showError(error);editors[id].refreshDate(s,now);
      $(`[data-toggle="${id}"]`).setAttribute('aria-checked',s.enabled);
      const wasMissed=s.completedAt && state.history.some(e=>e.id===id&&e.at===s.completedAt&&e.status==='missed');
      const displayedDue=s.enabled ? due : planReminder(s,now).due;
      el.textContent=s.completedAt ? `仅这一次 · ${wasMissed?'已错过':'已完成'}\n${formatFullDate(s.completedAt,now)}` : error ? '尚未安排提醒，请修改上方设置。' : `${s.enabled?'下次提醒':'尚未开启 · 预计提醒'}（${s.repeat==='once'?'仅这一次':'每天重复'}）\n${formatFullDate(displayedDue,now)}${s.enabled?'\n还有 '+formatRemaining(due-now):''}`;
    }
  }
  const napActive = !!state.nap.deadline || !!state.nap.remaining;
  $('#time-nap').hidden = napActive; $('#nap-unit').hidden = napActive; $('#nap-time').hidden = !napActive;
  $('#nap-time').textContent = formatRemaining(state.nap.deadline ? state.nap.deadline - now : state.nap.remaining || 0);
  $('#nap-start').innerHTML = `${state.nap.deadline ? '暂停计时' : state.nap.remaining ? '继续午睡' : '开始午睡'} ${icon(state.nap.deadline ? 'stop' : 'arrow')}`;
  const upcoming = IDS.filter(id => state[id].enabled && sceneDue(id)).map(id=>({id,due:sceneDue(id)})).sort((a,b)=>a.due-b.due)[0];
  $('#next-reminder').textContent = upcoming ? `${scenes[upcoming.id].name} · ${formatFullDate(upcoming.due,now,upcoming.id==='nap')}` : '为今天，设一个小小的期待';
  $('#next-countdown').textContent = upcoming ? formatRemaining(upcoming.due-now) : '— — : — — : — —';
}
function tick() {
  const now = Date.now(); player.checkDeadline(now);
  if (leader) {
    const {events, missed} = collectDue(state, now);
    if (events.length || missed.length) {
      state.pending.push(...events); persist();
      if (missed.length) toast(`${missed.map(e=>scenes[e.id].name).join('、')}已错过，未补响。`);
    }
    processPending();
  }
  renderTime(now);
}
function cancelScene(id) {
  state.pending = state.pending.filter(e=>e.id!==id);
  if (activeEvent?.id === id) activeEvent = null;
  if (player.current?.id === id) player.stop('disabled');
}
$('#enable-sound').addEventListener('click', enableSound);
$('#scene-grid').addEventListener('click', async event => {
  const preview = event.target.closest('[data-preview]');
  if (preview) {
    const id = preview.dataset.preview;
    if (player.current?.id === id) {player.stop(); return;}
    if (activeEvent) {toast('先停止当前提醒，再试听其他唱片。'); return;}
    const ok = await player.play(id, 'preview', state[id].volume);
    if (ok) {armed=true; soundStatus();} return;
  }
  const toggle = event.target.closest('[data-toggle]');
  if (toggle) {
    const id = toggle.dataset.toggle, s = state[id], enabled = !s.enabled;
    if (id === 'nap') {if (!enabled) pauseNap(state); s.enabled=enabled;}
    else {cancelScene(id);updateReminder(state,id,{enabled});}
    if (!enabled) cancelScene(id);
    persist(); syncInputs(); tick(); return;
  }
  const preset = event.target.closest('[data-minutes]');
  if (preset) {
    if (state.nap.deadline || state.nap.remaining) {toast('请先重置倒计时，再选择新的时长。'); return;}
    state.nap.minutes=Number(preset.dataset.minutes); persist(); syncInputs(); tick();
  }
});
for (const id of IDS) {
  if(id==='nap') $(`#time-${id}`).addEventListener('change', event => {
    const input = event.target;
    if (!input.checkValidity() || !input.value) {input.reportValidity(); return;}
    state.nap.minutes = Number(input.value);
    persist(); syncInputs(); tick();
  });
  $(`#volume-${id}`).addEventListener('input', event => {
    const value = Number(event.target.value); state[id].volume=value;
    event.target.style.setProperty('--volume', value+'%'); $(`#volume-value-${id}`).textContent = value+'%';
    if (player.current?.id === id) player.setVolume(value);
    persist();
  });
}
$('#nap-start').addEventListener('click', () => {
  if (state.nap.deadline) pauseNap(state);
  else {
    if (!state.nap.remaining && !$('#time-nap').checkValidity()) {$('#time-nap').reportValidity(); return;}
    if (!state.nap.remaining) state.nap.minutes=Number($('#time-nap').value);
    if (state.nap.minutes < 1 || state.nap.minutes > 180) return;
    setNap(state,state.nap.remaining || state.nap.minutes*60_000);
    if (!armed) enableSound();
  }
  persist(); syncInputs(); tick();
});
$('#reset-nap').addEventListener('click', () => {cancelScene('nap'); Object.assign(state.nap,{deadline:null,remaining:null}); persist(); syncInputs(); tick(); toast('午睡倒计时已重置');});
$('#stop-all').addEventListener('click', () => player.stop());
$('#resume-alert').addEventListener('click', resumeCurrent);
document.addEventListener('keydown', event => {if(event.key === 'Escape' && !$('#guide').open) player.stop();});
$('#reduced-motion').addEventListener('change', event=>{state.reduced=event.target.checked; syncInputs(); persist();});
$('#save-settings').addEventListener('click',()=> {
  for(const id of ['morning','night']) {
    if(sceneError(id)){editors[id].showError(sceneError(id));$(`#time-${id}`).focus();toast('请先补全或修改日期和时间，当前无效提醒不会触发。');return;}
  }
  if(!$('#time-nap').checkValidity()){$('#time-nap').reportValidity();return;}
  persist(); toast(storageOK ? '已保存。下次打开，还是熟悉的节奏。' : '未能保存，请检查浏览器本地存储权限。');
});
function openGuide() {
  const list = $('#history-list'); list.replaceChildren();
  for (const item of state.history.slice(-10).reverse()) {const li=document.createElement('li'); li.textContent=`${new Date(item.at).toLocaleString('zh-CN')} · ${scenes[item.id].name} · ${item.status==='missed'?'已错过':'已触发'}`; list.append(li);}
  if(!list.children.length){const li=document.createElement('li'); li.textContent='还没有提醒记录，慢慢开始就好。';list.append(li);}
  $('#guide').showModal();
}
$('#guide-open').addEventListener('click',openGuide); $('#limits-open').addEventListener('click',openGuide);
$('#guide-close').addEventListener('click',()=>$('#guide').close());
$('#guide').addEventListener('click',event=>{if(event.target===$('#guide')){const rect=$('#guide').getBoundingClientRect(); if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom) $('#guide').close();}});
$('#test-reminder').addEventListener('click',()=> {
  if(state.nap.deadline || state.nap.remaining || activeEvent) {toast('请先结束或重置当前午睡，再体验提醒。');return;}
  setNap(state,10_000);persist();syncInputs();tick();enableSound();$('#guide').close();toast('10 秒体验已开始，到点将播放午后轻铃。');
});
async function requestWake() {
  if(!$('#keep-awake').checked || document.hidden) return;
  try {wakeLock=await navigator.wakeLock.request('screen');$('#wake-status').textContent='屏幕常亮已开启，仅在此页面可见时有效。';wakeLock.addEventListener('release',()=>{$('#wake-status').textContent=$('#keep-awake').checked ? '常亮已释放；页面可见时会重新申请。' : '已关闭屏幕常亮。';});}
  catch {$('#wake-status').textContent='此环境无法保持常亮，请检查浏览器和省电设置。';}
}
$('#keep-awake').addEventListener('change',()=>{if($('#keep-awake').checked) requestWake();else {wakeLock?.release();$('#wake-status').textContent='已关闭屏幕常亮。';}});
if(!navigator.wakeLock){$('#keep-awake').disabled=true;$('#wake-status').textContent='当前浏览器不支持屏幕常亮。';}
document.addEventListener('visibilitychange',()=>{tick();if(!document.hidden)requestWake();});
window.addEventListener('pageshow',tick); window.addEventListener('focus',tick);
window.addEventListener('storage',event=> {
  if(event.key!==KEY)return;
  try{state=normalizeState(JSON.parse(event.newValue));}catch{return;}
  if(activeEvent && !state.pending.some(e=>e.id===activeEvent.id&&e.due===activeEvent.due)) {activeEvent=null;player.stop('external');}
  if(player.current && player.current.id!=='unlock' && player.current.mode==='alert' && !state[player.current.id].enabled && state[player.current.id].completedAt!==activeEvent?.due)player.stop('external');
  if(player.current && state[player.current.id])player.setVolume(state[player.current.id].volume);
  syncInputs();tick();
});
function tryLock() {
  if(!navigator.locks || leader || lockPending)return;
  lockPending=true;
  navigator.locks.request('day-rhythm-scheduler',{ifAvailable:true},async lock=> {
    if(!lock)return;
    leader=true; soundStatus();tick();
    await new Promise(resolve=>window.addEventListener('pagehide',resolve,{once:true}));
    leader=false; lockPending=false;
  }).finally(()=>lockPending=false);
}
syncInputs();soundStatus();tryLock();tick();
setInterval(tick,500);setInterval(tryLock,2000);
