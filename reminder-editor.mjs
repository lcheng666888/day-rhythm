import {validTime, localDate, dateAfter} from './scheduler.mjs';
const pad=n=>String(n).padStart(2,'0');
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function reminderControls(id,name,scene) {
  return `<div class="reminder-editor" id="editor-${id}">
    <div class="repeat-options" role="radiogroup" aria-label="${name}重复方式"><button type="button" role="radio" data-repeat="once" aria-checked="${scene.repeat==='once'}">仅这一次</button><button type="button" role="radio" data-repeat="daily" aria-checked="${scene.repeat==='daily'}">每天重复</button></div>
    <div class="schedule-label"><label for="date-${id}" id="date-label-${id}">开始日期</label><span>按设备本地时间</span></div>
    <div class="date-options"><button type="button" data-day="0" aria-pressed="false">今天</button><button type="button" data-day="1" aria-pressed="false">明天</button><input type="date" id="date-${id}" value="${escape(scene.date)}" max="9999-12-31" required aria-label="${name}日期" aria-describedby="error-${id}"></div>
    <div class="schedule-label time-label"><label for="time-${id}">提醒时间</label><span>24 小时制 · 可直接输入</span></div>
    <div class="schedule-input keyboard-time"><input type="text" id="time-${id}" value="${escape(scene.time)}" maxlength="5" placeholder="HH:MM" autocomplete="off" spellcheck="false" required pattern="([01][0-9]|2[0-3]):[0-5][0-9]" aria-label="${name}时间" aria-describedby="error-${id}"><button type="button" class="wheel-open" id="wheel-open-${id}" aria-label="滚轮选择${name}时间" aria-expanded="false" aria-controls="wheel-${id}"><svg class="icon" aria-hidden="true"><use href="#i-clock"/></svg><span>滚轮</span></button></div>
    <div class="time-wheel-panel" id="wheel-${id}" hidden><div class="wheel-instructions">上下滑动选择，也可使用 ↑ ↓ 键</div><div class="wheel-columns">${['小时','分钟'].map((unit,part)=>`<div class="wheel-group"><span class="wheel-unit">${unit}</span><div class="wheel-window"><div class="wheel-center" aria-hidden="true"></div><div class="wheel-column" role="listbox" tabindex="0" aria-label="${name}${unit}" data-part="${part}">${Array.from({length:part===0?24:60},(_,index)=>`<button type="button" role="option" tabindex="-1" data-value="${index}" aria-selected="false">${pad(index)}</button>`).join('')}</div></div></div>`).join('<span class="wheel-colon" aria-hidden="true">:</span>')}</div><button type="button" class="wheel-done">完成选择</button></div>
    <p class="schedule-error" id="error-${id}" role="status" hidden></p><p class="repeat-hint" id="repeat-hint-${id}"></p>
  </div>`;
}

