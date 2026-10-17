export const IDS = ['morning', 'nap', 'night'];
export const GRACE = 5 * 60_000;
export const validTime = value => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
const clamp = (v, min, max, fallback) => Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
const pad = n => String(n).padStart(2,'0');
export function localDate(now = Date.now()) {
  const d=new Date(now); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}
export function dateAfter(now = Date.now(), days = 1) {
  const d=new Date(now); d.setDate(d.getDate()+days); return localDate(d);
}
export function dateTime(date,time) {
  if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!validTime(time))return null;
  const [y,m,d]=date.split('-').map(Number),[h,min]=time.split(':').map(Number);
  if(y<1000)return null;
  const value=new Date(y,m-1,d,h,min,0,0);
  if(value.getFullYear()!==y||value.getMonth()!==m-1||value.getDate()!==d||value.getHours()!==h||value.getMinutes()!==min)return null;
  return value.getTime();
}
export function planReminder(scene, now = Date.now()) {
  if(!validTime(scene.time))return {due:null,error:'请完整输入 24 小时时间 HH:MM（00:00–23:59）。'};
  if(dateTime(scene.date,'12:00')===null)return {due:null,error:'请选择完整、有效的提醒日期。'};
  if(scene.repeat!=='once' && scene.repeat!=='daily')return {due:null,error:'请选择仅这一次或每天重复。'};
  const today=localDate(now);
  let date=scene.repeat==='daily' && scene.date<today ? today : scene.date;
  let due=dateTime(date,scene.time);
  if(due===null)return {due:null,error:'所选时间在当前时区不存在，请换一个时间。'};
  if(scene.repeat==='once' && due<=now)return {due:null,error:'所选日期或时间已过，请修改时间或选择明天。'};
  if(scene.repeat==='daily' && due<=now) {date=dateAfter(now,1);due=dateTime(date,scene.time);}
  if(due===null)return {due:null,error:'所选时间在当前时区不存在，请换一个时间。'};
  return {due,error:''};
}
export function updateReminder(state,id,fields,now=Date.now()) {
  if(!['morning','night'].includes(id))throw new Error('无效提醒场景');
  const scene=state[id];
  for(const key of ['date','time','repeat','enabled'])if(Object.hasOwn(fields,key))scene[key]=fields[key];
  scene.completedAt=null;
  const plan=planReminder(scene,now);scene.nextDue=plan.due;return plan.error;
}
export function formatFullDate(at,now=Date.now(),seconds=false) {
  const d=new Date(at),date=localDate(at);
  const relative=date===localDate(now)?'今天，':date===dateAfter(now,1)?'明天，':'';
  return `${relative}${d.getFullYear()} 年 ${d.getMonth()+1} 月 ${d.getDate()} 日，周${'日一二三四五六'[d.getDay()]} ${pad(d.getHours())}:${pad(d.getMinutes())}${seconds?':'+pad(d.getSeconds()):''}`;
}
export function nextDaily(time, now = Date.now()) {
  const [h, m] = time.split(':').map(Number);
  const date = new Date(now);
  date.setHours(h, m, 0, 0);
  if (date.getTime() <= now) date.setDate(date.getDate() + 1);
  return date.getTime();
}
export function createState(now = Date.now()) {
  return {version: 2, reduced: false, history: [], pending: [],
    morning: {time: '07:30', date:localDate(now), repeat:'daily', completedAt:null, enabled: false, volume: 65, nextDue: nextDaily('07:30', now)},
    nap: {minutes: 20, enabled: true, volume: 60, deadline: null, remaining: null},
    night: {time: '22:30', date:localDate(now), repeat:'daily', completedAt:null, enabled: false, volume: 40, nextDue: nextDaily('22:30', now)}};
}
export function normalizeState(raw, now = Date.now()) {
  const state = createState(now);
  if (!raw || typeof raw !== 'object') return state;
  for (const id of IDS) {
    const source = raw[id];
    if (!source || typeof source !== 'object') continue;
    const scene = state[id];
    if (typeof source.enabled === 'boolean') scene.enabled = source.enabled;
    scene.volume = clamp(source.volume, 0, 100, scene.volume);
    if (id === 'nap') {
      scene.minutes = Math.round(clamp(source.minutes, 1, 180, 20));
      scene.deadline = Number.isFinite(source.deadline) && source.deadline > 0 && source.deadline <= now + 181 * 60_000 ? source.deadline : null;
      scene.remaining = Number.isFinite(source.remaining) && source.remaining > 0 ? clamp(source.remaining, 1, 180 * 60_000, null) : null;
      if (!scene.enabled && scene.deadline) {scene.remaining = Math.max(1, scene.deadline - now); scene.deadline = null;}
    } else {
      const modern=raw.version===2;
      scene.time = modern ? (typeof source.time==='string' ? source.time.slice(0,20) : '') : validTime(source.time) ? source.time : scene.time;
      scene.date = modern ? (typeof source.date==='string' ? source.date.slice(0,10) : '') : localDate(now);
      scene.repeat=modern && source.repeat==='once' ? 'once' : 'daily';
      const selected=dateTime(scene.date,scene.time);
      scene.completedAt=scene.repeat==='once' && selected!==null && source.completedAt===selected ? selected : null;
      if(scene.completedAt) {scene.enabled=false;scene.nextDue=null;}
      else {
        const due=source.nextDue, d=new Date(due);
        const coherent=Number.isFinite(due) && due>0 && validTime(scene.time) && dateTime(scene.date,'12:00')!==null &&
          d.getSeconds()===0 && d.getMilliseconds()===0 && `${pad(d.getHours())}:${pad(d.getMinutes())}`===scene.time &&
          (scene.repeat==='once' ? due===selected : localDate(due)>=scene.date);
        scene.nextDue=coherent ? due : planReminder(scene,now).due;
      }
    }
  }
  state.reduced = raw.reduced === true;
  state.history = Array.isArray(raw.history) ? raw.history.filter(e => IDS.includes(e.id) && Number.isFinite(e.at) && ['triggered', 'missed'].includes(e.status)).slice(-30) : [];
  state.pending = Array.isArray(raw.pending) ? raw.pending.filter(e => IDS.includes(e.id) && Number.isFinite(e.due) && now - e.due <= GRACE && now >= e.due && (state[e.id].enabled || state[e.id].completedAt===e.due)).slice(-3) : [];
  return state;
}
export function setDaily(state, id, time, enabled, now = Date.now()) {
  if (!['morning', 'night'].includes(id) || !validTime(time)) throw new Error('请输入有效时间');
  updateReminder(state,id,{time,enabled,repeat:'daily',date:localDate(now)},now);
}
export function setNap(state, duration, now = Date.now()) {
  if (!Number.isFinite(duration) || duration <= 0 || duration > 180 * 60_000) throw new Error('午睡时长需在 1–180 分钟内');
  Object.assign(state.nap, {enabled: true, deadline: now + duration, remaining: null});
}
export function pauseNap(state, now = Date.now()) {
  if (state.nap.deadline) state.nap.remaining = Math.max(1, state.nap.deadline - now);
  state.nap.deadline = null;
}
export function collectDue(state, now = Date.now()) {
  const events = [], missed = [];
  for (const id of IDS) {
    const scene = state[id];
    const due = id === 'nap' ? scene.deadline : scene.nextDue;
    if (!scene.enabled || !due || due > now) continue;
    const event = {id, due};
    if (now - due <= GRACE) events.push(event); else missed.push(event);
    state.history.push({id, at: due, status: now - due <= GRACE ? 'triggered' : 'missed'});
    if (id === 'nap') {scene.deadline = null; scene.remaining = null;}
    else if(scene.repeat==='once') {scene.nextDue=null;scene.completedAt=due;scene.enabled=false;}
    else scene.nextDue = planReminder(scene,now).due;
  }
  state.history = state.history.slice(-30);
  return {events, missed};
}
export function formatRemaining(ms) {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map(n => String(n).padStart(2, '0')).join(':');
}
