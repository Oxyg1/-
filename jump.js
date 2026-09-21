/* Frog Jump — мини-игра хаба SWAMP.

   Подключается раньше основного скрипта и ничего не видит в нём сама: основная игра
   передаёт в FrogJumpInit узкий «мост» (звук, стикер, сервер, покупка, отправка
   карточки). Своё состояние наружу не отдаём — правка его из консоли не должна
   влиять на то, что уходит на сервер.

   На чём держится ощущение от игры:
   • ни секунды ожидания: забег стартует сразу, лягушка отскакивает с первой кадра;
   • всё пружинит: лягушка сплющивается при приземлении и тянется в полёте,
     кувшинка проседает под ней, по воде расходятся круги;
   • язык сам ловит мошек рядом — каждая поимка звучит на ноту выше, пока идёт серия;
   • раз в 11–16 секунд что-то случается: рой, золотая мошка, лотосы, пружинный участок;
   • три одинаковых лотоса подряд — «слияние», как в основной игре, и ракета вверх;
   • высота, зоны, линии рекордов, обгон соперников — постоянный поток маленьких побед. */
(function(){
'use strict';
window.FrogJumpInit=function(B){
  delete window.FrogJumpInit;

  /* ---------- мир ---------- */
  const W=360, UNIT=10;                      // ширина мира; 10 единиц = 1 метр
  // Темп полёта — исходный. Жалоба «слишком быстро» была не про него, а про то,
  // что дальше 3 км не пускали разрывы между кувшинками: это чинится генерацией
  // (см. gen), а не замедлением
  const G=1500, V0=800, VSPRING=1420, VSTOMP=940, VROCKET=1150, VDRAGON=960;
  const MAXVX=340, FROG=64, FOOT=17, STEP=1/120;
  const JUMP_H=V0*V0/(2*G);
  const ZONES=[
    {h:0,    top:'#3aa373', bot:'#0c3a2a', mote:'firefly', name:'Болото'},
    {h:300,  top:'#f6b27a', bot:'#8e3f3a', mote:'pollen',  name:'Камыши на закате'},
    {h:1000, top:'#9fd6f5', bot:'#4a86cf', mote:'cloud',   name:'Облака'},
    {h:2500, top:'#23265e', bot:'#06071a', mote:'star',    name:'Ночное небо'},
  ];
  const LOTUS=['#ff7eb6','#ffd23f','#7fd1ff'];
  const LOTUS_NAME=['розовых','золотых','голубых'];

  const rnd=(a,b)=>a+Math.random()*(b-a);
  const lerp=(a,b,t)=>a+(b-a)*t;
  const clamp=(v,a,b)=>v<a?a:v>b?b:v;
  const pick=a=>a[Math.floor(Math.random()*a.length)];
  const hex=h=>[parseInt(h.slice(1,3),16),parseInt(h.slice(3,5),16),parseInt(h.slice(5,7),16)];
  const mixc=(a,b,t)=>{const x=hex(a),y=hex(b);return `rgb(${x.map((v,i)=>Math.round(v+(y[i]-v)*t)).join(',')})`;};
  const wdx=(a,b)=>{let d=a-b;if(d>W/2)d-=W;else if(d<-W/2)d+=W;return d;};   // разница по x с учётом сквозных краёв
  const fmtM=n=>String(Math.floor(n)).replace(/\B(?=(\d{3})+(?!\d))/g,' ');

  /* ---------- звук ---------- */
  const X=B.sfx, V=X.voice, TH=X.thud, N=X.note;
  let noiseBuf=null;
  function noise(dur,vol,freq,q=1,t0=0){
    const a=X.audio();if(!a||!B.soundOn())return;const out=X.out();if(!out)return;
    if(!noiseBuf||noiseBuf.sampleRate!==a.sampleRate){
      noiseBuf=a.createBuffer(1,Math.floor(a.sampleRate*.6),a.sampleRate);
      const d=noiseBuf.getChannelData(0);for(let i=0;i<d.length;i++)d[i]=Math.random()*2-1;
    }
    const t=a.currentTime+t0;
    const src=a.createBufferSource();src.buffer=noiseBuf;
    const f=a.createBiquadFilter();f.type='bandpass';f.frequency.value=freq;f.Q.value=q;
    const g=a.createGain();g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(vol,t+.006);g.gain.exponentialRampToValueAtTime(.0001,t+dur);
    src.connect(f).connect(g).connect(out);src.start(t,Math.random()*.2);src.stop(t+dur+.03);
  }
  // жужжание стрекозы: пила через фильтр с дрожащей громкостью
  function buzz(dur){
    const a=X.audio();if(!a||!B.soundOn())return;const out=X.out();if(!out)return;
    const t=a.currentTime;
    const o=a.createOscillator();o.type='sawtooth';o.frequency.setValueAtTime(150,t);o.frequency.linearRampToValueAtTime(190,t+dur);
    const f=a.createBiquadFilter();f.type='lowpass';f.frequency.value=900;
    const g=a.createGain();g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(.035,t+.08);g.gain.setValueAtTime(.035,t+dur-.3);g.gain.exponentialRampToValueAtTime(.0001,t+dur);
    const lfo=a.createOscillator();lfo.frequency.value=28;const lg=a.createGain();lg.gain.value=.015;lfo.connect(lg).connect(g.gain);
    o.connect(f).connect(g).connect(out);o.start(t);o.stop(t+dur+.05);lfo.start(t);lfo.stop(t+dur+.05);
  }
  const SND={
    // отскок: чем больше «точных» приземлений подряд, тем выше звук
    jump:k=>{const p=1+Math.min(k,8)*.065;V(290*p*(1+rnd(-.03,.03)),.13,.045,0,{glide:1.9});},
    spring:()=>{V(190,.4,.06,0,{glide:3.6});V(N(4,1),.3,.04,.07,{reward:true});TH(.06,0,120);},
    tsk:()=>V(1500,.025,.012,0,{glide:.6}),
    gulp:c=>{const s=Math.min(c,14);V(N(s+2,0),.08,.05,0,{glide:.65});if(c>=5)V(N(s+7,1),.12,.022,.03,{reward:true});},
    lotus:k=>V(N(k*2+4,1),.24,.05,0,{reward:true}),
    merge:()=>{[0,2,4,7].forEach((d,i)=>V(N(d,1),.55,.08,i*.06,{reward:true}));TH(.1,0,100);},
    blub:()=>{V(230,.16,.05,0,{glide:.45});V(310,.12,.035,.09,{glide:.5});},
    crack:()=>{noise(.14,.14,1500,1.2);TH(.05,0,180);},
    stomp:()=>{TH(.13,0,95);noise(.1,.1,900,.8);V(N(2,1),.2,.05,.03,{glide:.7});},
    shield:()=>{V(N(3,1),.3,.05,0,{reward:true});V(N(5,1),.3,.04,.06,{reward:true});},
    pop:()=>{noise(.08,.12,2600,1.5);V(900,.08,.03,0,{glide:.5});},
    dragon:()=>{buzz(2.6);V(N(4,1),.3,.05,0,{reward:true});},
    mile:big=>{V(N(4,1),.35,.05,0,{reward:true});V(N(7,1),.45,.045,.08,{reward:true});if(big)V(N(9,1),.6,.05,.18,{reward:true});},
    zone:()=>{[0,4,7].forEach((d,i)=>V(N(d+2,1),.65,.06,i*.12,{reward:true}));},
    record:()=>{[0,2,4,5,7].forEach((d,i)=>V(N(d,1),.5,.08,i*.09,{reward:true}));V(N(9,1),1.1,.07,.5,{reward:true});TH(.09,0,110);},
    pass:()=>{V(N(5,1),.25,.05,0,{reward:true});V(N(7,1),.3,.045,.07,{reward:true});},
    event:()=>{V(N(7,1),.12,.04,0);V(N(9,1),.22,.045,.07,{reward:true});},
    fall:()=>V(700,.7,.05,0,{glide:.22}),
    splash:()=>{noise(.38,.16,650,.7);TH(.08,0,90);},
    hit:()=>{TH(.13,0,70);noise(.2,.13,480,.8);},
    tick:k=>V(N(k%10,1),.035,.022),
    card:()=>V(N(2,1),.25,.04,0,{glide:1.5}),
    ui:()=>V(N(6),.045,.018),
  };

  /* ---------- разметка ---------- */
  const st=document.createElement('style');
  st.textContent=`
#fj{position:fixed;inset:0;z-index:150;background:#0c3a2a;touch-action:none;overflow:hidden;font-family:Nunito,"Segoe UI",system-ui,sans-serif;font-weight:800;color:#fff;user-select:none;-webkit-user-select:none}
#fj canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
#fj .fj-top{position:absolute;left:12px;right:12px;top:calc(var(--tg-safe-area-inset-top,env(safe-area-inset-top,0px)) + var(--tg-content-safe-area-inset-top,0px) + 12px);display:flex;align-items:flex-start;justify-content:space-between;gap:8px;pointer-events:none}
#fj .fj-ib{pointer-events:auto;width:40px;height:40px;border:0;border-radius:13px;background:rgba(0,0,0,.32);display:flex;align-items:center;justify-content:center;padding:0;box-shadow:inset 0 2px 0 rgba(255,255,255,.1),0 3px 8px rgba(0,0,0,.25)}
#fj .fj-ib:active{transform:scale(.9)}
#fj .fj-ib svg{width:22px;height:22px}
#fj .fj-h{display:flex;align-items:baseline;gap:3px;font-weight:900;text-shadow:0 3px 0 rgba(0,0,0,.28),0 0 16px rgba(0,0,0,.25);transform-origin:50% 60%}
#fj .fj-h b{font-size:40px;line-height:1;font-variant-numeric:tabular-nums;letter-spacing:-.01em}
#fj .fj-h span{font-size:18px;opacity:.85}
#fj .fj-h.pulse{animation:fjPulse .45s cubic-bezier(.2,.9,.3,1.4)}
@keyframes fjPulse{35%{transform:scale(1.28)}}
#fj .fj-fl{display:flex;align-items:center;gap:4px;background:rgba(0,0,0,.32);border-radius:999px;padding:4px 12px 4px 5px;font-size:17px;font-weight:900;min-width:64px;box-shadow:inset 0 2px 0 rgba(255,255,255,.1)}
#fj .fj-fl svg{width:26px;height:26px}
#fj .fj-fl.bump{animation:fjBump .25s}
@keyframes fjBump{40%{transform:scale(1.18)}}
#fj .fj-sub{position:absolute;left:0;right:0;top:calc(var(--tg-safe-area-inset-top,env(safe-area-inset-top,0px)) + var(--tg-content-safe-area-inset-top,0px) + 62px);display:flex;flex-direction:column;align-items:center;gap:6px;pointer-events:none}
#fj .fj-tray{display:flex;gap:6px;background:rgba(0,0,0,.26);border-radius:999px;padding:4px 8px}
#fj .fj-tray i{width:24px;height:24px;border-radius:50%;background:rgba(255,255,255,.1);box-shadow:inset 0 0 0 2px rgba(255,255,255,.14);display:flex;align-items:center;justify-content:center;transition:transform .2s}
#fj .fj-tray i img{width:26px;height:26px;object-fit:contain;opacity:0;transform:scale(.3);transition:opacity .15s,transform .25s cubic-bezier(.2,.9,.3,1.6)}
#fj .fj-tray i.on img{opacity:1;transform:scale(1)}
#fj .fj-tray.merge i{animation:fjMerge .5s cubic-bezier(.5,0,.3,1) forwards}
#fj .fj-tray.merge i:nth-child(1){--tx:30px}#fj .fj-tray.merge i:nth-child(3){--tx:-30px}
@keyframes fjMerge{50%{transform:translateX(var(--tx,0)) scale(1.1)}100%{transform:translateX(var(--tx,0)) scale(0);opacity:0}}
#fj .fj-combo{display:flex;align-items:center;gap:3px;background:linear-gradient(#ff8fa3,#e0405f);border-radius:999px;padding:3px 11px 3px 5px;font-size:15px;font-weight:900;box-shadow:0 3px 0 #8f1f36;opacity:0;transform:scale(.5);transition:opacity .15s,transform .2s cubic-bezier(.2,.9,.3,1.6)}
#fj .fj-combo.on{opacity:1;transform:scale(1)}
#fj .fj-combo.hot{background:linear-gradient(#ffe36b,#f7b500);color:#5a3b00;box-shadow:0 3px 0 #a86f00}
#fj .fj-combo.kick{animation:fjBump .22s}
#fj .fj-combo img{width:20px;height:20px}
#fj .fj-banner{position:absolute;left:50%;top:28%;transform:translate(-50%,-50%) scale(.4);opacity:0;background:rgba(8,30,22,.78);border-radius:18px;padding:10px 18px;font-size:22px;font-weight:900;text-align:center;white-space:nowrap;pointer-events:none;box-shadow:0 10px 30px rgba(0,0,0,.35),inset 0 2px 0 rgba(255,255,255,.1)}
#fj .fj-banner small{display:block;font-size:13px;font-weight:800;opacity:.8;margin-top:2px}
#fj .fj-banner.gold{background:linear-gradient(#ffe36b,#f7b500);color:#5a3b00}
#fj .fj-banner.on{animation:fjBanner 1.6s cubic-bezier(.2,.9,.3,1.3) forwards}
@keyframes fjBanner{0%{opacity:0;transform:translate(-50%,-50%) scale(.4)}14%{opacity:1;transform:translate(-50%,-50%) scale(1.08)}22%{transform:translate(-50%,-50%) scale(1)}80%{opacity:1;transform:translate(-50%,-50%) scale(1)}100%{opacity:0;transform:translate(-50%,-80%) scale(.92)}}
#fj .fj-hint{position:absolute;left:0;right:0;bottom:0;height:26%;display:grid;grid-template-columns:1fr 1fr;pointer-events:none;transition:opacity .6s}
#fj .fj-hint.off{opacity:0}
#fj .fj-hint>div{display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,.08);border-top:1px solid rgba(255,255,255,.22)}
#fj .fj-hint>div+div{border-left:1px dashed rgba(255,255,255,.3)}
#fj .fj-hint svg{width:34px;height:34px;opacity:.9;animation:fjNudge 1s ease-in-out infinite}
#fj .fj-hint>div+div svg{animation-direction:reverse}
@keyframes fjNudge{50%{transform:translateX(-7px)}}
#fj .fj-hint p{position:absolute;left:50%;bottom:calc(26% + 10px);transform:translateX(-50%);margin:0;background:rgba(8,30,22,.8);border-radius:999px;padding:6px 14px;font-size:14px;white-space:nowrap}
#fj .fj-lot{position:absolute;width:30px;height:30px;margin:-15px 0 0 -15px;pointer-events:none;z-index:5;transition:transform .42s cubic-bezier(.5,-.3,.4,1),opacity .42s}
#fj .fj-lot img{width:100%;height:100%;object-fit:contain}
#fj .fj-ov{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(3,25,17,.72);z-index:10}
#fj .fj-ov .card{max-width:360px}
#fj .fj-big{font-size:58px;font-weight:900;line-height:1;color:#ffd23f;text-shadow:0 4px 0 rgba(0,0,0,.3);font-variant-numeric:tabular-nums}
#fj .fj-big small{font-size:24px;color:#fff;opacity:.85;margin-left:4px}
#fj .fj-newrec{background:linear-gradient(#ffe36b,#f7b500);color:#5a3b00;border-radius:999px;padding:4px 14px;font-size:14px;font-weight:900;box-shadow:0 3px 0 #a86f00;animation:fjBump .5s .2s}
#fj .fj-earn{display:flex;align-items:center;justify-content:center;gap:8px;font-size:18px;font-weight:900;background:rgba(0,0,0,.22);border-radius:14px;padding:6px 14px}
#fj .fj-earn svg{width:28px;height:28px}
#fj .fj-note{font-size:13px;opacity:.75;text-align:center;line-height:1.3}
#fj .card .btn{width:100%}
#fj .card .row .btn{width:auto;flex:1}
`;
  document.head.appendChild(st);

  const FLY='<svg class="ic"><use href="#i-fly"></use></svg>';
  const root=document.createElement('div');root.id='fj';root.hidden=true;
  root.innerHTML=`
<canvas></canvas>
<div class="fj-top">
  <button class="fj-ib" id="fjPause" aria-label="Пауза"><svg><use href="#i-pause"></use></svg></button>
  <div class="fj-h" id="fjHBox"><b id="fjH">0</b><span>м</span></div>
  <div class="fj-fl" id="fjFl">${FLY}<b id="fjFN">0</b></div>
</div>
<div class="fj-sub">
  <div class="fj-tray" id="fjTray"><i><img alt=""></i><i><img alt=""></i><i><img alt=""></i></div>
  <div class="fj-combo" id="fjCombo"><img src="icons/fire.png" alt=""><b id="fjComboN">×3</b></div>
</div>
<div class="fj-banner" id="fjBanner"></div>
<div class="fj-hint" id="fjHint" hidden><div><svg><use href="#i-chev"></use></svg></div><div><svg style="transform:scaleX(-1)"><use href="#i-chev"></use></svg></div><p>Держи палец слева или справа</p></div>
<div class="fj-ov" id="fjPauseOv" hidden><div class="card">
  <h2>Пауза</h2>
  <div class="sub">Управление</div>
  <div class="segbar" id="fjCtl"><button data-c="touch">Касания</button><button data-c="tilt">Наклон</button></div>
  <button class="btn" id="fjResume">Продолжить</button>
  <div class="row"><button class="btn ghost sm" id="fjSnd"></button><button class="btn ghost sm" id="fjQuit">Выйти</button></div>
</div></div>
<div class="fj-ov" id="fjBoostOv" hidden><div class="card">
  <h2>Начать с половины?</h2>
  <div class="fj-big" id="fjBoostH">0 м</div>
  <div class="fj-note" id="fjBoostSub"></div>
  <button class="btn" id="fjBoostGo">Разогнаться · 20 <img class="ic" src="icons/tgstar.png" alt=""></button>
  <button class="btn ghost sm" id="fjBoostSkip">Обычный старт</button>
</div></div>
<div class="fj-ov" id="fjOver" hidden><div class="card">
  <div class="fj-newrec" id="fjNewRec" hidden>Новый рекорд!</div>
  <h2 id="fjOverT">Забег окончен</h2>
  <div class="fj-big"><span id="fjOverH">0</span><small>м</small></div>
  <div class="sub" id="fjOverBest"></div>
  <div class="fj-earn">${FLY}<span>+<b id="fjOverF">0</b></span></div>
  <div class="fj-note" id="fjOverNote"></div>
  <button class="btn" id="fjRevive">Продолжить · 10 <img class="ic" src="icons/tgstar.png" alt=""></button>
  <button class="btn" id="fjAgain">Ещё раз</button>
  <div class="row"><button class="btn ghost sm" id="fjShare"><svg class="ic"><use href="#i-send"></use></svg> В чат</button><button class="btn ghost sm" id="fjExit">В хаб</button></div>
</div></div>`;
  document.body.appendChild(root);
  const $=s=>root.querySelector(s);
  const cv=root.querySelector('canvas'),cx=cv.getContext('2d');

  /* ---------- настройки игрока ---------- */
  const PREF_KEY='fj.v1';
  let pref={ctl:'touch',hinted:false,best:0,flies:0};
  try{Object.assign(pref,JSON.parse(localStorage.getItem(PREF_KEY)||'{}'));}catch(e){}
  const savePref=()=>{try{localStorage.setItem(PREF_KEY,JSON.stringify(pref));}catch(e){}};

  /* ---------- экран ---------- */
  // quality=1 — как задумано; 0 — облегчённый режим для слабых телефонов:
  // меньше пикселей, меньше фоновых точек, меньше частиц, без картинок облаков.
  // Переключается сам по времени кадра, см. frame()
  let quality=1;
  let dpr=1,sc=1,VH=640,cssW=360,cssH=640,offX=0,fieldW=360;
  function resize(){
    cssW=root.clientWidth||window.innerWidth;cssH=root.clientHeight||window.innerHeight;
    dpr=Math.min(quality?2:1.25,window.devicePixelRatio||1);
    SCALED.clear();
    cv.width=Math.round(cssW*dpr);cv.height=Math.round(cssH*dpr);
    // на широком экране (планшет, десктоп) поле не растягиваем — держим пропорции телефона
    fieldW=Math.min(cssW,cssH*.62);offX=(cssW-fieldW)/2;
    sc=fieldW/W;VH=cssH/sc;
    buildSprites();
  }
  window.addEventListener('resize',()=>{if(open)resize();});

  /* ---------- нарисованные ассеты ----------
     Пути — строками целиком: build.py ищет их в тексте и встраивает картинки
     в сборку. Если какой-то картинки нет или она не загрузилась, соответствующий
     объект рисуется прежней векторной графикой — игра не ломается. */
  const IMG_SRC={
    pad:'jump/pad.png',pad_sink:'jump/pad_sink.png',pad_rot:'jump/pad_rot.png',
    spring_low:'jump/spring_low.png',spring_high:'jump/spring_high.png',
    dragonfly:'jump/dragonfly.png',bubble:'jump/bubble.png',water:'jump/water.png',
    lotus_pink:'jump/lotus_pink.png',lotus_gold:'jump/lotus_gold.png',lotus_blue:'jump/lotus_blue.png',
    cloud_1:'jump/cloud_1.png',cloud_2:'jump/cloud_2.png',cloud_3:'jump/cloud_3.png',
  };
  const LOTUS_IMG=['lotus_pink','lotus_gold','lotus_blue'];
  const IMG={};
  function loadImgs(){
    for(const k in IMG_SRC){
      if(IMG[k])continue;
      const im=new Image();im.decoding='async';im.onload=()=>{im.ok=true;};im.src=IMG_SRC[k];IMG[k]=im;
    }
  }
  const has=k=>{const im=IMG[k];return !!(im&&im.ok&&im.naturalWidth);};
  // Каждый кадр ужимать большой PNG дорого — держим уменьшенные копии под тот
  // размер, которым реально рисуем. Сбрасывается при смене размера экрана
  const SCALED=new Map();
  function scaled(k,w){
    const im=IMG[k];
    const q=Math.max(8,Math.round(w*sc*dpr/8)*8);
    if(q>=im.naturalWidth)return im;
    const id=k+'@'+q;let c=SCALED.get(id);
    if(!c){
      c=document.createElement('canvas');
      c.width=q;c.height=Math.max(1,Math.round(q*im.naturalHeight/im.naturalWidth));
      c.getContext('2d').drawImage(im,0,0,c.width,c.height);
      SCALED.set(id,c);
      if(SCALED.size>40)SCALED.delete(SCALED.keys().next().value);
    }
    return c;
  }
  // картинка по ширине (w) с опорной точкой: ax/ay — доля от ширины/высоты
  function blit(k,x,y,w,ax=.5,ay=.5){
    const im=IMG[k],h=w*im.naturalHeight/im.naturalWidth;
    cx.drawImage(scaled(k,w),x-w*ax,y-h*ay,w,h);return h;
  }
  // Лягушка стоит на верхней поверхности листа, а не на его нижнем крае: точка
  // опоры — центр видимого эллипса. У гнилушки обод толще, поэтому центр выше
  const PAD_AY={pad:.44,pad_sink:.44,pad_rot:.4};

  /* ---------- спрайты (рисуются один раз под текущий масштаб) ---------- */
  let sprPad=null,sprRot=null,frogImg=null,frogP=null;
  function mkCanvas(w,h){const c=document.createElement('canvas');c.width=Math.max(1,Math.ceil(w*sc*dpr));c.height=Math.max(1,Math.ceil(h*sc*dpr));const g=c.getContext('2d');g.scale(sc*dpr,sc*dpr);return [c,g];}
  function drawPad(g,rot){
    g.save();g.translate(44,16);
    g.fillStyle=rot?'#5c4424':'#2c8a49';g.beginPath();g.ellipse(0,4,42,11,0,0,Math.PI*2);g.fill();
    g.fillStyle=rot?'#8a6a3b':'#5cc27a';g.beginPath();g.ellipse(0,0,42,11,0,0,Math.PI*2);g.fill();
    // вырез кувшинки
    g.fillStyle=rot?'#5c4424':'#2c8a49';g.beginPath();g.moveTo(0,0);g.lineTo(41,-3);g.lineTo(38,-8);g.closePath();g.fill();
    if(rot){
      g.strokeStyle='#4a361b';g.lineWidth=2;g.lineCap='round';
      g.beginPath();g.moveTo(-20,-6);g.lineTo(-12,0);g.lineTo(-17,6);g.moveTo(10,-7);g.lineTo(6,1);g.lineTo(13,5);g.stroke();
    }else{
      g.strokeStyle='rgba(30,110,60,.45)';g.lineWidth=1.2;
      for(const a of [-2.6,-2,-1.2,-.5,.4,1.3,2.1,2.7]){g.beginPath();g.moveTo(0,0);g.lineTo(Math.cos(a)*36,Math.sin(a)*9);g.stroke();}
      g.fillStyle='rgba(170,240,190,.5)';g.beginPath();g.ellipse(-12,-4,17,3.5,0,0,Math.PI*2);g.fill();
    }
    g.restore();
  }
  function buildSprites(){
    let g;[sprPad,g]=mkCanvas(88,32);drawPad(g,false);
    [sprRot,g]=mkCanvas(88,32);drawPad(g,true);
  }
  let frogSlug='original';
  function loadFrog(slug){
    slug=slug||'original';
    if(slug!==frogSlug){frogSlug=slug;frogP=null;frogImg=null;}   // наряд сменили — печём заново
    if(!frogP)frogP=B.bake('frogs/'+slug,256).then(c=>{frogImg=c;return c;}).catch(e=>{
      frogP=null;
      if(slug!=='original')return loadFrog('original');           // нет такого файла — не падаем
      throw e;
    });
    return frogP;
  }

  /* ---------- управление ---------- */
  const ptrs=new Map();let touchDir=0,keyDir=0,tilt=0,tiltOn=false;
  const setDirFromPtrs=()=>{let d=0;for(const v of ptrs.values())d=v;touchDir=d;};
  root.addEventListener('pointerdown',e=>{
    if(e.target.closest('button')||!run||!run.alive||paused)return;
    ptrs.set(e.pointerId,e.clientX<cssW/2?-1:1);setDirFromPtrs();hintSeen();
  });
  root.addEventListener('pointermove',e=>{if(ptrs.has(e.pointerId)){ptrs.set(e.pointerId,e.clientX<cssW/2?-1:1);setDirFromPtrs();}});
  const ptrUp=e=>{ptrs.delete(e.pointerId);setDirFromPtrs();};
  root.addEventListener('pointerup',ptrUp);root.addEventListener('pointercancel',ptrUp);root.addEventListener('pointerleave',ptrUp);
  window.addEventListener('keydown',e=>{
    if(!open)return;
    if(e.key==='ArrowLeft'||e.key==='a')keyDir=-1;
    else if(e.key==='ArrowRight'||e.key==='d')keyDir=1;
    else if(e.key==='Escape'||e.key==='p'){if(run&&run.alive)paused?resume():pause();}
  });
  window.addEventListener('keyup',e=>{if((e.key==='ArrowLeft'||e.key==='a')&&keyDir<0)keyDir=0;if((e.key==='ArrowRight'||e.key==='d')&&keyDir>0)keyDir=0;});
  // наклон: Telegram-акселерометр (Bot API 8.0) или deviceorientation браузера.
  // Знак оси x у Android и iOS противоположный — различаем их по знаку силы тяжести
  // на осях y+z: у Android в обычном положении она положительная, у iOS отрицательная
  function onOrient(e){if(e.gamma!=null)tilt=clamp(e.gamma/22,-1,1);}
  function tgAccel(){
    const A=B.TG&&B.TG.Accelerometer;if(!A)return;
    const x=A.x||0,y=A.y||0,z=A.z||0;const s=(y+z)>=0?1:-1;
    const v=-x*s;tilt=Math.abs(v)<.5?0:clamp(v/4,-1,1);
  }
  function startTilt(){
    if(tiltOn)return;tiltOn=true;tilt=0;
    try{if(B.TG&&B.tgv('8.0')&&B.TG.Accelerometer){B.TG.Accelerometer.start({refresh_rate:30});B.TG.onEvent('accelerometerChanged',tgAccel);return;}}catch(e){}
    try{if(window.DeviceOrientationEvent&&typeof DeviceOrientationEvent.requestPermission==='function')DeviceOrientationEvent.requestPermission().catch(()=>{});}catch(e){}
    window.addEventListener('deviceorientation',onOrient);
  }
  function stopTilt(){
    if(!tiltOn)return;tiltOn=false;tilt=0;
    try{if(B.TG&&B.TG.Accelerometer&&B.TG.Accelerometer.isStarted){B.TG.offEvent('accelerometerChanged',tgAccel);B.TG.Accelerometer.stop();}}catch(e){}
    window.removeEventListener('deviceorientation',onOrient);
  }
  function applyCtl(){
    root.querySelectorAll('#fjCtl button').forEach(b=>b.classList.toggle('on',b.dataset.c===pref.ctl));
    if(pref.ctl==='tilt'&&open)startTilt();else stopTilt();
  }
  root.querySelectorAll('#fjCtl button').forEach(b=>b.onclick=()=>{pref.ctl=b.dataset.c;savePref();SND.ui();B.haptic.select();applyCtl();});

  /* ---------- состояние забега ---------- */
  let run=null,open=false,paused=false,rafId=0,last=0,acc=0,tGlobal=0;
  let best=0,rivals=[],hintOn=false,hintT=0;

  function newRun(){
    const r={
      t:0,alive:true,over:false,dyingT:0,cause:'fall',
      fx:W/2,fy:0,vx:0,vy:V0,sq:-.2,sqV:0,lean:0,spin:0,
      maxY:0,camY:-VH*.2,shake:0,hitstop:0,slow:0,
      pads:[],flies:[],lots:[],items:[],herons:[],parts:[],
      genY:0,lastHeron:-9999,springRun:0,lastRisk:false,cullT:0,
      flies_n:0,combo:0,comboT:-9,perfect:0,
      tray:[],lastLot:-1,rocket:0,dragon:0,shield:false,invul:0,tongue:null,
      nextEvent:rnd(7,10),lastEvent:'',mile:100,zone:0,bestCrossed:false,passed:new Set(),
      reviveN:0,insUsed:false,seg:{base:0,t0:0,f0:0,tokenP:null},
    };
    // стартовая кувшинка — широкая, чтобы первый отскок был гарантирован
    r.pads.push(mkPad(W/2,0,150,'n'));r.pads[0].big=true;
    return r;
  }
  function mkPad(x,y,w,type){
    const p={x,y,w,type,vx:0,dip:0,dipV:0,dead:false,sinkT:0,spring:0,springT:9,springX:0,heron:null,bob:Math.random()*6};
    if(type==='m'){const d=Math.min(1,y/UNIT/2500);p.vx=(Math.random()<.5?-1:1)*lerp(45,125,d)*rnd(.8,1.2);}
    return p;
  }

  /* ---------- генерация уровня ---------- */
  function gen(r){
    while(r.genY<r.camY+VH+300){
      // Сложность растёт медленнее и упирается в потолок: раньше к 2500 м разрыв
      // доходил до 172 при высоте прыжка 212 — с учётом разбега вбок это было
      // почти невозможно, и дальше 3000 м игра превращалась в лотерею
      const m=r.genY/UNIT,d=Math.min(1,m/4200);
      const gap=lerp(62,JUMP_H*.68,d)*rnd(.88,1.12);
      r.genY+=gap;
      const y=r.genY,w=lerp(84,64,d);
      const pm=m<150?0:Math.min(.3,.1+(m-150)/3200);
      const ps=m<300?0:Math.min(.16,.05+(m-300)/5200);
      const q=Math.random();
      let type=q<pm?'m':q<pm+ps?'s':'n';
      // две рискованные кувшинки подряд запрещены: связка «под тобой тонущая,
      // над тобой гнилая, следующая с цаплей» не должна складываться
      if(type!=='n'&&r.lastRisk)type='n';
      r.lastRisk=type!=='n';
      const pad=mkPad(rnd(w/2+4,W-w/2-4),y,w,type);
      r.pads.push(pad);
      if(type!=='s'&&(r.springRun>0||(m>=100&&Math.random()<.075))){
        pad.spring=1;pad.springX=rnd(-w*.22,w*.22);if(r.springRun>0)r.springRun--;
      }else if(m>=400&&type==='n'&&y-r.lastHeron>1000&&Math.random()<.06){
        const h={pad,dead:false,x:pad.x,y:pad.y,vx:0,vy:0,rot:0,face:pad.x<W/2?1:-1,t:Math.random()*5};
        pad.heron=h;r.herons.push(h);r.lastHeron=y;
        // рядом с цаплей всегда есть куда сесть без боя
        const ww=w*.9,fx=clamp(pad.x+(pad.x<W/2?1:-1)*rnd(110,150),ww/2+4,W-ww/2-4);
        r.pads.push(mkPad(fx,y+rnd(-14,14),ww,'n'));
      }
      // в начале кувшинки гуще — учиться прыгать приятно, а не страшно
      if(m<300&&Math.random()<.45){const ww=w*.9;r.pads.push(mkPad(clamp(W-pad.x+rnd(-40,40),ww/2+4,W-ww/2-4),y-gap*.5,ww,'n'));}
      // гнилушка-обманка: никогда не единственная дорога наверх
      // гнилушка — приманка сбоку от настоящего пути, а не на нём
      if(m>=600&&Math.random()<.15){
        const rx=clamp(pad.x+(pad.x<W/2?1:-1)*rnd(90,150),30,W-30);
        r.pads.push(mkPad(rx,y-gap*.45,w,'r'));
      }
      if(Math.random()<.5)r.flies.push(mkFly(rnd(18,W-18),y-gap*rnd(.2,.8)));
      if(m>=40&&Math.random()<.11)r.lots.push(mkLot(rnd(24,W-24),y+rnd(40,90),lotusColor(r)));
      if(m>=400&&Math.random()<.03)r.items.push({k:'b',x:pad.x,y:y+62,t:Math.random()*5});
      if(m>=500&&Math.random()<.022)r.items.push({k:'d',x:rnd(40,W-40),y:y+86,t:Math.random()*5});
    }
  }
  const mkFly=(x,y,o={})=>Object.assign({x,y,t:Math.random()*6,taken:false,aimed:false,gold:false,vx:0},o);
  const mkLot=(x,y,c)=>({x,y,c,t:Math.random()*6,taken:false});
  // цвет лотоса тянется к последнему собранному — слияние случается часто, это главный кайф
  function lotusColor(r){return (r.lastLot>=0&&Math.random()<.55)?r.lastLot:Math.floor(Math.random()*3);}

  /* ---------- частицы и тексты ---------- */
  function P(o){if(run.parts.length>(quality?340:140))run.parts.splice(0,20);o.t=0;run.parts.push(o);}
  function splash(x,y,n=8,col='#bfefff'){
    for(let i=0;i<n;i++){const a=rnd(.2,Math.PI-.2);P({k:'drop',x:x+rnd(-14,14),y,vx:Math.cos(a)*rnd(40,150),vy:Math.sin(a)*rnd(120,260),g:900,life:rnd(.35,.6),s:rnd(2,3.6),c:col});}
    P({k:'ring',x,y:y-2,life:.55,s:10,c:'rgba(210,245,255,'});
  }
  function burst(x,y,n,cols,sp=220){for(let i=0;i<n;i++){const a=rnd(0,Math.PI*2),v=rnd(sp*.35,sp);P({k:'petal',x,y,vx:Math.cos(a)*v,vy:Math.sin(a)*v+60,g:260,life:rnd(.5,1),s:rnd(3,6),c:pick(cols),r:rnd(0,6),vr:rnd(-8,8)});}}
  function txt(x,y,s,o={}){P(Object.assign({k:'txt',x,y,vx:0,vy:70,life:.85,s:18,c:'#fff',text:s},o));}

  /* ---------- HUD ---------- */
  const elH=$('#fjH'),elHBox=$('#fjHBox'),elFN=$('#fjFN'),elFl=$('#fjFl'),elCombo=$('#fjCombo'),elComboN=$('#fjComboN'),elTray=$('#fjTray'),elBanner=$('#fjBanner');
  let shownH=-1;
  function hudH(m){if(m!==shownH){shownH=m;elH.textContent=fmtM(m);}}
  function kick(el,cls){el.classList.remove(cls);void el.offsetWidth;el.classList.add(cls);}
  function hudFlies(){elFN.textContent=run.flies_n;kick(elFl,'bump');}
  let bannerT=0;
  function banner(text,sub='',gold=false){
    elBanner.innerHTML=text+(sub?`<small>${sub}</small>`:'');
    elBanner.classList.toggle('gold',gold);kick(elBanner,'on');bannerT=1.6;
  }
  function trayRender(){
    const slots=elTray.children;
    for(let i=0;i<3;i++){const c=run.tray[i];slots[i].classList.toggle('on',c!=null);if(c!=null)slots[i].firstElementChild.src=IMG_SRC[LOTUS_IMG[c]];}
  }
  function comboRender(){
    const on=run.combo>=3;elCombo.classList.toggle('on',on);elCombo.classList.toggle('hot',run.combo>=5);
    if(on){elComboN.textContent=run.combo>=5?`×${run.combo} · вдвойне`:`×${run.combo}`;kick(elCombo,'kick');}
  }
  // экранные координаты точки мира (для DOM-эффектов поверх канваса)
  const toScreen=(x,y)=>({x:offX+x*sc,y:(run.camY+VH-y)*sc});

  function hintSeen(){if(hintOn&&!hintT)hintT=1.2;}

  /* ---------- игровые события ---------- */
  function land(p,dx){
    const r=run;
    if(p.type==='r'){      // гнилушка не держит: ломается, лягушка летит дальше вниз
      p.dead=true;p.broken=true;SND.crack();B.haptic.light();
      for(let i=0;i<7;i++)P({k:'petal',x:p.x+rnd(-p.w/2,p.w/2),y:p.y,vx:rnd(-60,60),vy:rnd(0,80),g:900,life:.8,s:rnd(4,7),c:pick(['#8a6a3b','#5c4424','#a8834d']),r:rnd(0,6),vr:rnd(-6,6)});
      return false;
    }
    r.fy=p.y;
    const onSpring=p.spring&&Math.abs(wdx(r.fx,p.x+p.springX))<18;
    r.vy=onSpring?VSPRING:V0;
    const perfect=Math.abs(dx)<p.w*.16;
    r.perfect=perfect?r.perfect+1:0;
    r.sq=onSpring?-.4:-.3;r.sqV=0;
    p.dipV=-(onSpring?160:110);
    splash(r.fx,p.y,onSpring?12:7);
    if(onSpring){
      p.springT=0;SND.spring();B.haptic.medium();r.shake=Math.max(r.shake,5);
      txt(r.fx,r.fy+FROG*.9,'Вжух!',{c:'#b6f0a0',s:20});
    }else{SND.jump(r.perfect);B.haptic.light();}
    if(perfect&&r.perfect>=3&&r.perfect%3===0){
      txt(r.fx,r.fy+FROG*1.1,`Точно ×${r.perfect}`,{c:'#ffd23f',s:19});
      for(let i=0;i<8;i++){const a=i/8*Math.PI*2;P({k:'spark',x:r.fx,y:p.y+4,vx:Math.cos(a)*120,vy:Math.sin(a)*60+40,life:.45,s:3,c:'#fff2b8'});}
    }
    if(p.type==='s'){p.sinkT=.001;p.dead=true;SND.blub();}
    return true;
  }
  function catchFly(f){
    const r=run;f.taken=true;
    r.combo=(r.t-r.comboT<1.5)?r.combo+1:1;r.comboT=r.t;
    const val=(f.gold?5:1)*(r.combo>=5?2:1);
    r.flies_n+=val;hudFlies();
    SND.gulp(r.combo);B.haptic.select();
    txt(f.x,f.y+8,'+'+val,{c:f.gold?'#ffd23f':(r.combo>=5?'#ffe36b':'#fff'),s:f.gold?24:16,life:.7});
    if(f.gold){burst(f.x,f.y,14,['#ffd23f','#fff2b8','#ffffff'],180);SND.pass();}
    if(r.combo===5){banner('Серия!','мошки идут вдвойне',true);SND.event();}
    comboRender();
  }
  function collectLotus(l){
    const r=run;l.taken=true;r.lastLot=l.c;
    burst(l.x,l.y,8,[LOTUS[l.c],'#ffffff'],140);
    // лотос «летит» в лоток под высотой — видно, куда он пошёл и зачем
    const s=toScreen(l.x,l.y);
    const slotIdx=Math.min(r.tray.length,2);
    const slot=elTray.children[slotIdx].getBoundingClientRect();
    const d=document.createElement('div');d.className='fj-lot';d.style.left=s.x+'px';d.style.top=s.y+'px';d.style.color=LOTUS[l.c];
    d.innerHTML=`<img src="${IMG_SRC[LOTUS_IMG[l.c]]}" alt="">`;root.appendChild(d);
    requestAnimationFrame(()=>{d.style.transform=`translate(${slot.left+slot.width/2-s.x}px,${slot.top+slot.height/2-s.y}px) scale(.8)`;});
    setTimeout(()=>d.remove(),450);
    r.tray.push(l.c);if(r.tray.length>3)r.tray.shift();
    SND.lotus(r.tray.length);B.haptic.light();
    setTimeout(()=>{if(run===r)trayRender();},380);
    if(r.tray.length===3&&r.tray[0]===r.tray[1]&&r.tray[1]===r.tray[2])setTimeout(()=>{if(run===r&&r.alive)lotusMerge(l.c);},430);
  }
  function lotusMerge(c){
    const r=run;
    kick(elTray,'merge');
    setTimeout(()=>{if(run!==r)return;elTray.classList.remove('merge');r.tray=[];trayRender();},520);
    r.rocket=2.4;r.invul=Math.max(r.invul,2.9);r.vy=VROCKET;
    r.flies_n+=10;hudFlies();
    banner('Слияние!',`три ${LOTUS_NAME[c]} лотоса · +10 мошек`,true);
    SND.merge();B.haptic.success();r.shake=Math.max(r.shake,9);r.hitstop=.05;
    burst(r.fx,r.fy+FROG*.5,30,[LOTUS[c],'#ffffff','#ffd23f'],320);
  }
  function stomp(h){
    const r=run;
    h.dead=true;h.vy=260;h.vx=rnd(-80,80);if(h.pad)h.pad.heron=null;
    r.vy=VSTOMP;r.sq=-.35;r.sqV=0;r.hitstop=.07;r.shake=Math.max(r.shake,7);
    r.flies_n+=3;hudFlies();
    SND.stomp();B.haptic.medium();
    txt(h.x,h.y+70,'Бам! +3',{c:'#ffd23f',s:22});
    burst(h.x,h.y+60,14,['#dfe6ec','#ffffff','#aab6c1'],200);
  }
  function knock(h){
    h.dead=true;h.vy=320;h.vx=(wdx(h.x,run.fx)>=0?1:-1)*260;if(h.pad)h.pad.heron=null;
    run.flies_n+=3;hudFlies();SND.stomp();B.haptic.medium();run.shake=Math.max(run.shake,6);
    txt(h.x,h.y+70,'+3',{c:'#ffd23f',s:20});burst(h.x,h.y+50,10,['#dfe6ec','#ffffff'],200);
  }
  function hurt(){
    const r=run;if(!r.alive)return;
    r.alive=false;r.cause='heron';r.vx=(Math.random()<.5?-1:1)*170;r.vy=380;r.spin=(r.vx>0?1:-1)*9;
    SND.hit();B.haptic.error();r.shake=12;r.hitstop=.09;
    banner('Цапля!','');
  }
  function fall(){
    const r=run;r.alive=false;r.cause='fall';SND.fall();B.haptic.error();r.slow=.5;
  }

  // «всегда что-то происходит»: небольшие события по таймеру
  function tryEvent(r){
    const m=r.maxY/UNIT,top=r.camY+VH;
    const list=['swarm'];
    if(m>=50)list.push('gold');
    if(m>=60)list.push('lotus');
    if(m>=150)list.push('springs');
    const pool=list.filter(e=>e!==r.lastEvent);const ev=pick(pool.length?pool:list);r.lastEvent=ev;
    SND.event();
    if(ev==='swarm'){
      const cxx=rnd(70,W-70),cy=top+rnd(80,160);
      for(let i=0;i<10;i++){const a=i/10*Math.PI*2;r.flies.push(mkFly(cxx+Math.cos(a)*56,cy+Math.sin(a)*46));}
      banner('Рой мошек!','лови подряд — пойдут вдвойне');
    }else if(ev==='gold'){
      r.flies.push(mkFly(rnd(40,W-40),top+120,{gold:true,vx:(Math.random()<.5?-1:1)*90}));
      banner('Золотая мошка!','+5 мошек',true);
    }else if(ev==='lotus'){
      const c=Math.floor(Math.random()*3),x=rnd(60,W-60);
      for(let i=0;i<3;i++)r.lots.push(mkLot(clamp(x+rnd(-40,40),30,W-30),top+90+i*150,c));
      banner('Три лотоса','собери все — будет слияние');
    }else{
      r.springRun=5;banner('Пружинный участок!','');
    }
  }

  /* ---------- шаг физики ---------- */
  function update(dt){
    const r=run;r.t+=dt;tGlobal+=dt;
    if(bannerT>0)bannerT-=dt;
    if(hintT>0){hintT-=dt;if(hintT<=0){hintT=0;hintOn=false;$('#fjHint').classList.add('off');}}

    // --- управление и движение ---
    if(r.alive){
      const dir=keyDir||(pref.ctl==='tilt'&&tiltOn?tilt:touchDir);
      r.vx+=(dir*MAXVX-r.vx)*Math.min(1,dt*(dir?13:7));
    }
    const prevB=r.fy;
    if(r.rocket>0){r.rocket-=dt;r.vy=VROCKET;if(Math.random()<.6)P({k:'petal',x:r.fx+rnd(-12,12),y:r.fy,vx:rnd(-40,40),vy:-rnd(80,200),g:0,life:.6,s:rnd(3,5),c:pick(LOTUS.concat(['#fff'])),r:0,vr:rnd(-6,6)});}
    else if(r.dragon>0){r.dragon-=dt;r.vy=VDRAGON;}
    else r.vy-=G*dt;
    if(r.invul>0)r.invul-=dt;
    r.fx+=r.vx*dt;r.fy+=r.vy*dt;
    if(r.fx<0)r.fx+=W;else if(r.fx>=W)r.fx-=W;
    if(!r.alive)r.spin*=.99;

    // --- приземления ---
    if(r.alive&&r.vy<0){
      for(const p of r.pads){
        if(p.dead)continue;
        if(prevB>=p.y&&r.fy<=p.y){
          const dx=wdx(r.fx,p.x);
          if(Math.abs(dx)<p.w/2+FOOT-4){if(land(p,dx))break;}
        }
      }
    }
    // --- цапли ---
    for(const h of r.herons){
      h.t+=dt;
      if(h.dead){h.vy-=G*.8*dt;h.x+=h.vx*dt;h.y+=h.vy*dt;h.rot+=dt*6*(h.vx>=0?1:-1);continue;}
      if(h.pad){h.x=h.pad.x;h.y=h.pad.y+h.pad.dip;}
      if(!r.alive)continue;
      const dx=wdx(r.fx,h.x),top=h.y+64;
      if(Math.abs(dx)<26){
        if(r.vy<0&&prevB>=top-16&&r.fy<=top+4){stomp(h);continue;}
        if(r.fy<top-10&&r.fy+FROG*.75>h.y+6){
          if(r.invul>0||r.rocket>0||r.dragon>0)knock(h);
          else if(r.shield){r.shield=false;r.invul=.8;SND.pop();knock(h);txt(r.fx,r.fy+FROG,'Щит!',{c:'#bfefff'});}
          else hurt();
        }
      }
    }
    // --- кувшинки ---
    for(const p of r.pads){
      if(p.vx){p.x+=p.vx*dt;const hw=p.w/2+2;if(p.x<hw){p.x=hw;p.vx=-p.vx;}else if(p.x>W-hw){p.x=W-hw;p.vx=-p.vx;}}
      p.dipV+=(-260*p.dip-16*p.dipV)*dt;p.dip+=p.dipV*dt;
      if(p.springT<1)p.springT+=dt*2.5;
      if(p.sinkT>0){p.sinkT+=dt;if(p.sinkT>.15){p.y-=55*dt;if(Math.random()<.25)P({k:'bub',x:p.x+rnd(-p.w/3,p.w/3),y:p.y,vx:0,vy:rnd(20,50),g:0,life:.6,s:rnd(2,4)});}}
    }
    // --- язык и мошки ---
    const mx=r.fx,my=r.fy+FROG*.52;
    for(const f of r.flies){
      f.t+=dt;
      if(f.gold){f.x+=f.vx*dt;if(f.x<0)f.x+=W;else if(f.x>=W)f.x-=W;if(Math.random()<.3)P({k:'spark',x:f.x+rnd(-4,4),y:f.y+rnd(-4,4),vx:0,vy:-20,life:.4,s:2,c:'#fff2b8'});}
      if(f.taken||!r.alive)continue;
      const dx=wdx(f.x,mx),dy=f.y-my,d2=dx*dx+dy*dy;
      if(d2<30*30&&!f.aimed){catchFly(f);continue;}
      if(!r.tongue&&!f.aimed&&d2<(f.gold?110:92)**2){r.tongue={f,t:0,caught:false};f.aimed=true;SND.tsk();}
    }
    if(r.tongue){
      const tg=r.tongue;tg.t+=dt;
      if(!tg.caught&&tg.t>=.08){tg.caught=true;catchFly(tg.f);}
      if(tg.t>=.17)r.tongue=null;
    }
    if(r.combo&&r.t-r.comboT>1.5){r.combo=0;comboRender();}
    // --- лотосы и предметы ---
    if(r.alive){
      const cxm=r.fx,cym=r.fy+FROG*.45;
      for(const l of r.lots){l.t+=dt;if(!l.taken){const dx=wdx(l.x,cxm),dy=l.y-cym;if(dx*dx+dy*dy<36*36)collectLotus(l);}}
      for(const it of r.items){
        it.t+=dt;if(it.taken)continue;
        const dx=wdx(it.x,cxm),dy=it.y-cym;if(dx*dx+dy*dy>38*38)continue;
        it.taken=true;
        if(it.k==='b'){r.shield=true;SND.shield();B.haptic.light();txt(it.x,it.y+10,'Щит',{c:'#bfefff'});}
        else{r.dragon=3;r.invul=Math.max(r.invul,3.3);r.vy=VDRAGON;SND.dragon();B.haptic.medium();banner('Стрекоза!','несёт вверх');}
      }
    }
    // --- лягушка: пружинящая форма и наклон ---
    r.sqV+=(-260*r.sq-15*r.sqV)*dt;r.sq+=r.sqV*dt;
    r.lean+=((r.vx/MAXVX)*.22-r.lean)*Math.min(1,dt*10);
    // --- камера и высота ---
    if(r.alive){
      if(r.fy>r.maxY)r.maxY=r.fy;
      const target=r.fy-VH*.45;
      if(target>r.camY)r.camY+=(target-r.camY)*Math.min(1,dt*9);
      const m=Math.floor(r.maxY/UNIT);hudH(m);
      if(m>=r.mile){
        const big=r.mile%500===0;SND.mile(big);
        txt(W-44,r.camY+VH*.62,`${fmtM(r.mile)} м`,{c:big?'#ffd23f':'#fff',s:big?26:20,life:1.1,vy:40});
        kick(elHBox,'pulse');if(big)B.haptic.light();r.mile+=100;
      }
      let zi=0;for(let i=0;i<ZONES.length;i++)if(m>=ZONES[i].h)zi=i;
      if(zi>r.zone){r.zone=zi;banner(ZONES[zi].name,`${fmtM(ZONES[zi].h)} м`);SND.zone();}
      if(best>0&&!r.bestCrossed&&m>best){
        r.bestCrossed=true;banner('Новый рекорд!',`было ${fmtM(best)} м`,true);SND.record();B.haptic.success();
        for(let i=0;i<40;i++)P({k:'petal',x:rnd(0,W),y:r.camY+VH+10,vx:rnd(-50,50),vy:-rnd(60,220),g:120,life:rnd(1.2,2),s:rnd(3,6),c:pick(['#ffd23f','#ff7eb6','#7fd1ff','#9dffb0','#fff']),r:rnd(0,6),vr:rnd(-8,8)});
      }
      for(const rv of rivals){
        if(!r.passed.has(rv.id)&&m>rv.best){r.passed.add(rv.id);txt(r.fx,r.fy+FROG*1.2,`Обогнал: ${rv.name}`,{c:'#9dffb0',s:17,life:1.2});SND.pass();}
      }
      if(r.t>=r.nextEvent){r.nextEvent=r.t+rnd(11,16);tryEvent(r);}
      gen(r);
      if(r.fy<r.camY-FROG*.4)fall();
    }else{
      r.dyingT+=dt;
      if(r.cause==='heron')r.lean+=r.spin*dt;
      if(!r.over&&(r.fy<r.camY-FROG*1.5||r.dyingT>1.6)){
        r.over=true;SND.splash();splash(clamp(r.fx,20,W-20),r.camY+4,16);r.shake=Math.max(r.shake,6);
        // страховка срабатывает сама и без экрана итогов — за это её и покупают
        setTimeout(()=>{if(run!==r)return;if(useInsurance())return;gameOver();},650);
      }
    }
    // --- частицы ---
    for(let i=r.parts.length-1;i>=0;i--){
      const p=r.parts[i];p.t+=dt;
      if(p.t>=p.life){r.parts.splice(i,1);continue;}
      p.x+=(p.vx||0)*dt;p.y+=(p.vy||0)*dt;if(p.g)p.vy-=p.g*dt;if(p.vr)p.r+=p.vr*dt;
    }
    // --- уборка всего, что ушло вниз ---
    // Раньше это крутилось на каждом шаге физики (120 раз в секунду) и создавало
    // по четыре новых массива за шаг — на слабых телефонах это ощутимый мусор.
    // Четыре раза в секунду более чем достаточно
    r.cullT+=dt;
    if(r.cullT>=.25){
      r.cullT=0;
      const floor=r.camY-140;
      const keepFly=f=>f.y>=floor&&!(f.taken&&(!r.tongue||r.tongue.f!==f));
      if(r.pads.length&&r.pads[0].y<floor)r.pads=r.pads.filter(p=>p.y>=floor);
      r.flies=r.flies.filter(keepFly);
      r.lots=r.lots.filter(l=>!l.taken&&l.y>=floor);
      r.items=r.items.filter(it=>it.y>=floor&&!it.taken);
      r.herons=r.herons.filter(h=>h.y>=floor-200);
    }
    if(r.shake>0)r.shake=Math.max(0,r.shake-dt*28);
  }

  /* ---------- отрисовка ---------- */
  const motes=Array.from({length:44},()=>({x:Math.random(),y:Math.random(),d:rnd(.12,.5),s:rnd(.6,1.4),ph:rnd(0,6)}));
  // Небо перетекает непрерывно. Раньше цвет стоял на месте и перекрашивался
  // только у самой границы зоны — это читалось как резкое переключение.
  // Теперь доля следующей зоны считается по всей дистанции между зонами и
  // сглаживается на входе и выходе, так что момента смены не видно.
  // Светлячки/пыльца/облака/звёзды меняются позже цвета (mt) и с перекрытием.
  function zoneBlend(m){
    let i=0;while(i<ZONES.length-1&&m>=ZONES[i+1].h)i++;
    if(i>=ZONES.length-1)return {a:ZONES[i],b:ZONES[i],t:0,mt:0};
    const b=ZONES[i+1],k=clamp((m-ZONES[i].h)/(b.h-ZONES[i].h),0,1);
    return {a:ZONES[i],b,t:k*k*(3-2*k),mt:clamp((k-.5)/.4,0,1)};
  }
  function drawMotes(kind,alpha,camPx){
    if(alpha<=.01)return;
    const h=cssH+120,n=quality?motes.length:Math.round(motes.length*.45);
    for(let i=0;i<n;i++){
      const m=motes[i];
      const x=m.x*cssW,y=((m.y*h+camPx*m.d)%h+h)%h-60;
      const tw=.5+.5*Math.sin(tGlobal*2+m.ph);
      cx.globalAlpha=alpha;
      if(kind==='firefly'){cx.fillStyle=`rgba(220,255,140,${.12*tw})`;cx.beginPath();cx.arc(x+Math.sin(tGlobal+m.ph)*8,y,7*m.s,0,7);cx.fill();cx.fillStyle=`rgba(240,255,190,${.8*tw})`;cx.beginPath();cx.arc(x+Math.sin(tGlobal+m.ph)*8,y,1.8*m.s,0,7);cx.fill();}
      else if(kind==='pollen'){cx.fillStyle=`rgba(255,235,200,${.35+.3*tw})`;cx.beginPath();cx.arc(x+Math.sin(tGlobal*.7+m.ph)*14,y,1.7*m.s,0,7);cx.fill();}
      else if(kind==='cloud'&&has('cloud_1')&&quality){
        // облаков заметно меньше и они бледнее: раньше лезли в глаза и мешали
        // разглядеть кувшинки
        if(m.s<1.15)continue;
        const k=['cloud_1','cloud_2','cloud_3'][Math.floor(m.ph)%3];
        cx.globalAlpha=alpha*.32;blit(k,x+Math.sin(tGlobal*.15+m.ph)*20,y,78*m.s);
      }
      else if(kind==='cloud'){if(m.s<1)continue;cx.fillStyle='rgba(255,255,255,.28)';cx.beginPath();cx.ellipse(x,y,46*m.s,13*m.s,0,0,7);cx.ellipse(x+22*m.s,y-7*m.s,26*m.s,11*m.s,0,0,7);cx.fill();}
      else{cx.fillStyle=`rgba(255,255,255,${.25+.7*tw})`;cx.beginPath();cx.arc(x,y,1.3*m.s,0,7);cx.fill();}
    }
    cx.globalAlpha=1;
  }
  const Y=y=>run.camY+VH-y;   // мир → экран (в единицах мира, ось вниз)

  function drawFrog(r,x){
    const stretch=r.alive?clamp(r.vy/V0,-1,1)*.07:0;
    const sy=1+r.sq+stretch,sx=1-r.sq*.9-stretch*.55;
    cx.save();cx.translate(x,Y(r.fy));cx.rotate(r.lean);cx.scale(sx,sy);
    if(frogImg)cx.drawImage(frogImg,-FROG/2,-FROG*.94,FROG,FROG);
    else{cx.fillStyle='#5cc27a';cx.beginPath();cx.ellipse(0,-FROG*.35,FROG*.4,FROG*.3,0,0,7);cx.fill();}
    cx.restore();
  }
  function drawPadObj(p){
    const x=p.x,y=Y(p.y+p.dip)+Math.sin(tGlobal*1.6+p.bob)*.8;
    const key=p.type==='r'?'pad_rot':p.type==='s'?'pad_sink':'pad';
    cx.save();
    if(p.type==='s'&&p.sinkT>0)cx.globalAlpha=clamp(1-(p.sinkT-.15)/.7,0,1);
    if(has(key))blit(key,x,y,p.w+12,.5,PAD_AY[key]);
    else{
      const spr=p.type==='r'?sprRot:sprPad,w=p.w+8,h=w*32/88;
      if(p.type==='s')cx.globalAlpha*=.72;
      cx.drawImage(spr,x-w/2,y-h/2+2,w,h);
    }
    if(p.type==='s'&&!p.sinkT){cx.fillStyle='rgba(255,255,255,.7)';const bt=(tGlobal*1.3+p.bob)%1;cx.beginPath();cx.arc(x-6,y-4-bt*10,1.8,0,7);cx.fill();}
    cx.restore();
    if(p.type==='m'){
      cx.strokeStyle='rgba(255,255,255,.7)';cx.lineWidth=2.4;cx.lineCap='round';cx.lineJoin='round';
      const e=p.w/2+10;
      cx.beginPath();cx.moveTo(x-e+4,y-4);cx.lineTo(x-e,y);cx.lineTo(x-e+4,y+4);cx.moveTo(x+e-4,y-4);cx.lineTo(x+e,y);cx.lineTo(x+e-4,y+4);cx.stroke();
    }
    if(p.spring&&has('spring_low')){
      // сжатая пружина стоит, пока не наступили; после прыжка на миг вытягивается
      const up=p.springT<.45,k=p.springT<1?1+Math.sin(p.springT*Math.PI)*.12:1;
      const im=IMG[up?'spring_high':'spring_low'],hgt=(up?46:34)*k,w=hgt*im.naturalWidth/im.naturalHeight;
      cx.drawImage(im,x+p.springX-w/2,y-3-hgt,w,hgt);
    }else if(p.spring){
      const k=p.springT<1?1-Math.sin(p.springT*Math.PI)*.55:1;
      const sxp=x+p.springX,base=y-3,hgt=18*k;
      cx.strokeStyle='#b6f0a0';cx.lineWidth=3;cx.lineJoin='round';cx.beginPath();cx.moveTo(sxp,base);
      for(let i=1;i<=5;i++)cx.lineTo(sxp+(i%2?-5:5),base-hgt*i/5);cx.stroke();
      cx.fillStyle='#7ddc6b';cx.beginPath();cx.ellipse(sxp,base-hgt-2,9,3.5,0,0,7);cx.fill();
    }
  }
  function drawHeron(h){
    if(has('heron')){
      const x=h.x,y=Y(h.y);
      cx.save();cx.translate(x,y);if(h.dead)cx.rotate(h.rot);
      // картинка смотрит вправо; дыхание — лёгкое вытягивание вверх
      cx.scale(h.face*.98,1+Math.sin(h.t*3)*.02);
      const im=IMG.heron,hh=78,w=hh*im.naturalWidth/im.naturalHeight;
      cx.drawImage(im,-w*.42,-hh,w,hh);
      cx.restore();return;
    }
    const x=h.x,y=Y(h.y);const bob=Math.sin(h.t*3)*2;
    cx.save();cx.translate(x,y);if(h.dead)cx.rotate(h.rot);cx.scale(h.face,1);
    cx.strokeStyle='#e7a35a';cx.lineWidth=2.5;cx.beginPath();cx.moveTo(-4,0);cx.lineTo(-4,-26);cx.moveTo(4,0);cx.lineTo(4,-26);cx.stroke();
    cx.fillStyle='#aab6c1';cx.beginPath();cx.moveTo(-14,-36);cx.quadraticCurveTo(-26,-30,-28,-22);cx.lineTo(-10,-30);cx.fill();
    cx.fillStyle='#dfe6ec';cx.beginPath();cx.ellipse(0,-35,17,11,0,0,7);cx.fill();
    cx.strokeStyle='#dfe6ec';cx.lineWidth=6;cx.lineCap='round';cx.beginPath();cx.moveTo(8,-40);cx.quadraticCurveTo(18,-48+bob,12,-58+bob);cx.stroke();
    cx.fillStyle='#dfe6ec';cx.beginPath();cx.arc(12,-60+bob,6,0,7);cx.fill();
    cx.fillStyle='#e7a35a';cx.beginPath();cx.moveTo(16,-62+bob);cx.lineTo(31,-59+bob);cx.lineTo(16,-57+bob);cx.fill();
    cx.fillStyle='#1b2a22';cx.beginPath();cx.arc(13,-61.5+bob,1.5,0,7);cx.fill();
    cx.fillStyle='#39434d';cx.beginPath();cx.moveTo(8,-63+bob);cx.lineTo(0,-66+bob);cx.lineTo(8,-61+bob);cx.fill();
    cx.restore();
  }
  function drawFly(f){
    const x=f.x+Math.sin(f.t*3.1)*5,y=Y(f.y+Math.sin(f.t*4.3)*4);
    const fa=f.gold?'fly_gold_a':'fly_a';
    if(has(fa)){
      if(f.gold){cx.fillStyle='rgba(255,210,63,.28)';cx.beginPath();cx.arc(x,y,18+Math.sin(f.t*6)*2,0,7);cx.fill();}
      // два кадра крыльев, чередуются часто — на глаз это взмахи
      const k=Math.floor(f.t*26)%2?fa:(f.gold?'fly_gold_b':'fly_b');
      blit(has(k)?k:fa,x,y,f.gold?32:27);
      return;
    }
    const flap=Math.abs(Math.sin(f.t*38));
    if(f.gold){cx.fillStyle='rgba(255,210,63,.25)';cx.beginPath();cx.arc(x,y,15,0,7);cx.fill();}
    // крылья растут из спинки и уходят назад-вверх, голова — отдельно сверху
    cx.fillStyle='rgba(223,242,255,.85)';
    cx.beginPath();cx.ellipse(x-6,y-.5,7,2.4*flap+.7,-.95,0,7);cx.fill();
    cx.beginPath();cx.ellipse(x+6,y-.5,7,2.4*flap+.7,.95,0,7);cx.fill();
    cx.fillStyle=f.gold?'#f5b400':'#333a45';
    cx.beginPath();cx.ellipse(x,y+2.6,3.4,4.6,0,0,7);cx.fill();
    cx.beginPath();cx.ellipse(x,y-2,3,2.7,0,0,7);cx.fill();
    cx.fillStyle=f.gold?'#ffd97a':'#414b5c';cx.beginPath();cx.arc(x,y-5.6,2.5,0,7);cx.fill();
    cx.fillStyle=f.gold?'#ffe680':'#e0405f';cx.beginPath();cx.arc(x-1.5,y-6.2,1.2,0,7);cx.arc(x+1.5,y-6.2,1.2,0,7);cx.fill();
  }
  function drawLotus(l){
    const x=l.x,y=Y(l.y+Math.sin(l.t*2)*3),c=LOTUS[l.c];
    cx.fillStyle=c;cx.globalAlpha=.22+.12*Math.sin(l.t*4);cx.beginPath();cx.arc(x,y,20,0,7);cx.fill();cx.globalAlpha=1;
    const li=LOTUS_IMG[l.c];
    if(has(li)){cx.save();cx.translate(x,y);cx.rotate(Math.sin(l.t)*.12);blit(li,0,0,34);cx.restore();return;}
    cx.save();cx.translate(x,y);cx.rotate(Math.sin(l.t)*.15);
    for(let i=0;i<6;i++){cx.rotate(Math.PI/3);cx.fillStyle=c;cx.beginPath();cx.ellipse(0,-7,4.6,8,0,0,7);cx.fill();}
    cx.fillStyle='#fff6c9';cx.beginPath();cx.arc(0,0,4,0,7);cx.fill();
    cx.restore();
  }
  function drawDragon(x,y,t,scale=1){
    if(has('dragonfly')){
      // крылья нарисованы в картинке; частая дрожь по вертикали читается как взмахи
      cx.save();cx.translate(x,y);cx.scale(scale,scale*(1+Math.sin(t*46)*.07));blit('dragonfly',0,0,48);cx.restore();return;
    }
    const flap=Math.sin(t*40);
    cx.save();cx.translate(x,y);cx.scale(scale,scale);
    cx.fillStyle='rgba(210,245,255,.75)';
    for(const s of [-1,1]){cx.beginPath();cx.ellipse(s*11,-3,12,3.2+flap*1.6,s*.25,0,7);cx.fill();cx.beginPath();cx.ellipse(s*10,3,10,2.8-flap*1.3,-s*.2,0,7);cx.fill();}
    cx.fillStyle='#34c7b8';cx.beginPath();cx.ellipse(0,4,2.8,12,0,0,7);cx.fill();
    cx.fillStyle='#1f8f86';cx.beginPath();cx.arc(0,-8,4,0,7);cx.fill();
    cx.restore();
  }
  function drawItem(it){
    const x=it.x,y=Y(it.y+Math.sin(it.t*2.4)*4);
    if(it.k==='b'&&has('bubble')){blit('bubble',x,y,32+Math.sin(it.t*3)*1.5);return;}
    if(it.k==='b'){
      cx.fillStyle='rgba(191,239,255,.18)';cx.beginPath();cx.arc(x,y,14,0,7);cx.fill();
      cx.strokeStyle='rgba(210,245,255,.9)';cx.lineWidth=2;cx.beginPath();cx.arc(x,y,14,0,7);cx.stroke();
      cx.strokeStyle='rgba(255,255,255,.9)';cx.beginPath();cx.arc(x,y,9,-2.6,-1.7);cx.stroke();
    }else drawDragon(x,y,it.t);
  }
  function drawTongue(r){
    const tg=r.tongue;if(!tg)return;
    const mx=r.fx,my=r.fy+FROG*.52;
    const f=tg.f,fx=mx+wdx(f.x,mx),fy=f.y;
    const k=tg.t<.08?tg.t/.08:1-(tg.t-.08)/.09;
    const tx=mx+(fx-mx)*k,ty=my+(fy-my)*k;
    cx.strokeStyle='#ff6f8e';cx.lineWidth=4.5;cx.lineCap='round';
    cx.beginPath();cx.moveTo(mx,Y(my));cx.lineTo(tx,Y(ty));cx.stroke();
    cx.fillStyle='#ff8fa8';cx.beginPath();cx.arc(tx,Y(ty),4.8,0,7);cx.fill();
    if(tg.caught&&k>.05){const s=k;cx.save();cx.translate(tx,Y(ty));cx.scale(s,s);cx.translate(-tx,-Y(ty));drawFly({x:tx,y:ty,t:f.t,gold:f.gold});cx.restore();}
  }
  function drawParts(r,front){
    for(const p of r.parts){
      const isTxt=p.k==='txt';if(isTxt!==front)continue;
      const a=1-p.t/p.life;const x=p.x,y=Y(p.y);
      if(p.k==='drop'){cx.fillStyle=p.c;cx.globalAlpha=a;cx.beginPath();cx.arc(x,y,p.s,0,7);cx.fill();}
      else if(p.k==='ring'){cx.strokeStyle=p.c+(a*.8).toFixed(2)+')';cx.lineWidth=2;const rr=p.s+p.t*110;cx.beginPath();cx.ellipse(x,y,rr,rr*.28,0,0,7);cx.stroke();}
      else if(p.k==='petal'){cx.fillStyle=p.c;cx.globalAlpha=Math.min(1,a*1.5);cx.save();cx.translate(x,y);cx.rotate(p.r);cx.beginPath();cx.ellipse(0,0,p.s,p.s*.55,0,0,7);cx.fill();cx.restore();}
      else if(p.k==='spark'){cx.fillStyle=p.c;cx.globalAlpha=a;cx.beginPath();cx.arc(x,y,p.s*(.5+a*.5),0,7);cx.fill();}
      else if(p.k==='bub'){cx.strokeStyle='rgba(220,248,255,.8)';cx.globalAlpha=a;cx.lineWidth=1.2;cx.beginPath();cx.arc(x,y,p.s,0,7);cx.stroke();}
      else if(isTxt){
        const pop=p.t<.12?.6+p.t/.12*.5:(p.t<.2?1.1-(p.t-.12)/.08*.1:1);
        cx.globalAlpha=Math.min(1,a*2);cx.font=`900 ${p.s*pop}px Nunito,"Segoe UI",sans-serif`;cx.textAlign='center';cx.textBaseline='middle';
        cx.lineWidth=4;cx.strokeStyle='rgba(0,0,0,.45)';cx.strokeText(p.text,x,y);cx.fillStyle=p.c;cx.fillText(p.text,x,y);
      }
      cx.globalAlpha=1;
    }
  }
  function drawLines(r){
    const lines=[];
    if(best>0)lines.push({m:best,label:`Твой рекорд · ${fmtM(best)} м`,me:true});
    for(const rv of rivals)lines.push({m:rv.best,label:`${rv.name} · ${fmtM(rv.best)} м`,me:false});
    cx.font='800 11px Nunito,"Segoe UI",sans-serif';cx.textBaseline='middle';
    for(const l of lines){
      const y=Y(l.m*UNIT);if(y<-20||y>VH+20)continue;
      cx.setLineDash([7,6]);cx.strokeStyle=l.me?'rgba(255,210,63,.95)':'rgba(255,255,255,.75)';cx.lineWidth=1.6;
      cx.beginPath();cx.moveTo(0,y);cx.lineTo(W,y);cx.stroke();cx.setLineDash([]);
      const tw=cx.measureText(l.label).width+16,lx=l.me?8:W-8-tw;
      cx.fillStyle='rgba(8,30,22,.78)';cx.beginPath();cx.roundRect?cx.roundRect(lx,y-19,tw,16,8):cx.rect(lx,y-19,tw,16);cx.fill();
      cx.fillStyle=l.me?'#ffd23f':'#fff';cx.textAlign='left';cx.fillText(l.label,lx+8,y-11);
    }
  }
  function render(){
    if(!run)return;const r=run;
    const m=(r.camY+VH/2)/UNIT,z=zoneBlend(Math.max(0,m));
    cx.setTransform(dpr,0,0,dpr,0,0);
    const gr=cx.createLinearGradient(0,0,0,cssH);
    gr.addColorStop(0,mixc(z.a.top,z.b.top,z.t));gr.addColorStop(1,mixc(z.a.bot,z.b.bot,z.t));
    cx.fillStyle=gr;cx.fillRect(0,0,cssW,cssH);
    const camPx=r.camY*sc;
    drawMotes(z.a.mote,1-z.mt,camPx);if(z.mt>0)drawMotes(z.b.mote,z.mt,camPx);
    const shx=r.shake?rnd(-r.shake,r.shake)*sc:0,shy=r.shake?rnd(-r.shake,r.shake)*sc:0;
    cx.setTransform(dpr*sc,0,0,dpr*sc,(offX*dpr)+shx*dpr,shy*dpr);
    // вода внизу, пока не улетели далеко
    const wy=Y(-6);
    if(wy<VH+10&&has('water')){
      // полоса воды повторяется по горизонтали и медленно течёт
      const im=IMG.water,tw=170,th=tw*im.naturalHeight/im.naturalWidth,left=-offX/sc,right=W+offX/sc;
      const off=(tGlobal*9)%tw;
      cx.fillStyle='#234d5d';cx.fillRect(left,wy+th-2,right-left,VH-wy+60);
      for(let x=Math.floor((left+off)/tw)*tw-off;x<right;x+=tw)cx.drawImage(im,x,wy-8,tw+1,th);
    }else if(wy<VH+10){
      cx.fillStyle='rgba(20,90,80,.85)';cx.fillRect(-offX/sc,wy,W+offX*2/sc,VH-wy+40);
      cx.strokeStyle='rgba(190,240,255,.35)';cx.lineWidth=1.4;
      for(let i=0;i<5;i++){const yy=wy+8+i*14;cx.beginPath();for(let x=0;x<=W;x+=12)cx.lineTo(x,yy+Math.sin(x*.05+tGlobal*2+i)*2);cx.stroke();}
    }
    drawLines(r);
    for(const p of r.pads){const y=Y(p.y);if(y>-30&&y<VH+40&&!p.broken)drawPadObj(p);}
    for(const h of r.herons){const y=Y(h.y);if(y>-80&&y<VH+80)drawHeron(h);}
    for(const l of r.lots){const y=Y(l.y);if(y>-30&&y<VH+30)drawLotus(l);}
    for(const it of r.items){const y=Y(it.y);if(y>-30&&y<VH+30)drawItem(it);}
    for(const f of r.flies){if(f.taken)continue;const y=Y(f.y);if(y>-20&&y<VH+20)drawFly(f);}
    drawParts(r,false);
    drawTongue(r);
    // лягушка (у сквозных краёв рисуется дважды)
    const xs=[r.fx];if(r.fx<FROG/2)xs.push(r.fx+W);if(r.fx>W-FROG/2)xs.push(r.fx-W);
    for(const x of xs){
      if(r.dragon>0)drawDragon(x,Y(r.fy+FROG+8),tGlobal,1.5);
      if(r.invul>0&&r.alive&&!r.rocket&&!r.dragon&&Math.floor(tGlobal*16)%2)cx.globalAlpha=.55;
      drawFrog(r,x);cx.globalAlpha=1;
      if(r.shield&&has('bubble')){cx.globalAlpha=.92;blit('bubble',x,Y(r.fy+FROG*.45),FROG*1.2+Math.sin(tGlobal*3)*2);cx.globalAlpha=1;}
      else if(r.shield){const yy=Y(r.fy+FROG*.45);cx.strokeStyle='rgba(210,245,255,.85)';cx.lineWidth=2.2;cx.fillStyle='rgba(191,239,255,.13)';cx.beginPath();cx.arc(x,yy,FROG*.58,0,7);cx.fill();cx.stroke();cx.strokeStyle='rgba(255,255,255,.9)';cx.beginPath();cx.arc(x,yy,FROG*.45,-2.5+Math.sin(tGlobal*2)*.2,-1.8);cx.stroke();}
    }
    drawParts(r,true);
    // поля по бокам на широком экране
    if(offX>1){cx.setTransform(dpr,0,0,dpr,0,0);cx.fillStyle='rgba(0,0,0,.35)';cx.fillRect(0,0,offX,cssH);cx.fillRect(cssW-offX,0,offX,cssH);}
  }

  /* ---------- цикл ---------- */
  let fAcc=0,fN=0;
  function frame(ts){
    rafId=requestAnimationFrame(frame);
    const dt=Math.min(.05,last?(ts-last)/1000:0);last=ts;
    if(!run)return;
    // если кадры стабильно не укладываются в ~45 в секунду — переходим в
    // облегчённый режим (и обратно, когда снова летает)
    if(dt>0){
      fAcc+=dt;fN++;
      if(fN>=45){
        const avg=fAcc/fN;fAcc=0;fN=0;
        if(quality&&avg>.028){quality=0;resize();}
        else if(!quality&&avg<.017){quality=1;resize();}
      }
    }
    if(!paused&&!(run.over&&!$('#fjOver').hidden)){
      let sdt=dt;
      if(run.hitstop>0){run.hitstop-=dt;sdt=0;}
      if(run.slow>0){run.slow-=dt;sdt*=.35;}
      acc+=sdt;let n=0;
      while(acc>=STEP&&n<12){update(STEP);acc-=STEP;n++;}
      if(n>=12)acc=0;
    }
    render();
  }

  /* ---------- сервер ---------- */
  const hasApi=()=>B.hasApi();
  function startToken(cont,insurance,boost){
    if(!hasApi())return Promise.resolve(null);
    const tries=(cont&&!insurance)||boost?10:2;   // оплата доходит до бота с задержкой
    return (async()=>{
      for(let i=0;i<tries;i++){
        try{
          const res=await B.api('jumpStart',{cont:!!cont,insurance:!!insurance,boost:!!boost});
          if(res&&res.ok){
            if(res.jumpTop)B.applyJump({jumpTop:res.jumpTop,jump:res.jump});
            if(!cont)setRivals();
            lastBase=res.base||0;
            return res.run;
          }
          if((!cont&&!boost)||(res&&res.error!=='wait'))return null;
        }catch(e){if(!cont)return null;}
        await new Promise(ok=>setTimeout(ok,1500));   // оплата доходит до бота с задержкой
      }
      return null;
    })();
  }
  let lastBase=0;
  function setRivals(){
    const n=B.net();const me=B.myId();
    best=Math.max(pref.best||0,(n.jump&&n.jump.best)||0);
    if(run&&run.t<5)bestBefore=Math.max(bestBefore,best);
    // линии соперников: ближайшие сверху, не больше трёх — чтобы было за кем тянуться
    rivals=(n.jumpTop||[]).filter(t=>t.id!==me&&t.best>0).sort((a,b)=>a.best-b.best).filter(t=>t.best>best*.6).slice(-3);
  }
  async function submitSeg(r){
    const seg=r.seg;
    const height=Math.floor(r.maxY/UNIT);
    const flies=r.flies_n-seg.f0;
    const ms=Math.round((r.t-seg.t0)*1000);
    seg.f0=r.flies_n;
    if(height>(pref.best||0))pref.best=height;
    if(!hasApi()){pref.flies=(pref.flies||0)+flies;savePref();return {ok:true,local:true,earned:flies,jump:{best:pref.best,flies:pref.flies}};}
    const tok=await seg.tokenP;
    savePref();
    if(!tok)return {ok:false,error:'offline'};
    try{
      const res=await B.api('jumpEnd',{run:tok,height,flies,ms});
      if(res&&res.ok){B.applyJump(res);if(res.jump){pref.best=Math.max(pref.best,res.jump.best||0);savePref();}}
      return res;
    }catch(e){return {ok:false,error:'offline'};}
  }

  /* ---------- конец забега ---------- */
  let overRes=null,bestBefore=0;
  function gameOver(){
    const r=run;if(!r)return;
    ptrs.clear();touchDir=0;
    const h=Math.floor(r.maxY/UNIT);
    const earnedNow=r.flies_n-r.seg.f0;
    const isBest=h>bestBefore&&h>0;
    $('#fjOverT').textContent=r.cause==='heron'?'Цапля поймала':'Забег окончен';
    $('#fjNewRec').hidden=!isBest;
    $('#fjOverBest').textContent=isBest?(bestBefore?`Прошлый рекорд — ${fmtM(bestBefore)} м`:'Это твой первый забег'):`Твой рекорд — ${fmtM(Math.max(bestBefore,h))} м`;
    $('#fjOverNote').textContent='';
    const rn=r.reviveN;
    $('#fjRevive').hidden=rn>=REVIVE_PRICES.length||h<20;
    $('#fjRevive').innerHTML=`Продолжить · ${REVIVE_PRICES[rn]} <img class="ic" src="icons/tgstar.png" alt="">`;
    $('#fjAgain').className=$('#fjRevive').hidden?'btn':'btn ghost';
    $('#fjOver').hidden=false;SND.card();
    countUp($('#fjOverH'),h,.9,true);countUp($('#fjOverF'),earnedNow,.7,false);
    if(isBest){setTimeout(()=>{if(!$('#fjOver').hidden){SND.record();B.haptic.success();}},650);}
    overRes=submitSeg(r).then(res=>{
      if(run!==r)return res;
      const note=$('#fjOverNote');
      if(!res||!res.ok){note.textContent=res&&res.error==='offline'?'Нет связи с сервером — результат не засчитан':'';return res;}
      const total=res.jump?res.jump.flies:null;
      note.textContent=(total!=null?`Мошек всего: ${fmtM(total)}`:'')+(res.rank?` · место в рейтинге: ${res.rank}`:'');
      // про наряды напоминаем только в момент, когда на новый реально хватило
      const can=res.jump?res.jump.canBuy||0:0;
      if(can>(pref.canBuy||0)){note.textContent+=' · хватает на новый наряд';}
      if(can!==pref.canBuy){pref.canBuy=can;savePref();}
      if(res.isRecord&&!res.local){note.textContent='Лучший результат игры! '+note.textContent;}
      return res;
    });
  }
  function countUp(el,to,dur,ticks){
    // в свёрнутом приложении кадры не идут — тогда просто показываем итог
    if(document.hidden){el.textContent=fmtM(to);return;}
    const t0=performance.now();let lastK=-1;
    const step=now=>{
      const k=Math.min(1,(now-t0)/1000/dur),e=1-Math.pow(1-k,3),v=Math.round(to*e);
      el.textContent=fmtM(v);
      if(ticks){const q=Math.floor(e*12);if(q!==lastK){lastK=q;if(k<1)SND.tick(q);}}
      if(k<1)requestAnimationFrame(step);
    };requestAnimationFrame(step);
  }
  // забег продолжается: за звёзды (paid) или по страховке
  function useInsurance(){
    const r=run,j=B.net().jump||{};
    if(!r||r.insUsed||!(j.shield>0))return false;
    r.insUsed=true;j.shield=Math.max(0,(j.shield||0)-1);
    revive(true);
    banner('Страховка сработала','забег продолжается',true);
    return true;
  }
  function revive(byInsurance){
    const r=run;if(!r||(!byInsurance&&r.reviveN>=REVIVE_PRICES.length))return;
    if(!byInsurance)r.reviveN++;
    r.alive=true;r.over=false;r.dyingT=0;r.spin=0;r.lean=0;
    r.fx=W/2;r.fy=r.camY+VH*.2;r.vx=0;r.vy=VDRAGON;r.dragon=2.6;r.invul=3.2;r.shield=false;
    // все цапли рядом улетают — начинать с удара было бы нечестно
    for(const h of r.herons)if(!h.dead&&h.y<r.camY+VH*1.2){h.dead=true;h.vy=200;h.vx=rnd(-120,120);if(h.pad)h.pad.heron=null;}
    // продолжение запрашиваем только после того, как сервер принял первую часть:
    // иначе он возьмёт за основу высоту прошлого забега
    const prev=overRes||Promise.resolve();
    r.seg={base:Math.floor(r.maxY/UNIT),t0:r.t,f0:r.flies_n,tokenP:prev.catch(()=>{}).then(()=>startToken(true,byInsurance))};
    $('#fjOver').hidden=true;
    if(!byInsurance)banner('Продолжаем!','стрекоза подхватила',true);
    SND.dragon();B.haptic.success();
    last=0;
  }
  // первое продолжение — 10 звёзд, второе — 25, больше двух за забег не даём
  const REVIVE_PRICES=[10,25];
  $('#fjRevive').onclick=()=>{
    const n=run?run.reviveN:0;
    SND.ui();B.buyJumpRevive(n?'jumpRevive2':'jumpRevive',()=>revive());
  };
  $('#fjAgain').onclick=()=>{SND.ui();B.haptic.light();beginRun();};
  $('#fjExit').onclick=()=>{SND.ui();close();};
  $('#fjShare').onclick=async()=>{SND.ui();const h=Math.floor(run.maxY/UNIT);B.shareJump(await shareCard(h),h);};

  /* ---------- пауза ---------- */
  function sndLabel(){$('#fjSnd').innerHTML=`<svg class="ic"><use href="#i-sound-${B.soundOn()?'on':'off'}"></use></svg> Звук`;}
  function pause(){
    if(!run||!run.alive||paused)return;
    paused=true;ptrs.clear();touchDir=0;sndLabel();applyCtl();$('#fjPauseOv').hidden=false;
  }
  function resume(){paused=false;last=0;$('#fjPauseOv').hidden=true;SND.ui();}
  $('#fjPause').onclick=()=>{SND.ui();pause();};
  $('#fjResume').onclick=resume;
  $('#fjSnd').onclick=()=>{B.setSound(!B.soundOn());sndLabel();SND.ui();};
  $('#fjQuit').onclick=()=>{
    // выход посреди забега засчитывает то, что уже собрано
    const r=run;paused=false;$('#fjPauseOv').hidden=true;
    if(r&&r.alive){r.alive=false;r.over=true;submitSeg(r);}
    close();
  };
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&open)pause();});
  function onBack(){
    if(!$('#fjOver').hidden){close();return;}
    if(paused){$('#fjQuit').onclick();return;}
    pause();
  }

  /* ---------- карточка для чата ---------- */
  async function shareCard(h){
    const c=document.createElement('canvas');c.width=1200;c.height=675;const g=c.getContext('2d');
    const z=zoneBlend(h);
    const gr=g.createLinearGradient(0,0,0,675);gr.addColorStop(0,mixc(z.a.top,z.b.top,z.t));gr.addColorStop(1,mixc(z.a.bot,z.b.bot,z.t));
    g.fillStyle=gr;g.fillRect(0,0,1200,675);
    try{await document.fonts.load('900 80px Nunito');}catch(e){}
    const pad=(x,y,w)=>{g.save();g.translate(x,y);g.scale(w/88,w/88);g.translate(-44,-16);drawPad(g,false);g.restore();};
    pad(170,560,300);pad(470,330,180);pad(90,250,150);
    g.globalAlpha=.25;g.fillStyle='#fff';for(let i=0;i<22;i++){g.beginPath();g.arc(rnd(0,1200),rnd(0,675),rnd(2,6),0,7);g.fill();}g.globalAlpha=1;
    if(frogImg){g.save();g.shadowColor='rgba(0,0,0,.35)';g.shadowBlur=30;g.shadowOffsetY=16;g.drawImage(frogImg,70,90,420,420);g.restore();}
    const F='Nunito,"Segoe UI",sans-serif';
    g.textAlign='left';g.fillStyle='rgba(255,255,255,.85)';g.font=`800 40px ${F}`;g.fillText('FROG JUMP · SWAMP',560,170);
    g.fillStyle='#ffd23f';g.shadowColor='rgba(0,0,0,.3)';g.shadowBlur=0;g.shadowOffsetY=8;
    let size=190;g.font=`900 ${size}px ${F}`;const s=`${fmtM(h)} м`;while(g.measureText(s).width>600&&size>90){size-=10;g.font=`900 ${size}px ${F}`;}
    g.fillText(s,555,380);g.shadowOffsetY=0;
    g.fillStyle='#fff';g.font=`800 44px ${F}`;g.fillText(`${B.myName} допрыгал сюда`,560,460);
    g.fillStyle='#ffd23f';g.font=`900 46px ${F}`;g.fillText('Побьёшь?',560,540);
    return c.toDataURL('image/jpeg',.9);
  }

  /* ---------- открыть / закрыть ---------- */
  function start(boostBase){
    $('#fjOver').hidden=true;$('#fjPauseOv').hidden=true;$('#fjBoostOv').hidden=true;paused=false;
    bestBefore=Math.max(pref.best||0,((B.net().jump||{}).best)||0);
    setRivals();
    run=newRun();
    if(boostBase>0){
      // разгон: поле, камера и счётчик высоты сразу на половине рекорда
      const y=boostBase*UNIT;
      run.fy=y;run.maxY=y;run.camY=y-VH*.2;run.genY=y;run.mile=Math.ceil(boostBase/100)*100;
      run.seg.base=boostBase;
      for(const p of run.pads)p.y=y;
      let zi=0;for(let i=0;i<ZONES.length;i++)if(boostBase>=ZONES[i].h)zi=i;
      run.zone=zi;
    }
    run.seg.tokenP=boostBase>0?Promise.resolve(boostToken):startToken(false);
    elTray.classList.remove('merge');trayRender();comboRender();hudH(0);elFN.textContent='0';
    ptrs.clear();touchDir=0;acc=0;last=0;
    gen(run);
    if(!pref.hinted){pref.hinted=true;savePref();hintOn=true;hintT=0;const h=$('#fjHint');h.hidden=false;h.classList.remove('off');setTimeout(()=>{if(hintOn&&!hintT)hintT=.01;},4500);}
    else $('#fjHint').hidden=true;
    SND.jump(0);
  }
  // Разгон предлагаем только тем, кому надоело каждый раз проходить знакомое
  // начало, и только один раз за сеанс — иначе это назойливая реклама
  let boostOffered=false,boostToken=null;
  function boostReady(){const j=B.net().jump||{};return (j.best||0)>=6000;}
  function offerBoost(){
    const j=B.net().jump||{},half=Math.floor((j.best||0)/2);
    $('#fjBoostH').textContent=fmtM(half)+' м';
    $('#fjBoostSub').innerHTML=`Забег начнётся сразу с ${fmtM(half)} м — это половина твоего рекорда ${fmtM(j.best||0)} м.<br>Мошки, рекорд и место в рейтинге считаются как обычно.`;
    $('#fjBoostOv').hidden=false;SND.card();
  }
  async function beginRun(){
    const j=B.net().jump||{};
    if(j.boost>0){   // разгон уже оплачен — забираем и стартуем выше
      $('#fjBoostOv').hidden=false;$('#fjBoostGo').disabled=true;$('#fjBoostGo').textContent='Разгоняемся…';
      boostToken=await startToken(false,false,true);
      $('#fjBoostGo').disabled=false;$('#fjBoostGo').innerHTML=`Разогнаться · 20 <img class="ic" src="icons/tgstar.png" alt="">`;
      $('#fjBoostOv').hidden=true;
      if(boostToken){start(lastBase);return;}
    }
    if(!boostOffered&&boostReady()&&hasApi()){boostOffered=true;offerBoost();run=null;render0();return;}
    start();
  }
  function render0(){cx.setTransform(dpr,0,0,dpr,0,0);cx.fillStyle='#0c3a2a';cx.fillRect(0,0,cssW,cssH);}
  $('#fjBoostGo').onclick=()=>{SND.ui();B.buyJumpItem('jumpBoost',async()=>{await beginRun();});};
  $('#fjBoostSkip').onclick=()=>{SND.ui();$('#fjBoostOv').hidden=true;start();};
  async function openGame(){
    if(open)return;
    loadImgs();
    try{await loadFrog((B.net().jump||{}).skin);}catch(e){B.toast('Не удалось загрузить лягушку');return;}
    open=true;root.hidden=false;B.setActive(true);
    resize();applyCtl();await beginRun();
    last=0;cancelAnimationFrame(rafId);rafId=requestAnimationFrame(frame);
    try{if(B.TG&&B.tgv('6.1')){B.TG.BackButton.onClick(onBack);B.TG.BackButton.show();}}catch(e){}
  }
  function close(){
    if(!open)return;
    open=false;root.hidden=true;cancelAnimationFrame(rafId);stopTilt();
    run=null;paused=false;
    try{if(B.TG&&B.tgv('6.1')){B.TG.BackButton.offClick(onBack);B.TG.BackButton.hide();}}catch(e){}
    B.setActive(false);B.onClose();
  }
  // вне Telegram (локальная разработка) отдаём состояние забега для отладки —
  // внутри приложения это был бы редактор собственного результата
  if(!B.inTG)window.__fj={get run(){return run;},start,close,pause,resume,pref,gameOver:()=>{if(run&&run.alive){run.alive=false;run.over=true;gameOver();}},
    dir:d=>{touchDir=d;},banner,SND,
    // прогон физики без кадров: в фоновой вкладке requestAnimationFrame не идёт,
    // а проверять механику надо
    render,zoneBlend,
    sim:(sec,onStep)=>{const n=Math.round(sec*120);for(let i=0;i<n&&run;i++){update(STEP);if(onStep&&i%12===0)onStep(run);}return run;}};
  return {open:openGame,close,preload:()=>{loadImgs();return loadFrog((B.net().jump||{}).skin).catch(()=>{});},localBest:()=>pref.best||0,localFlies:()=>pref.flies||0};
};
})();