export class ReminderEditor {
  constructor(id,name,onChange) {
    this.id=id;this.name=name;this.onChange=onChange;this.root=document.querySelector(`#editor-${id}`);
    this.input=this.root.querySelector(`#time-${id}`);this.date=this.root.querySelector(`#date-${id}`);
    this.panel=this.root.querySelector(`#wheel-${id}`);this.openButton=this.root.querySelector('.wheel-open');
    this.columns=[...this.root.querySelectorAll('.wheel-column')];this.parts=[0,0];this.timers=[];
    this.rowHeight=parseFloat(getComputedStyle(this.root).getPropertyValue('--wheel-row-height')) || 48;
    this.input.addEventListener('input',()=>{this.onChange({time:this.input.value});this.syncWheel(this.input.value);});
    this.date.addEventListener('input',()=>this.onChange({date:this.date.value}));
    this.root.addEventListener('click',event=>{
      const repeat=event.target.closest('[data-repeat]'),day=event.target.closest('[data-day]');
      if(repeat)this.onChange({repeat:repeat.dataset.repeat});
      if(day)this.onChange({date:dateAfter(Date.now(),Number(day.dataset.day))});
    });
    this.root.querySelector('.repeat-options').addEventListener('keydown',event=>{
      if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
      event.preventDefault();
      const buttons=[...this.root.querySelectorAll('[data-repeat]')];
      const index=event.key==='Home'?0:event.key==='End'?1:buttons.findIndex(b=>b.getAttribute('aria-checked')==='true')===0?1:0;
      buttons[index].focus();this.onChange({repeat:buttons[index].dataset.repeat});
    });
    this.openButton.addEventListener('click',()=>{
      this.panel.hidden=!this.panel.hidden;this.openButton.setAttribute('aria-expanded',String(!this.panel.hidden));
      if(!this.panel.hidden){this.syncWheel(validTime(this.input.value)?this.input.value:'00:00');this.columns[0].focus({preventScroll:true});}
    });
    this.root.querySelector('.wheel-done').addEventListener('click',()=>{
      // Commit even when an incomplete input was opened without moving a wheel.
      this.choose(0,this.parts[0]);this.panel.hidden=true;this.openButton.setAttribute('aria-expanded','false');this.input.focus({preventScroll:true});
    });
    this.columns.forEach((column,part)=>{
      column.addEventListener('scroll',()=>{
        clearTimeout(this.timers[part]);this.timers[part]=setTimeout(()=>{
          if(this.panel.hidden)return;
          const index=Math.max(0,Math.min(part===0?23:59,Math.round(column.scrollTop/this.rowHeight)));
          if(index!==this.parts[part])this.choose(part,index,false);
        },140);
      },{passive:true});
      column.addEventListener('click',event=>{const option=event.target.closest('[data-value]');if(option)this.choose(part,Number(option.dataset.value));});
      column.addEventListener('keydown',event=>{
        const max=part===0?23:59,steps={ArrowUp:-1,ArrowDown:1,PageUp:-5,PageDown:5};
        if(Object.hasOwn(steps,event.key)){event.preventDefault();this.choose(part,Math.max(0,Math.min(max,this.parts[part]+steps[event.key])));}
        if(event.key==='Home'||event.key==='End'){event.preventDefault();this.choose(part,event.key==='Home'?0:max);}
        if(event.key==='Escape'){event.preventDefault();event.stopPropagation();this.panel.hidden=true;this.openButton.setAttribute('aria-expanded','false');this.openButton.focus();}
      });
    });
  }
  choose(part,value,scroll=true) {
    this.parts[part]=value;
    const time=this.parts.map(pad).join(':');this.input.value=time;
    this.markOptions();if(scroll)this.columns[part].scrollTo({top:value*this.rowHeight,behavior:'instant'});
    this.onChange({time});
  }
  markOptions() {
    this.columns.forEach((column,part)=>{
      for(const option of column.children)option.setAttribute('aria-selected',String(Number(option.dataset.value)===this.parts[part]));
      column.setAttribute('aria-activedescendant',`wheel-${this.id}-${part}-${this.parts[part]}`);
      for(const option of column.children)option.id=`wheel-${this.id}-${part}-${option.dataset.value}`;
    });
  }
  syncWheel(time) {
    if(this.panel.hidden||!validTime(time))return;
    this.parts=time.split(':').map(Number);this.markOptions();
    this.columns.forEach((column,part)=>{clearTimeout(this.timers[part]);column.scrollTo({top:this.parts[part]*this.rowHeight,behavior:'instant'});});
  }
  sync(scene,error,now=Date.now()) {
    if(document.activeElement!==this.input)this.input.value=scene.time;
    if(document.activeElement!==this.date)this.date.value=scene.date;
    for(const button of this.root.querySelectorAll('[data-repeat]')){button.setAttribute('aria-checked',String(button.dataset.repeat===scene.repeat));button.tabIndex=button.dataset.repeat===scene.repeat?0:-1;}
    this.refreshDate(scene,now);
    this.root.querySelector(`#date-label-${this.id}`).textContent=scene.repeat==='once'?'提醒日期':'开始日期';
    this.showError(error);
    this.root.querySelector('.repeat-hint').textContent=scene.repeat==='once'?'只在所选日期提醒一次，完成后自动关闭。':'从所选日期起每天重复；今天已过则安排下次有效时间。';
    this.syncWheel(scene.time);
  }
  showError(error) {
    const problem=this.root.querySelector('.schedule-error');problem.hidden=!error;if(problem.textContent!==error)problem.textContent=error;
    this.input.setAttribute('aria-invalid',String(!validTime(this.input.value)));
    this.date.setAttribute('aria-invalid',String(!this.date.value || !!(error && !error.includes('HH:MM'))));
  }
  refreshDate(scene,now) {
    for(const button of this.root.querySelectorAll('[data-day]'))button.setAttribute('aria-pressed',String(scene.date===dateAfter(now,Number(button.dataset.day))));
    this.date.min=scene.repeat==='once'?localDate(now):'';
  }
}
