/* Frog Swing — мини-игра хаба SWAMP: лягушка летит вправо, цепляясь языком за потолок.

   Подключается как Frog Jump: основная игра передаёт в FrogSwingInit узкий «мост»
   (звук, стикер лягушки, сервер), своё состояние наружу не отдаём.

   Управление одно: держишь палец — язык держит, отпустил — летишь по инерции.
   • язык всегда летит вперёд-вверх; прицел заранее показывает, куда он прилипнет,
     а если опоры нет — честно рисует крестик. Помогаем чуть-чуть: если прямо по
     курсу дыра, язык ищет потолок в соседних углах — прицел показывает уже этот угол;
   • пока палец зажат, язык цепляется сам, как только появится опора;
   • отпустил на взлёте вперёд-вверх — «Идеально!» и прибавка скорости;
   • сзади летит цапля: раскачиваться на месте нельзя, она догонит;
   • дыры в потолке генератор делает только такими, какие можно перелететь. */
(function(){
'use strict';
window.FrogSwingInit=function(B){
  delete window.FrogSwingInit;

  /* ---------- мир ---------- */
  const W=360, UNIT=30;                         // ширина видимого мира; 30 единиц = 1 метр
  const G=1500, STEP=1/120, FROG=70, R=22;
  const TSPD=2600, MAXL=400, REEL=34, MINL=95;  // язык: скорость выстрела, длина, подтягивание
  const AIM=55*Math.PI/180;                     // базовый угол выстрела: вперёд-вверх
  const AIMS=[55,50,60,45,65,40,70,36].map(a=>a*Math.PI/180);
  const MAXV=1250, GAPMAX=330;
  const ZONES=[
    {m:0,   top:'#3aa373', bot:'#0c3a2a', mote:'firefly', name:'Болото'},
    {m:250, top:'#f6b27a', bot:'#8e3f3a', mote:'pollen',  name:'Камыши на закате'},
    {m:700, top:'#9fd6f5', bot:'#4a86cf', mote:'cloud',   name:'Над облаками'},
    {m:1500,top:'#23265e', bot:'#06071a', mote:'star',    name:'Ночное болото'},
  ];

  const lerp=(a,b,t)=>a+(b-a)*t;
  const clamp=(v,a,b)=>v<a?a:v>b?b:v;
  const hex=h=>[parseInt(h.slice(1,3),16),parseInt(h.slice(3,5),16),parseInt(h.slice(5,7),16)];
  const mixc=(a,b,t)=>{const x=hex(a),y=hex(b);return `rgb(${x.map((v,i)=>Math.round(v+(y[i]-v)*t)).join(',')})`;};
  const fmtM=n=>String(Math.floor(n)).replace(/\B(?=(\d{3})+(?!\d))/g,' ');
  // уровень строится от зерна: так его можно будет повторить у друзей в гонке
  function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
  const fxR=Math.random;                          // эффекты — вне зерна
  const rnd=(a,b)=>a+fxR()*(b-a);

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
  const SND={
    shoot:()=>{V(620,.07,.03,0,{glide:1.8});noise(.05,.05,3000,2);},
    stick:k=>{V(N(Math.min(k,10),0)*.5,.09,.05,0,{glide:.6});TH(.05,0,160);},
    miss:()=>V(480,.12,.025,0,{glide:.5}),
    release:()=>V(330,.12,.035,0,{glide:1.7}),
    perfect:k=>{V(N(4+Math.min(k,6),1),.2,.05,0,{reward:true});V(N(7+Math.min(k,6),1),.28,.04,.06,{reward:true});},
    gulp:c=>{const s=Math.min(c,14);V(N(s+2,0),.08,.05,0,{glide:.65});if(c>=5)V(N(s+7,1),.12,.022,.03,{reward:true});},
    bounce:()=>{V(190,.35,.06,0,{glide:3.2});TH(.06,0,120);},
    mile:()=>{V(N(4,1),.35,.05,0,{reward:true});V(N(7,1),.45,.045,.08,{reward:true});},
    zone:()=>{[0,4,7].forEach((d,i)=>V(N(d+2,1),.65,.06,i*.12,{reward:true}));},
    record:()=>{[0,2,4,5,7].forEach((d,i)=>V(N(d,1),.5,.08,i*.09,{reward:true}));V(N(9,1),1.1,.07,.5,{reward:true});},
    heron:()=>{V(260,.3,.05,0,{glide:.5});noise(.2,.08,900,1);},
    splash:()=>{noise(.38,.16,650,.7);TH(.08,0,90);},
    hit:()=>{TH(.13,0,70);noise(.2,.13,480,.8);},
    ui:()=>V(N(6),.045,.018),
    pass:()=>{V(N(5,1),.25,.05,0,{reward:true});V(N(7,1),.3,.045,.07,{reward:true});},
    event:()=>{V(N(7,1),.12,.04,0);V(N(9,1),.22,.045,.07,{reward:true});},
    shield:()=>{V(N(3,1),.3,.05,0,{reward:true});V(N(5,1),.3,.04,.06,{reward:true});},
    pop:()=>{noise(.08,.12,2600,1.5);V(900,.08,.03,0,{glide:.5});},
    spring:()=>{V(190,.4,.06,0,{glide:3.6});V(N(4,1),.3,.04,.07,{reward:true});TH(.06,0,120);},
    dragon:()=>{buzz(2.6);V(N(4,1),.3,.05,0,{reward:true});},
    whoosh:v=>noise(.22,Math.min(.1,.03+v*.00006),900+v*.8,.9),
  };
  function buzz(dur){
    const a=X.audio();if(!a||!B.soundOn())return;const out=X.out();if(!out)return;
    const t=a.currentTime;
    const o=a.createOscillator();o.type='sawtooth';o.frequency.setValueAtTime(150,t);o.frequency.linearRampToValueAtTime(190,t+dur);
    const f=a.createBiquadFilter();f.type='lowpass';f.frequency.value=900;
    const g=a.createGain();g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(.035,t+.08);g.gain.setValueAtTime(.035,t+dur-.3);g.gain.exponentialRampToValueAtTime(.0001,t+dur);
    const lfo=a.createOscillator();lfo.frequency.value=28;const lg=a.createGain();lg.gain.value=.015;lfo.connect(lg).connect(g.gain);
    o.connect(f).connect(g).connect(out);o.start(t);o.stop(t+dur+.05);lfo.start(t);lfo.stop(t+dur+.05);
  }

  /* ---------- разметка ---------- */
  const st=document.createElement('style');
  st.textContent=`
#fs{position:fixed;inset:0;z-index:150;background:#0c3a2a;touch-action:none;overflow:hidden;font-family:Nunito,"Segoe UI",system-ui,sans-serif;font-weight:800;color:#fff;user-select:none;-webkit-user-select:none}
#fs canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
#fs .fs-top{position:absolute;left:12px;right:12px;top:calc(var(--tg-safe-area-inset-top,env(safe-area-inset-top,0px)) + var(--tg-content-safe-area-inset-top,0px) + 12px);display:flex;align-items:flex-start;justify-content:space-between;gap:8px;pointer-events:none;z-index:2}
#fs .fs-ib{pointer-events:auto;width:40px;height:40px;border:0;border-radius:13px;background:rgba(0,0,0,.32);display:flex;align-items:center;justify-content:center;padding:0;box-shadow:inset 0 2px 0 rgba(255,255,255,.1),0 3px 8px rgba(0,0,0,.25)}
#fs .fs-ib:active{transform:scale(.9)}
#fs .fs-ib svg{width:22px;height:22px}
#fs .fs-h{position:absolute;left:50%;top:0;transform:translateX(-50%);display:flex;align-items:baseline;gap:3px;font-weight:900;text-shadow:0 3px 0 rgba(0,0,0,.28),0 0 16px rgba(0,0,0,.25)}
#fs .fs-h b{font-size:40px;line-height:1;font-variant-numeric:tabular-nums;letter-spacing:-.01em}
#fs .fs-h span{font-size:18px;opacity:.85}
#fs .fs-h.pulse{animation:fsPulse .45s cubic-bezier(.2,.9,.3,1.4)}
@keyframes fsPulse{0%,100%{transform:translateX(-50%) scale(1)}35%{transform:translateX(-50%) scale(1.28)}}
#fs .fs-fl{display:flex;align-items:center;gap:4px;background:rgba(0,0,0,.32);border-radius:999px;padding:4px 12px 4px 5px;font-size:17px;font-weight:900;min-width:64px;box-shadow:inset 0 2px 0 rgba(255,255,255,.1)}
#fs .fs-fl svg{width:26px;height:26px}
#fs .fs-fl.bump{animation:fsBump .25s}
@keyframes fsBump{40%{transform:scale(1.18)}}
#fs .fs-sub{position:absolute;left:0;right:0;top:calc(var(--tg-safe-area-inset-top,env(safe-area-inset-top,0px)) + var(--tg-content-safe-area-inset-top,0px) + 62px);display:flex;flex-direction:column;align-items:center;gap:6px;pointer-events:none;z-index:2}
#fs .fs-combo{display:flex;align-items:center;gap:3px;background:linear-gradient(#ff8fa3,#e0405f);border-radius:999px;padding:3px 11px 3px 5px;font-size:15px;font-weight:900;box-shadow:0 3px 0 #8f1f36;opacity:0;transform:scale(.5);transition:opacity .15s,transform .2s cubic-bezier(.2,.9,.3,1.6)}
#fs .fs-combo.on{opacity:1;transform:scale(1)}
#fs .fs-combo.hot{background:linear-gradient(#ffe36b,#f7b500);color:#5a3b00;box-shadow:0 3px 0 #a86f00}
#fs .fs-combo.kick{animation:fsBump .22s}
#fs .fs-combo img{width:20px;height:20px}
#fs .fs-banner{position:absolute;left:50%;top:30%;transform:translate(-50%,-50%) scale(.4);opacity:0;background:rgba(8,30,22,.78);border-radius:18px;padding:10px 18px;font-size:22px;font-weight:900;text-align:center;white-space:nowrap;pointer-events:none;box-shadow:0 10px 30px rgba(0,0,0,.35),inset 0 2px 0 rgba(255,255,255,.1);z-index:3}
#fs .fs-banner small{display:block;font-size:13px;font-weight:800;opacity:.8;margin-top:2px}
#fs .fs-banner.gold{background:linear-gradient(#ffe36b,#f7b500);color:#5a3b00}
#fs .fs-banner.on{animation:fsBanner 1.6s cubic-bezier(.2,.9,.3,1.3) forwards}
@keyframes fsBanner{0%{opacity:0;transform:translate(-50%,-50%) scale(.4)}14%{opacity:1;transform:translate(-50%,-50%) scale(1.08)}22%{transform:translate(-50%,-50%) scale(1)}80%{opacity:1;transform:translate(-50%,-50%) scale(1)}100%{opacity:0;transform:translate(-50%,-80%) scale(.92)}}
#fs .fs-hint{position:absolute;left:50%;bottom:calc(16% + env(safe-area-inset-bottom,0px));transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:8px;pointer-events:none;transition:opacity .5s;z-index:2}
#fs .fs-hint.off{opacity:0}
#fs .fs-hint i{width:54px;height:54px;border-radius:50%;background:rgba(255,255,255,.18);box-shadow:inset 0 0 0 3px rgba(255,255,255,.75);animation:fsHold 1.6s ease-in-out infinite}
@keyframes fsHold{0%,100%{transform:scale(1)}45%,60%{transform:scale(.78);background:rgba(255,255,255,.4)}}
#fs .fs-hint p{margin:0;background:rgba(8,30,22,.8);border-radius:999px;padding:6px 14px;font-size:14px;white-space:nowrap}
#fs .fs-ov{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(3,25,17,.72);z-index:10}
#fs .fs-ov .card{max-width:360px}
#fs .fs-big{font-size:58px;font-weight:900;line-height:1;color:#ffd23f;text-shadow:0 4px 0 rgba(0,0,0,.3);font-variant-numeric:tabular-nums}
#fs .fs-big small{font-size:24px;color:#fff;opacity:.85;margin-left:4px}
#fs .fs-newrec{background:linear-gradient(#ffe36b,#f7b500);color:#5a3b00;border-radius:999px;padding:4px 14px;font-size:14px;font-weight:900;box-shadow:0 3px 0 #a86f00;animation:fsBump .5s .2s}
#fs .fs-earn{display:flex;align-items:center;justify-content:center;gap:8px;font-size:18px;font-weight:900;background:rgba(0,0,0,.22);border-radius:14px;padding:6px 14px}
#fs .fs-earn svg{width:28px;height:28px}
#fs .fs-note{font-size:13px;opacity:.75;text-align:center;line-height:1.3}
#fs .fs-stats{width:100%;display:grid;grid-template-columns:1fr 1fr;gap:6px}
#fs .fs-stats div{background:rgba(0,0,0,.22);border-radius:12px;padding:7px 10px;display:flex;flex-direction:column;align-items:flex-start;gap:1px}
#fs .fs-stats span{font-size:11.5px;opacity:.75;font-weight:700}
#fs .fs-stats b{font-size:17px;font-weight:900;font-variant-numeric:tabular-nums}
#fs .card .btn{width:100%}
#fs .card .row .btn{width:auto;flex:1}
`;
  document.head.appendChild(st);

  const FLY='<svg class="ic"><use href="#i-fly"></use></svg>';
  const root=document.createElement('div');root.id='fs';root.hidden=true;
  root.innerHTML=`
<canvas></canvas>
<div class="fs-top">
  <button class="fs-ib" id="fsPause" aria-label="Пауза"><svg><use href="#i-pause"></use></svg></button>
  <div class="fs-h" id="fsHBox"><b id="fsH">0</b><span>м</span></div>
  <div class="fs-fl" id="fsFl">${FLY}<b id="fsFN">0</b></div>
</div>
<div class="fs-sub"><div class="fs-combo" id="fsCombo"><img src="icons/fire.png" alt=""><b id="fsComboN">×2</b></div></div>
<div class="fs-banner" id="fsBanner"></div>
<div class="fs-hint" id="fsHint" hidden><i></i><p id="fsHintT">Держи — язык держит, отпусти — летишь</p></div>
<div class="fs-ov" id="fsPauseOv" hidden><div class="card">
  <h2>Пауза</h2>
  <div class="fs-note">Держи палец — язык цепляется туда, где прицел.<br>Отпусти — лягушка летит дальше.</div>
  <button class="btn" id="fsResume">Продолжить</button>
  <div class="row"><button class="btn ghost sm" id="fsSnd"></button><button class="btn ghost sm" id="fsQuit">Выйти</button></div>
</div></div>
<div class="fs-ov" id="fsOver" hidden><div class="card">
  <div class="fs-newrec" id="fsNewRec" hidden>Новый рекорд!</div>
  <h2 id="fsOverT">Забег окончен</h2>
  <div class="fs-big"><span id="fsOverH">0</span><small>м</small></div>
  <div class="sub" id="fsOverBest"></div>
  <div class="fs-earn">${FLY}<span>+<b id="fsOverF">0</b></span></div>
  <div class="fs-stats" id="fsStats"></div>
  <div class="fs-note" id="fsOverNote"></div>
  <button class="btn" id="fsAgain">Ещё раз</button>
  <button class="btn ghost sm" id="fsExit">В хаб</button>
</div></div>`;
  document.body.appendChild(root);
  const $=s=>root.querySelector(s);
  const cv=root.querySelector('canvas'),cx=cv.getContext('2d');
  const elH=$('#fsH'),elHB=$('#fsHBox'),elFN=$('#fsFN'),elFl=$('#fsFl');

  /* ---------- настройки игрока ---------- */
  const PREF_KEY='fs.v1';
  let pref={hinted:0,best:0,flies:0};
  try{Object.assign(pref,JSON.parse(localStorage.getItem(PREF_KEY)||'{}'));}catch(e){}
  const savePref=()=>{try{localStorage.setItem(PREF_KEY,JSON.stringify(pref));}catch(e){}};

  /* ---------- экран ---------- */
  let quality=1,dpr=1,sc=1,VH=640,cssW=360,cssH=640,offX=0,fieldW=360,WY=560,TOP=70;
  function resize(){
    cssW=root.clientWidth||window.innerWidth;cssH=root.clientHeight||window.innerHeight;
    dpr=Math.min(quality?2:1.25,window.devicePixelRatio||1);
    SCALED.clear();
    cv.width=Math.round(cssW*dpr);cv.height=Math.round(cssH*dpr);
    fieldW=Math.min(cssW,cssH*.62);offX=(cssW-fieldW)/2;
    sc=fieldW/W;VH=cssH/sc;
    WY=VH-Math.max(70,VH*.09);                  // поверхность воды
    // потолок не заходит под счётчик сверху
    const cs=getComputedStyle(root),safe=(parseFloat(cs.getPropertyValue('--tg-safe-area-inset-top'))||0)+(parseFloat(cs.getPropertyValue('--tg-content-safe-area-inset-top'))||0);
    TOP=(safe+64)/sc;
    buildArt();
  }
  window.addEventListener('resize',()=>{if(open)resize();});

  /* ---------- картинки (общие с Frog Jump) ---------- */
  const IMG_SRC={pad:'jump/pad.png',water:'jump/water.png',cloud_1:'jump/cloud_1.png',cloud_2:'jump/cloud_2.png',cloud_3:'jump/cloud_3.png',
    reed_top:'flappy/reed_top.png',reed_bottom:'flappy/reed_bottom.png',heron:'flappy/heron.png',spring_low:'jump/spring_low.png',spring_high:'jump/spring_high.png',
    dragonfly:'jump/dragonfly.png',bubble:'jump/bubble.png',
    branch:'swing/branch.png',leaves:'swing/leaves.png',forest:'swing/forest.png'};
  const IMG={};
  function loadImgs(){for(const k in IMG_SRC){if(IMG[k])continue;const im=new Image();im.decoding='async';
    // ветку и листву печём в плитку кроны — когда догрузились, перепекаем
    im.onload=()=>{im.ok=true;if((k==='branch'||k==='leaves')&&open)buildArt();};im.src=IMG_SRC[k];IMG[k]=im;}}
  const has=k=>{const im=IMG[k];return !!(im&&im.ok&&im.naturalWidth);};
  const SCALED=new Map();
  function scaled(k,w){
    const im=IMG[k];const q=Math.max(8,Math.round(w*sc*dpr/8)*8);
    if(q>=im.naturalWidth)return im;
    const id=k+'@'+q;let c=SCALED.get(id);
    if(!c){c=document.createElement('canvas');c.width=q;c.height=Math.max(1,Math.round(q*im.naturalHeight/im.naturalWidth));c.getContext('2d').drawImage(im,0,0,c.width,c.height);SCALED.set(id,c);if(SCALED.size>30)SCALED.delete(SCALED.keys().next().value);}
    return c;
  }
  function blit(k,x,y,w,ax=.5,ay=.5){const im=IMG[k],h=w*im.naturalHeight/im.naturalWidth;cx.drawImage(scaled(k,w),x-w*ax,y-h*ay,w,h);return h;}
  let frogImg=null,frogP=null,frogSlug='';
  function loadFrog(slug){
    slug=slug||'original';
    if(slug!==frogSlug){frogSlug=slug;frogP=null;frogImg=null;}
    if(!frogP)frogP=B.bake('frogs/'+slug,256).then(c=>{frogImg=c;return c;}).catch(e=>{frogP=null;if(slug!=='original')return loadFrog('original');throw e;});
    return frogP;
  }

  /* ---------- управление ----------
     Палец держат, а не тапают: отпускание ловим везде, где оно может случиться
     (палец ушёл за край, системный жест, свернули приложение), иначе лягушка
     так и останется висеть на потолке */
  let holding=false;const ptrs=new Set();
  root.addEventListener('pointerdown',e=>{
    if(e.target.closest('button')||!run||!run.alive||paused)return;
    ptrs.add(e.pointerId);if(!holding){holding=true;press();}
  });
  const ptrUp=e=>{ptrs.delete(e.pointerId);if(!ptrs.size&&holding){holding=false;letGo();}};
  root.addEventListener('pointerup',ptrUp);root.addEventListener('pointercancel',ptrUp);
  window.addEventListener('blur',()=>{ptrs.clear();if(holding){holding=false;letGo();}});
  window.addEventListener('keydown',e=>{
    if(!open)return;
    if(e.code==='Space'||e.key==='ArrowUp'){e.preventDefault();if(!holding&&run&&run.alive&&!paused){holding=true;press();}}
    else if(e.key==='Escape'||e.key==='p'){if(run&&run.alive)paused?resume():pause();}
  });
  window.addEventListener('keyup',e=>{if((e.code==='Space'||e.key==='ArrowUp')&&holding&&!ptrs.size){holding=false;letGo();}});

  /* ---------- состояние забега ---------- */
  let run=null,open=false,paused=false,rafId=0,last=0,acc=0,tGlobal=0,best=0,bestBefore=0;

  function newRun(seed){
    const r={
      seed,rng:mulberry32(seed),t:0,alive:true,over:false,dyingT:0,cause:'',started:false,
      x:0,y:0,vx:0,vy:0,rot:0,camX:0,shake:0,
      tongue:null,L:0,aim:null,lastRel:-9,perfN:0,sticks:0,
      segs:[],roots:[],reeds:[],pads:[],flies:[],parts:[],
      genX:0,lastY:150,
      hx:-9999,hy:300,heronOn:false,heronWarn:0,
      flies_n:0,combo:0,comboT:-9,comboMax:0,maxX:0,
      sq:0,sqV:0,trail:[],trailT:0,zoom:1,zpulse:0,shield:false,invul:0,dragon:0,items:[],nextEv:8,lastEv:'',passed:new Set(),slow:0,hitstop:0,coach:false,mile:100,zone:0,bestCrossed:false,
      perfects:0,bounces:0,ms0:0,tokenP:null,
    };
    return r;
  }
  const dist=r=>Math.max(0,Math.floor(r.maxX/UNIT));

  /* ---------- генерация уровня ----------
     Потолок — ряд горизонтальных участков: дерево (за него цепляемся), колючки
     (за них нельзя и касаться больно), между участками — дыры. Под дырой иногда
     кувшинка: спасает тех, кто недолетел. Длину дыры держим в пределах того,
     что перелетает нормальный отпуск на взлёте (GAPMAX проверен прогоном бота) */
  function seg(r,x0,x1,y,k){r.segs.push({x0,x1,y,k,ph:r.rng()*9});}
  function gen(r){
    const R0=r.rng;
    while(r.genX<r.camX+W*2.2){
      const m=r.genX/UNIT,d=clamp((m-40)/1600,0,1);
      const y=clamp(r.lastY+(R0()-.5)*120,TOP+20,TOP+lerp(150,190,d));r.lastY=y;
      if(r.genX<10){
        // начало собрано руками: длинная ветка, по дуге первого качания мошки,
        // потом дыра с роем — первый же отпуск сразу приносит награду
        const y0=TOP+70;r.lastY=y0;seg(r,0,560,y0,'w');
        arcFlies(r,110,y0,560,6);
        gapFlies(r,560,170,y0,7,true);r.genX=560+170;continue;
      }
      // дерево
      let len=lerp(420,300,d)*(.8+R0()*.5);
      const x0=r.genX;
      // колючки посреди участка: прицел их пропускает, задевать нельзя
      if(R0()<.12+.3*d&&len>280){
        const a=x0+len*(.25+R0()*.2),b=a+lerp(70,150,d)*(.8+R0()*.4);
        seg(r,x0,a,y,'w');seg(r,a,b,y+8,'t');seg(r,b,x0+len+ (b-a),y,'w');len+=b-a;
      }else seg(r,x0,x0+len,y,'w');
      // корень свисает с потолка
      if(m>150&&R0()<.15+.3*d){
        const room=WY-y;const L=clamp(room*(.22+R0()*lerp(.1,.22,d)),60,room-260);
        if(L>50)r.roots.push({x:x0+len*(.45+R0()*.4),y0:y,y1:y+L,w:15,ph:R0()*6});
      }
      // камыш из воды — в другой половине участка
      if(m>220&&R0()<.1+.28*d){
        const room=WY-y;const H=clamp(room*(.2+R0()*.18),50,room-280);
        if(H>40)r.reeds.push({x:x0+len*(.1+R0()*.25),top:WY-H,w:18,ph:R0()*6});
      }
      // мошки по дуге качания от начала участка
      if(R0()<.85)arcFlies(r,x0+Math.min(len*.3,130),y,x0+len,R0()<.5?4:5);
      r.genX=x0+len;
      // дыра
      if(R0()<.3+.45*d){
        const g=Math.min(GAPMAX,lerp(110,200,d)+R0()*lerp(60,130,d));
        if(R0()<lerp(.65,.25,d))r.pads.push({x:r.genX+g*(.35+R0()*.3),w:84,dip:0,dipV:0,bob:R0()*6,spring:m>80&&R0()<.35,springT:9});
        // над дырой — дуга полёта из мошек: награда за смелый отпуск
        if(R0()<.6)gapFlies(r,r.genX,g,y,4,false);
        r.genX+=g;
      }
    }
    // уборка того, что далеко позади
    const lim=r.camX-W;
    const keep=a=>a.filter(o=>(o.x1!=null?o.x1:o.x+60)>lim);
    if(r.segs.length>60)r.segs=keep(r.segs);
    if(r.roots.length>30)r.roots=keep(r.roots);
    if(r.reeds.length>30)r.reeds=keep(r.reeds);
    if(r.pads.length>30)r.pads=keep(r.pads);
    if(r.flies.length>60)r.flies=r.flies.filter(f=>!f.taken&&f.x>lim);
  }
  function arcFlies(r,px,y,xmax,n){
    const L0=clamp(WY-y-250,130,185);   // примерно та длина языка, на которой качаются
    for(let i=0;i<n;i++){
      const a=lerp(-.35,1.05,i/(n-1)),fx=px+Math.sin(a)*L0,fy=y+Math.cos(a)*L0;
      if(fx<xmax-10&&!blocked(r,fx,fy,26))r.flies.push({x:fx,y:fy,t:r.rng()*6,gold:r.rng()<.04});
    }
  }
  function gapFlies(r,x,g,y,n,gold){
    for(let i=0;i<n;i++){
      const u=(i+.5)/n,fx=x-40+(g+80)*u,fy=y+120-Math.sin(u*Math.PI)*70;
      r.flies.push({x:fx,y:fy,t:r.rng()*6,gold:gold&&i===Math.floor(n/2)});
    }
  }
  function segAt(r,x){
    const s=r.segs;let lo=0,hi=s.length-1;
    while(lo<=hi){const m=(lo+hi)>>1,o=s[m];if(x<o.x0)hi=m-1;else if(x>=o.x1)lo=m+1;else return o;}
    return null;
  }
  function blocked(r,x,y,pad){
    for(const o of r.roots)if(Math.abs(x-o.x)<o.w/2+pad&&y>o.y0-pad&&y<o.y1+pad)return true;
    for(const o of r.reeds)if(Math.abs(x-o.x)<o.w/2+pad&&y>o.top-pad)return true;
    return false;
  }

  /* ---------- язык и прицел ---------- */
  // рот у стикера справа от центра: точку поворачиваем вместе с лягушкой
  const MX=FROG*.16,MY=-FROG*.03;
  const mouth=r=>{const c=Math.cos(r.rot),s=Math.sin(r.rot);return {x:r.x+MX*c-MY*s,y:r.y+MX*s+MY*c};};
  // луч вперёд-вверх до первого потолка; корни и колючки его останавливают
  function cast(r,mx,my,a){
    const dx=Math.cos(a),dy=-Math.sin(a);
    for(let t=12;t<=MAXL;t+=5){
      const px=mx+dx*t,py=my+dy*t;
      if(py<-60)return null;
      for(const o of r.roots)if(Math.abs(px-o.x)<o.w/2&&py>o.y0&&py<o.y1)return {ok:false,x:px,y:py};
      const s=segAt(r,px);
      if(s&&py<=s.y)return s.k==='w'?{ok:true,x:px,y:s.y,s}:{ok:false,x:px,y:s.y};
    }
    return null;
  }
  function aimAt(r){
    const m=mouth(r);let firstBad=null;
    for(const a of AIMS){const h=cast(r,m.x,m.y,a);if(h&&h.ok)return {ok:true,x:h.x,y:h.y,a,mx:m.x,my:m.y};if(!firstBad&&h)firstBad=h;}
    const t=firstBad?Math.hypot(firstBad.x-m.x,firstBad.y-m.y):MAXL;
    return {ok:false,x:m.x+Math.cos(AIM)*t,y:m.y-Math.sin(AIM)*t,a:AIM,mx:m.x,my:m.y,wall:!!firstBad};
  }
  function fire(r){
    const a=aimAt(r);
    r.tongue={st:'out',x:a.x,y:a.y,ok:a.ok,len:0,t:0};
    SND.shoot();
  }
  function press(){
    const r=run;if(!r||!r.alive)return;
    hintSeen();
    if(!r.started){r.started=true;r.ms0=performance.now();return;}   // забег начинается висящим
    if(r.dragon>0)return;
    if(!r.tongue||r.tongue.st==='back')fire(r);
  }
  function letGo(){
    const r=run;if(!r||!r.alive)return;
    const tg=r.tongue;if(!tg)return;
    if(tg.st==='hold'){
      tg.st='back';tg.len=Math.hypot(tg.x-r.x,tg.y-r.y);
      // отпуск на взлёте вперёд-вверх — прибавка; это главный навык режима
      const sp=Math.hypot(r.vx,r.vy),ang=Math.atan2(-r.vy,r.vx);
      if(r.vx>150&&ang>.3&&ang<1.05&&sp>380){
        r.perfN++;r.perfects++;const k=1+Math.min(.12,.06+r.perfN*.012);r.vx*=k;r.vy*=k;
        SND.perfect(r.perfN);B.haptic.light();
        txt(r.x,r.y-38,r.perfN>2?`Идеально ×${r.perfN}`:'Идеально!',{c:'#ffe680'});
        sparks(r.x,r.y,8,'#ffe680');r.zpulse=Math.min(.09,.03+r.perfN*.012);
        for(let i=0;i<7;i++)P({k:'line',x:r.x-rnd(10,60),y:r.y+rnd(-30,30),vx:-rnd(200,500),vy:0,g:0,life:.35,s:rnd(30,60)});
      }else{r.perfN=0;SND.release();}
      SND.whoosh(Math.hypot(r.vx,r.vy));
      r.lastRel=r.t;if(r.rel0==null)r.rel0=r.t;
    }else if(tg.st==='out')tg.st='back';
  }

  /* ---------- эффекты ---------- */
  function P(o){if(run.parts.length>(quality?300:120))run.parts.splice(0,20);o.t=0;run.parts.push(o);}
  function splash(x,y,n=12){for(let i=0;i<n;i++)P({k:'drop',x,y,vx:rnd(-160,160),vy:rnd(-460,-160),g:1400,life:rnd(.4,.8),s:rnd(2,4.5),c:'#bfefff'});P({k:'ring',x,y,life:.8,s:8,c:'rgba(210,245,255,'});}
  function sparks(x,y,n,c){for(let i=0;i<n;i++){const a=rnd(0,Math.PI*2),v=rnd(80,240);P({k:'spark',x,y,vx:Math.cos(a)*v,vy:Math.sin(a)*v,g:300,life:rnd(.3,.6),s:rnd(2,3.5),c});}}
  function bark(x,y){for(let i=0;i<5;i++)P({k:'drop',x:x+rnd(-6,6),y,vx:rnd(-60,60),vy:rnd(20,140),g:900,life:rnd(.3,.6),s:rnd(1.5,2.6),c:'#6b4a2a'});}
  function txt(x,y,s,o={}){P(Object.assign({k:'txt',x,y,vx:0,vy:-60,g:0,life:.85,s:18,c:'#fff',text:s},o));}
  let bannerT=0;
  function banner(text,sub='',gold=false){
    const el=$('#fsBanner');el.innerHTML=text+(sub?`<small>${sub}</small>`:'');
    el.classList.toggle('gold',gold);el.classList.remove('on');void el.offsetWidth;el.classList.add('on');
    clearTimeout(bannerT);bannerT=setTimeout(()=>el.classList.remove('on'),1700);
  }
  let shownH=-1;
  function hudH(m){if(m!==shownH){shownH=m;elH.textContent=fmtM(m);}}
  function kick(el,cls){el.classList.remove(cls);void el.offsetWidth;el.classList.add(cls);}
  let hintOn=false,hintT=0;
  function hintSeen(){if(hintOn&&!hintT)hintT=1;}

  function catchFly(r,f){
    f.taken=true;
    r.combo=(r.t-r.comboT<1.3)?r.combo+1:1;r.comboT=r.t;if(r.combo>r.comboMax)r.comboMax=r.combo;
    const val=(f.gold?5:1)*(r.combo>=5?2:1);
    r.flies_n+=val;elFN.textContent=r.flies_n;kick(elFl,'bump');
    SND.gulp(r.combo);B.haptic.select();
    txt(f.x,f.y-16,'+'+val,{c:f.gold?'#ffd23f':(r.combo>=5?'#ffe36b':'#fff'),s:f.gold?22:15,life:.6});
    sparks(f.x,f.y,f.gold?12:5,f.gold?'#ffd23f':'#fff2b8');
    if(r.combo===5){banner('Серия!','мошки идут вдвойне',true);}
    comboRender(r);
  }
  const elCombo=$('#fsCombo'),elComboN=$('#fsComboN');
  function comboRender(r){
    const on=r&&r.combo>=2;elCombo.classList.toggle('on',on);elCombo.classList.toggle('hot',!!r&&r.combo>=5);
    if(on){elComboN.textContent='×'+r.combo;kick(elCombo,'kick');}
  }

  function hurt(r,cause){
    if(r.invul>0)return false;
    if(r.shield){
      r.shield=false;r.invul=1;SND.pop();B.haptic.medium();sparks(r.x,r.y,14,'#bfefff');txt(r.x,r.y-44,'Щит!',{c:'#bfefff'});
      r.vy=Math.min(r.vy,0)-160;r.vx=Math.max(r.vx,260);
      if(r.tongue&&r.tongue.st!=='back'){r.tongue.st='back';r.tongue.len=Math.hypot(r.tongue.x-r.x,r.tongue.y-r.y);}
      return false;
    }
    die(cause);return true;
  }
  function tryEvent(r){
    const m=dist(r),list=['swarm','gold'];if(m>=120)list.push('bubble');if(m>=220)list.push('dragon');
    const pool=list.filter(e=>e!==r.lastEv),ev=pool[Math.floor(fxR()*pool.length)];r.lastEv=ev;SND.event();
    const x=r.camX+W*1.35,mid=(TOP+120+WY)/2;
    if(ev==='swarm'){for(let i=0;i<10;i++){const a=i/10*Math.PI*2;r.flies.push({x:x+Math.cos(a)*62,y:mid+Math.sin(a)*50,t:fxR()*6});}banner('Рой мошек!','пролети сквозь — пойдут вдвойне');}
    else if(ev==='gold'){r.flies.push({x:x+80,y:mid-30,t:0,gold:true,vx:-70});banner('Золотая мошка!','+5 мошек',true);}
    else if(ev==='bubble'){r.items.push({k:'b',x,y:mid,t:0});banner('Пузырь-щит','спасёт от одного удара');}
    else{r.items.push({k:'d',x,y:mid-20,t:0});banner('Стрекоза!','хватай — прокатит');}
  }

  /* ---------- шаг физики ---------- */
  function update(dt){
    const r=run;r.t+=dt;tGlobal+=dt;
    if(r.shake>0)r.shake=Math.max(0,r.shake-dt*30);
    for(const p of r.pads){p.dipV+=(-p.dip*160-p.dipV*10)*dt;p.dip+=p.dipV*dt;if(p.springT<9)p.springT+=dt*2.5;}
    for(const f of r.flies)f.t+=dt;
    for(let i=r.parts.length-1;i>=0;i--){const p=r.parts[i];p.t+=dt;if(p.t>=p.life){r.parts.splice(i,1);continue;}p.vy+=(p.g||0)*dt;p.x+=(p.vx||0)*dt;p.y+=(p.vy||0)*dt;}
    if(hintT>0){hintT-=dt;if(hintT<=0){hintOn=false;$('#fsHint').classList.add('off');}}

    if(!r.alive){
      r.dyingT+=dt;
      if(r.cause!=='water'){r.vy+=G*dt;r.y=Math.min(r.y+r.vy*dt,WY+40);r.x+=r.vx*dt;r.vx*=.98;r.rot=Math.min(Math.PI/2,r.rot+dt*5);}
      if(r.tongue){r.tongue.len-=TSPD*1.4*dt;if(r.tongue.len<=0)r.tongue=null;}
      if(r.cause!=='water'&&r.y>=WY&&!r.splashed){r.splashed=true;splash(r.x,WY);SND.splash();}
      if(r.dyingT>1.1&&!r.over){r.over=true;gameOver();}
      return;
    }

    // до первого касания лягушка висит и мерно качается
    const tg=r.tongue;
    if(tg){
      tg.t+=dt;
      if(tg.st==='out'){
        const d=Math.hypot(tg.x-r.x,tg.y-r.y);tg.len+=TSPD*dt;
        if(tg.len>=d){
          if(tg.ok&&holding){
            tg.st='hold';tg.len=d;r.L=Math.max(MINL,d);r.sticks++;
            // зацеп добавляет немного скорости по ходу — качаться должно быть живо
            const sp=Math.hypot(r.vx,r.vy);if(sp<520&&r.started){const k=(sp+50)/Math.max(1,sp);r.vx*=k;r.vy*=k;if(sp<20)r.vx+=60;}
            tg.wt=0;r.sqV-=4;
            SND.stick(r.sticks%11);B.haptic.select();bark(tg.x,tg.y);
          }else{tg.st='back';tg.len=d;if(!tg.ok)SND.miss();}
        }
      }else if(tg.st==='hold')tg.wt+=dt;
      else if(tg.st==='back'){tg.len-=TSPD*1.4*dt;if(tg.len<=0)r.tongue=null;}
    }
    // зажал и опоры раньше не было — язык цепляется сам, как только появится
    if(holding&&r.started&&!r.tongue&&!(r.dragon>0)){const a=aimAt(r);if(a.ok)fire(r);}

    if(r.invul>0)r.invul-=dt;
    if(r.started&&r.dragon>0){
      // стрекоза несёт ровно вперёд по середине — время собирать мошек
      r.dragon-=dt;
      const ty=(TOP+120+WY)/2;r.vx+=(640-r.vx)*Math.min(1,dt*3);r.vy+=((ty-r.y)*4-r.vy)*Math.min(1,dt*5);
      r.x+=r.vx*dt;r.y+=r.vy*dt;
      if(r.dragon<=0){r.vy=-280;txt(r.x,r.y-40,'Хватайся!',{c:'#9dffb0',s:16});}
    }else if(r.started){
      r.vy+=G*dt;
      const hold=r.tongue&&r.tongue.st==='hold';
      if(hold&&r.L>MINL)r.L=Math.max(MINL,r.L-REEL*dt);
      const sp=Math.hypot(r.vx,r.vy);if(sp>MAXV){r.vx*=MAXV/sp;r.vy*=MAXV/sp;}
      r.x+=r.vx*dt;r.y+=r.vy*dt;
      if(hold){
        const t2=r.tongue,dx=r.x-t2.x,dy=r.y-t2.y,d=Math.hypot(dx,dy);
        if(d>r.L){const nx=dx/d,ny=dy/d;r.x=t2.x+nx*r.L;r.y=t2.y+ny*r.L;const vr=r.vx*nx+r.vy*ny;if(vr>0){r.vx-=vr*nx;r.vy-=vr*ny;}}
      }
    }else{
      // демо-качание на стартовом языке
      const a=Math.sin(r.t*2.2)*.5,t2=r.tongue;
      r.x=t2.x+Math.sin(a)*r.L;r.y=t2.y+Math.cos(a)*r.L;
      r.vx=Math.cos(r.t*2.2)*.5*2.2*r.L*Math.cos(a);r.vy=-Math.sin(a)*Math.cos(r.t*2.2)*.5*2.2*r.L;
    }
    // наклон: на языке — головой к точке зацепа, в полёте — по скорости
    const tgt=r.tongue&&r.tongue.st==='hold'?Math.atan2(r.tongue.x-r.x,r.y-r.tongue.y):clamp(r.vx*.0004+r.vy*.0005,-.5,.6);
    r.rot+=(tgt-r.rot)*Math.min(1,dt*(r.tongue&&r.tongue.st==='hold'?14:6));
    // пружинка тела, шлейф и линии скорости, камера отъезжает на скорости
    r.sqV+=(-r.sq*320-r.sqV*13)*dt;r.sq+=r.sqV*dt;
    const spd=Math.hypot(r.vx,r.vy);
    r.trailT-=dt;if(r.trailT<=0){r.trailT=.03;if(spd>820||r.dragon>0){r.trail.push({x:r.x,y:r.y,rot:r.rot});if(r.trail.length>6)r.trail.shift();}else if(r.trail.length)r.trail.shift();}
    if(spd>860&&fxR()<(spd-860)/420)P({k:'line',x:r.camX+W+rnd(0,80),y:rnd(TOP+40,WY-20),vx:-spd*1.3,vy:0,g:0,life:.4,s:rnd(30,80)});
    const zt=1-clamp((spd-600)/900,0,1)*.08-r.zpulse;r.zpulse*=Math.exp(-dt*4);r.zoom+=(zt-r.zoom)*Math.min(1,dt*3);
    // события: что-то происходит каждые 11–16 секунд
    if(r.started){r.nextEv-=dt;if(r.nextEv<=0&&dist(r)>40){r.nextEv=11+fxR()*5;tryEvent(r);}}
    for(const it of r.items){
      it.t+=dt;if(it.taken)continue;
      if(Math.hypot(it.x-r.x,it.y+Math.sin(it.t*2.4)*5-r.y)<R+22){
        it.taken=true;
        if(it.k==='b'){r.shield=true;SND.shield();B.haptic.medium();txt(r.x,r.y-44,'Щит!',{c:'#bfefff'});}
        else{r.dragon=2.8;r.invul=3.3;SND.dragon();B.haptic.medium();txt(r.x,r.y-44,'Полетели!',{c:'#9dffb0'});
          if(r.tongue&&r.tongue.st!=='back'){r.tongue.st='back';r.tongue.len=Math.hypot(r.tongue.x-r.x,r.tongue.y-r.y);}}
        sparks(it.x,it.y,12,'#ffffff');
      }
    }
    if(r.items.length>8)r.items=r.items.filter(it=>!it.taken&&it.x>r.camX-W);

    // потолок: лбом в дерево — сползаем вниз; в колючки — конец
    for(const ox of [-R*.7,0,R*.7]){
      const s=segAt(r,r.x+ox);
      if(s&&r.y-R<s.y){
        if(s.k==='t'&&hurt(r,'thorn'))return;
        if(r.y-R<s.y-14&&ox!==0){ // въехали в торец более низкого участка
          r.x-=Math.sign(ox)*2;r.vx=-r.vx*.3;
        }
        r.y=s.y+R;if(r.vy<0)r.vy=0;
      }
    }
    if(r.y<-80){r.y=-80;if(r.vy<0)r.vy=0;}
    // корни и камыши
    for(const o of r.roots){if(Math.abs(r.x-o.x)<o.w/2+R*.55&&r.y>o.y0&&r.y-R*.5<o.y1&&hurt(r,'root'))return;}
    for(const o of r.reeds){if(Math.abs(r.x-o.x)<o.w/2+R*.55&&r.y+R*.6>o.top+8&&hurt(r,'reed'))return;}
    // вода и кувшинки
    if(r.y+R*.6>WY&&r.vy>0){
      const p=r.pads.find(p=>Math.abs(p.x-r.x)<p.w/2+8);
      if(p||r.shield){
        const spr=p&&p.spring;
        r.y=WY-R*.6;r.vy=spr?-1250:-Math.max(820,r.vy*.6);r.vx=Math.max(r.vx,spr?460:320);r.bounces++;r.sq=-.3;r.sqV=0;
        if(r.tongue&&r.tongue.st!=='back')r.tongue.st='back';
        if(p){p.dipV=260;p.springT=0;}
        if(!p){r.shield=false;r.invul=.6;SND.pop();sparks(r.x,WY,14,'#bfefff');}
        if(spr){SND.spring();B.haptic.medium();r.shake=4;r.zpulse=.06;txt(r.x,r.y-44,'Вжух!',{c:'#b6f0a0',s:20});}
        else{SND.bounce();B.haptic.light();txt(r.x,r.y-40,p?'Пружинит!':'Щит!',{c:p?'#9dffb0':'#bfefff',s:16});}
        splash(r.x,WY,6);
      }else{r.y=WY;die('water');splash(r.x,WY,16);SND.splash();return;}
    }
    // мошки: рядом с лягушкой их затягивает к ней — ловятся сами, если лететь через рой
    for(const f of r.flies){
      if(f.taken)continue;
      if(f.vx&&!f.pull)f.x+=f.vx*dt;
      const fy=f.pull?f.y:f.y+Math.sin(f.t*4.3)*4,dx=r.x-f.x,dy=r.y-fy,d=Math.hypot(dx,dy)||1;
      if(!f.pull&&d<(f.gold?100:80)*(r.dragon>0?1.8:1)){f.pull=true;f.y=fy;}
      if(f.pull){const st=(Math.hypot(r.vx,r.vy)+700)*dt;if(d<=st+R*.6){catchFly(r,f);continue;}f.x+=dx/d*st;f.y+=dy/d*st;}
    }
    if(r.combo&&r.t-r.comboT>1.3){r.combo=0;comboRender(r);}
    // цапля сзади: не даёт стоять. Держится сразу за краем экрана и подлетает,
    // если лягушка медлит
    // цапля вылетает не сразу: новичку дают раскачаться и сделать первый полёт
    if(r.started&&r.rel0!=null&&r.t-r.rel0>2.5){
      const m=r.x/UNIT,hv=lerp(150,340,clamp(m/2500,0,1));
      r.hx=r.hx<-9000?r.camX-700:Math.max(r.hx+hv*dt,r.camX-300);
      r.hy+=(r.y-r.hy)*Math.min(1,dt*2);
      const gap=r.x-r.hx;
      r.heronWarn=clamp(1-(gap-80)/320,0,1);
      if(!r.heronOn&&r.hx>r.camX-60){r.heronOn=true;SND.heron();}
      if(r.hx<r.camX-120)r.heronOn=false;
      if(gap<34){if(r.shield){r.shield=false;r.invul=.8;r.hx-=260;SND.pop();sparks(r.x,r.y,14,'#bfefff');txt(r.x,r.y-44,'Щит!',{c:'#bfefff'});}else{die('heron');return;}}
    }
    // камера: лягушка на трети экрана, чуть впереди — куда летим
    const cam=r.x-W*.33+clamp(r.vx*.08,-20,50);
    r.camX+=(cam-r.camX)*Math.min(1,dt*4);
    if(r.x>r.maxX){
      r.maxX=r.x;const m=dist(r);hudH(m);
      if(m>=r.mile){r.mile+=100;SND.mile();kick(elHB,'pulse');}
      let zi=0;for(let i=0;i<ZONES.length;i++)if(m>=ZONES[i].m)zi=i;
      if(zi>r.zone){r.zone=zi;SND.zone();banner(ZONES[zi].name,`${fmtM(m)} м`);}
      for(const rv of rivals)if(!r.passed.has(rv.id)&&m>rv.best){r.passed.add(rv.id);SND.pass();txt(r.x,r.y-50,`Обогнал ${rv.name}`,{c:'#ffe680',s:16,life:1.1});}
      if(!r.bestCrossed&&bestBefore>0&&m>bestBefore){r.bestCrossed=true;SND.record();banner('Новый рекорд!','',true);B.haptic.success();}
    }
    gen(r);
  }
  function die(cause){
    const r=run;if(!r.alive)return;
    r.alive=false;r.cause=cause;r.dyingT=0;holding=false;ptrs.clear();r.slow=.5;r.hitstop=cause==='water'?0:.07;r.shield=false;r.dragon=0;
    if(r.tongue&&r.tongue.st!=='back'){r.tongue.st='back';r.tongue.len=Math.hypot(r.tongue.x-r.x,r.tongue.y-r.y);}
    if(cause!=='water'){r.vy=cause==='thorn'?120:-260;r.vx*=.3;SND.hit();r.shake=6;}
    if(cause==='heron'){r.vy=-380;r.vx=200;}
    B.haptic.error&&B.haptic.error();
  }

  /* ---------- отрисовка ---------- */
  let motes=[];
  function mkMotes(){motes=[];for(let i=0;i<46;i++)motes.push({x:Math.random(),y:Math.random(),d:.15+Math.random()*.5,s:.6+Math.random()*.9,ph:Math.random()*6});}
  mkMotes();
  function zoneBlend(m){
    let i=0;while(i<ZONES.length-1&&m>=ZONES[i+1].m)i++;
    if(i>=ZONES.length-1)return {a:ZONES[i],b:ZONES[i],t:0,mt:0};
    const b=ZONES[i+1],k=clamp((m-ZONES[i].m)/(b.m-ZONES[i].m),0,1);
    return {a:ZONES[i],b,t:k*k*(3-2*k),mt:clamp((k-.5)/.4,0,1)};
  }
  function drawMotes(kind,alpha,camPx){
    if(alpha<=.01)return;
    const w=cssW+120,n=quality?motes.length:Math.round(motes.length*.45);
    for(let i=0;i<n;i++){
      const m=motes[i];
      const x=((m.x*w-camPx*m.d)%w+w)%w-60,y=m.y*cssH*.85;
      const tw=.5+.5*Math.sin(tGlobal*2+m.ph);
      cx.globalAlpha=alpha;
      if(kind==='firefly'){cx.fillStyle=`rgba(220,255,140,${.12*tw})`;cx.beginPath();cx.arc(x,y+Math.sin(tGlobal+m.ph)*8,7*m.s,0,7);cx.fill();cx.fillStyle=`rgba(240,255,190,${.8*tw})`;cx.beginPath();cx.arc(x,y+Math.sin(tGlobal+m.ph)*8,1.8*m.s,0,7);cx.fill();}
      else if(kind==='pollen'){cx.fillStyle=`rgba(255,235,200,${.35+.3*tw})`;cx.beginPath();cx.arc(x,y+Math.sin(tGlobal*.7+m.ph)*14,1.7*m.s,0,7);cx.fill();}
      else if(kind==='cloud'){if(m.s<1.1)continue;if(has('cloud_1')&&quality){cx.globalAlpha=alpha*.3;const k=['cloud_1','cloud_2','cloud_3'][Math.floor(m.ph)%3],im=IMG[k],ww=78*m.s*sc;cx.drawImage(im,x-ww/2,y-ww*im.naturalHeight/im.naturalWidth/2,ww,ww*im.naturalHeight/im.naturalWidth);}else{cx.fillStyle='rgba(255,255,255,.25)';cx.beginPath();cx.ellipse(x,y,46*m.s,13*m.s,0,0,7);cx.fill();}}
      else{cx.fillStyle=`rgba(255,255,255,${.25+.7*tw})`;cx.beginPath();cx.arc(x,y,1.3*m.s,0,7);cx.fill();}
    }
    cx.globalAlpha=1;
  }
  /* ---------- нарисованные куски ----------
     Печём один раз под масштаб экрана, в стиле стикеров и ассетов Jump: тёмный
     контур, два тона заливки и блик. Когда придут картинки из Nano Banana
     (swing/branch, leaves, forest, thorns, front), они заменят эти заготовки */
  let TW=240;const TLH=100,BARK=86,BH=40;                   // плитка кроны; низ коры — на высоте сегмента
  let tWood=null,tThorn=null,tBushR=null,tBushL=null,tFar=null,tNear=null,tFront=null;
  function mkCanvas(w,h){const c=document.createElement('canvas');c.width=Math.max(1,Math.ceil(w*sc*dpr));c.height=Math.max(1,Math.ceil(h*sc*dpr));const g=c.getContext('2d');g.scale(sc*dpr,sc*dpr);c.w=w;c.h=h;return [c,g];}
  function srand(s){return ()=>{s=(s*16807)%2147483647;return (s-1)/2147483646;};}
  // листва: сначала все контуры, потом заливки — выходит одна масса с общим контуром
  function leafMass(g,blobs,pal){
    g.fillStyle=pal[0];for(const b of blobs){g.beginPath();g.arc(b.x,b.y,b.r+2.4,0,7);g.fill();}
    g.fillStyle=pal[1];for(const b of blobs){g.beginPath();g.arc(b.x,b.y,b.r,0,7);g.fill();}
    g.fillStyle=pal[2];for(const b of blobs){g.beginPath();g.arc(b.x-b.r*.14,b.y-b.r*.18,b.r*.8,0,7);g.fill();}
    g.fillStyle=pal[3];for(const b of blobs){if(b.r<8)continue;g.beginPath();g.ellipse(b.x-b.r*.38,b.y-b.r*.42,b.r*.3,b.r*.18,-.6,0,7);g.fill();}
  }
  const LEAF=['#0f3a1f','#1f6a34','#2f8f45','rgba(190,255,170,.55)'];
  const DLEAF=['#1a0d1c','#3b1f3d','#552c50','rgba(255,180,220,.3)'];
  function wrapBlobs(rn,n,y0,y1,r0,r1){
    const a=[];for(let i=0;i<n;i++){const b={x:rn()*TW,y:lerp(y0,y1,Math.pow(rn(),.7)),r:lerp(r0,r1,rn())};a.push(b,{...b,x:b.x-TW},{...b,x:b.x+TW});}
    return a.sort((p,q)=>p.y-q.y);
  }
  function buildArt(){
    let g;
    // кора с мхом и листвой над ней — за неё цепляется язык
    // ширина плитки — под ленту ветки, чтобы повтор был бесшовным
    TW=has('branch')?Math.round(BH*IMG.branch.naturalWidth/IMG.branch.naturalHeight):240;
    [tWood,g]=mkCanvas(TW,TLH);if(has('branch')){
      const rn=srand(7);
      if(has('leaves')){
        // два ряда пучков: задний притемнён — у кроны появляется объём
        const im=IMG.leaves,dark=document.createElement('canvas');dark.width=im.naturalWidth;dark.height=im.naturalHeight;
        {const d=dark.getContext('2d');d.drawImage(im,0,0);d.globalCompositeOperation='source-atop';d.fillStyle='rgba(6,34,16,.55)';d.fillRect(0,0,dark.width,dark.height);}
        g.fillStyle='#0f3a1f';g.fillRect(0,0,TW,40);
        const row=(src,n,y0,w0,w1)=>{for(let i=0;i<n;i++){const w=lerp(w0,w1,rn()),x=(i+rn()*.6)*TW/n,y=y0+rn()*10,a=(rn()-.5)*.6;
          for(const dx of [-TW,0,TW]){g.save();g.translate(x+dx,y);g.rotate(a);g.drawImage(src,-w/2,-w*.55,w,w*im.naturalHeight/im.naturalWidth);g.restore();}}};
        row(dark,Math.max(4,Math.round(TW/34)),8,44,60);
        row(im,Math.max(3,Math.round(TW/44)),34,38,52);
      }else leafMass(g,wrapBlobs(rn,Math.round(TW/9),2,58,9,20),LEAF);
      g.drawImage(IMG.branch,0,BARK-BH+4,TW+.5,BH);
    }else{
      const rn=srand(7);
      leafMass(g,wrapBlobs(rn,26,4,64,9,20),LEAF);
      const y0=BARK-17;
      const gr=g.createLinearGradient(0,y0,0,BARK);gr.addColorStop(0,'#a8703f');gr.addColorStop(.45,'#7a4b26');gr.addColorStop(1,'#4f2f17');
      g.fillStyle='#2e1a0b';g.fillRect(-4,y0-2.2,TW+8,BARK-y0+4.4);
      g.fillStyle=gr;g.fillRect(-4,y0,TW+8,BARK-y0);
      g.fillStyle='rgba(222,170,110,.75)';g.fillRect(-4,y0+1.6,TW+8,2.2);
      g.strokeStyle='rgba(46,26,11,.75)';g.lineWidth=1.6;g.lineCap='round';
      for(let i=0;i<14;i++){const x=rn()*TW,y=y0+5+rn()*8,l=8+rn()*16;g.beginPath();g.moveTo(x,y);g.quadraticCurveTo(x+l/2,y+(rn()-.5)*3,x+l,y+(rn()-.5)*2);g.stroke();}
      for(let i=0;i<3;i++){const x=20+rn()*200,y=y0+9;g.fillStyle='#4f2f17';g.beginPath();g.ellipse(x,y,4.5,3,0,0,7);g.fill();g.fillStyle='#2e1a0b';g.beginPath();g.ellipse(x,y,2,1.3,0,0,7);g.fill();}
      // мох на коре и свисающие пряди
      const moss=[];for(let i=0;i<10;i++){const b={x:rn()*TW,y:y0-1+rn()*2,r:3+rn()*4};moss.push(b,{...b,x:b.x-TW},{...b,x:b.x+TW});}
      leafMass(g,moss,['#123d24','#4f9a3a','#79c24f','rgba(230,255,190,.6)']);
      for(let i=0;i<7;i++){
        const x=10+i*TW/7+rn()*14,l=6+rn()*9;
        g.strokeStyle='#123d24';g.lineWidth=4.2;g.beginPath();g.moveTo(x,BARK-1);g.quadraticCurveTo(x+2,BARK+l*.6,x+1,BARK+l);g.stroke();
        g.strokeStyle='#6fb648';g.lineWidth=2.2;g.beginPath();g.moveTo(x,BARK-1);g.quadraticCurveTo(x+2,BARK+l*.6,x+1,BARK+l);g.stroke();
      }
    }
    // колючая ветка: язык не берёт, касаться нельзя
    [tThorn,g]=mkCanvas(TW,TLH);{
      const rn=srand(11);
      if(has('leaves')){
        // та же листва, но больная: тёмно-лиловая
        const im=IMG.leaves,sick=document.createElement('canvas');sick.width=im.naturalWidth;sick.height=im.naturalHeight;
        {const d=sick.getContext('2d');d.drawImage(im,0,0);d.globalCompositeOperation='source-atop';d.fillStyle='rgba(58,18,52,.72)';d.fillRect(0,0,sick.width,sick.height);}
        g.fillStyle='#1a0d1c';g.fillRect(0,0,TW,40);
        for(let i=0;i<Math.max(5,Math.round(TW/36));i++){const w=40+rn()*18,x=(i+rn()*.6)*TW/Math.max(5,Math.round(TW/36)),y=14+rn()*30,a=(rn()-.5)*.6;
          for(const dx of [-TW,0,TW]){g.save();g.translate(x+dx,y);g.rotate(a);g.drawImage(sick,-w/2,-w*.55,w,w*im.naturalHeight/im.naturalWidth);g.restore();}}
      }else leafMass(g,wrapBlobs(rn,24,4,62,9,18),DLEAF);
      const yc=BARK-14;
      g.lineCap='round';
      const stem=w=>{g.lineWidth=w;g.beginPath();g.moveTo(-6,yc);for(let x=-6;x<=TW+6;x+=6)g.lineTo(x,yc+Math.sin(x/TW*Math.PI*6)*3);g.stroke();};
      g.strokeStyle='#1a0812';stem(13);g.strokeStyle='#5a2448';stem(9);g.strokeStyle='#7d3a63';g.lineWidth=2;g.beginPath();for(let x=-6;x<=TW+6;x+=6)g.lineTo(x,yc-2.5+Math.sin(x/TW*Math.PI*6)*3);g.stroke();
      for(let x=6;x<TW;x+=15){
        const y=yc+Math.sin(x/TW*Math.PI*6)*3+3,h=11+((x*7)%9),w=5.5,lean=((x*13)%7-3)*.6;
        g.fillStyle='#1a0812';g.beginPath();g.moveTo(x-w-1.6,y-1);g.lineTo(x+lean,y+h+2.6);g.lineTo(x+w+1.6,y-1);g.closePath();g.fill();
        g.fillStyle='#e0405f';g.beginPath();g.moveTo(x-w,y);g.lineTo(x+lean,y+h);g.lineTo(x+w,y);g.closePath();g.fill();
        g.fillStyle='#ff98ad';g.beginPath();g.moveTo(x-w+1.5,y+.5);g.lineTo(x+lean-.5,y+h-3);g.lineTo(x-1,y+.5);g.closePath();g.fill();
        // шипы и вверх — ветка выглядит злой со всех сторон
        if((x/15|0)%2){g.fillStyle='#1a0812';g.beginPath();g.moveTo(x+4,y-6);g.lineTo(x+9,y-15);g.lineTo(x+10,y-5);g.fill();g.fillStyle='#e0405f';g.beginPath();g.moveTo(x+5,y-6);g.lineTo(x+8.8,y-13);g.lineTo(x+9.4,y-6);g.fill();}
      }
    }
    // пышный край кроны у дыры
    [tBushR,g]=mkCanvas(70,130);if(has('leaves')){
      const im=IMG.leaves,w=66,h=w*im.naturalHeight/im.naturalWidth;
      g.drawImage(im,2,8,w*.8,h*.8);g.drawImage(im,4,48,w,h);
    }else{
      const rn=srand(3),b=[];
      for(let i=0;i<14;i++)b.push({x:18+rn()*26,y:6+rn()*104,r:9+rn()*12});
      b.push({x:30,y:112,r:10},{x:22,y:118,r:7});
      leafMass(g,b.sort((p,q)=>p.y-q.y),LEAF);
      g.strokeStyle='#123d24';g.lineWidth=4;g.lineCap='round';g.beginPath();g.moveTo(40,100);g.quadraticCurveTo(52,112,48,128);g.stroke();
      g.strokeStyle='#6fb648';g.lineWidth=2;g.beginPath();g.moveTo(40,100);g.quadraticCurveTo(52,112,48,128);g.stroke();
    }
    [tBushL,g]=mkCanvas(70,130);g.translate(70,0);g.scale(-1,1);g.drawImage(tBushR,0,0,70,130);
    // дальний лес: два слоя силуэтов, ниже — дымка
    const forest=(seed,h,k)=>{
      const [c,f]=mkCanvas(480,h),rn=srand(seed);
      f.fillStyle='#fff';
      for(let i=0;i<9;i++){
        const x=rn()*480,w=(8+rn()*10)*k,top=h*(.25+rn()*.35);
        for(const dx of [-480,0,480]){
          f.beginPath();f.moveTo(x+dx-w,h);f.lineTo(x+dx-w*.6,top);f.lineTo(x+dx+w*.6,top);f.lineTo(x+dx+w,h);f.fill();
          for(let j=0;j<5;j++){f.beginPath();f.arc(x+dx+(rn()-.5)*60*k,top-rn()*30*k,(22+rn()*22)*k,0,7);f.fill();}
          // ветки-лианы свисают с кроны
          f.lineWidth=2.4*k;f.strokeStyle='#fff';f.beginPath();f.moveTo(x+dx+20*k,top);f.quadraticCurveTo(x+dx+26*k,top+40*k,x+dx+22*k,top+(60+rn()*50)*k);f.stroke();
        }
      }
      f.fillRect(0,h-6,480,6);
      return c;
    };
    tFar=forest(5,300,.8);tNear=forest(9,260,1.15);
    // передний план: тёмная трава и рогоз у нижнего края
    [tFront,g]=mkCanvas(320,120);{
      const rn=srand(21);g.lineCap='round';
      for(let i=0;i<40;i++){
        const x=rn()*320,h=30+rn()*80,bend=(rn()-.5)*30;
        for(const dx of [-320,0,320]){
          g.strokeStyle='#04140b';g.lineWidth=3+rn()*3;g.beginPath();g.moveTo(x+dx,122);g.quadraticCurveTo(x+dx+bend*.2,120-h*.6,x+dx+bend,120-h);g.stroke();
        }
        if(i%6===0)for(const dx of [-320,0,320]){g.fillStyle='#0b1f12';g.beginPath();g.ellipse(x+dx+bend*.6,122-h*.8,4,11,bend*.01,0,7);g.fill();}
      }
    }
  }
  function tileStrip(t,x0,x1,cam,y){
    // плитка привязана к миру, поэтому не «едет» вместе с краем участка
    const a=Math.floor(x0/TW)*TW;
    cx.save();cx.beginPath();cx.rect(x0-cam,y-2,x1-x0,TLH+20);cx.clip();
    for(let x=a;x<x1;x+=TW)cx.drawImage(t,x-cam,y,TW+.6,TLH);
    cx.restore();
  }
  // слой с параллаксом, тонированный под зону: белые силуэты красим через source-atop
  const tinted=new Map();
  function tint(t,col){
    const key=t.width+'/'+col;let c=tinted.get(t)&&tinted.get(t).col===col?tinted.get(t).c:null;
    if(!c){c=document.createElement('canvas');c.width=t.width;c.height=t.height;const g=c.getContext('2d');g.drawImage(t,0,0);g.globalCompositeOperation='source-atop';g.fillStyle=col;g.fillRect(0,0,c.width,c.height);tinted.set(t,{col,c});}
    return c;
  }
  function layer(t,k,cam,yBottom,col,alpha){
    const c=tint(t,col),w=t.w,h=t.h,L=-offX/sc-40,Rr=W+offX/sc+40;
    const off=((cam*k)%w+w)%w;
    cx.globalAlpha=alpha;
    for(let x=L-off-w*Math.ceil(0);x<Rr;x+=w){if(x+w<L)continue;cx.drawImage(c,x,yBottom-h,w+.6,h);}
    cx.globalAlpha=1;
  }
  const zoneMix=(z,k)=>mixc(z.a[k],z.b[k],z.t);
  let fTint=null;
  function forestTint(src,col){
    if(fTint&&fTint.src===src&&fTint.col===col)return fTint.c;
    const c=document.createElement('canvas');c.width=src.width;c.height=src.height;const g=c.getContext('2d');
    g.drawImage(src,0,0);g.globalCompositeOperation='source-atop';g.globalAlpha=.55;g.fillStyle=col;g.fillRect(0,0,c.width,c.height);
    // верх ленты растворяем: иначе у леса видна ровная горизонтальная кромка
    g.globalAlpha=1;g.globalCompositeOperation='destination-in';
    const gr=g.createLinearGradient(0,0,0,c.height*.4);gr.addColorStop(0,'rgba(0,0,0,0)');gr.addColorStop(1,'rgba(0,0,0,1)');
    g.fillStyle=gr;g.fillRect(0,0,c.width,c.height);
    fTint={src,col,c};return c;
  }
  function drawBack(r,z){
    const cam=r.camX;
    // дальний и ближний лес темнее неба, с дымкой у воды
    // цвет слоя квантуем: иначе на переходе зон перекрашивали бы плитку каждый кадр
    const zq={a:z.a,b:z.b,t:Math.round(z.t*8)/8};
    const far=mixc(zoneMix(zq,'bot'),'#000000',.18),near=mixc(zoneMix(zq,'bot'),'#000000',.42);
    if(!has('forest'))layer(tFar,.12,cam,WY+2,far,.55);
    const hz=cx.createLinearGradient(0,WY-160,0,WY);hz.addColorStop(0,'rgba(255,255,255,0)');hz.addColorStop(1,'rgba(220,255,235,.12)');
    cx.fillStyle=hz;cx.fillRect(-offX/sc,WY-160,W+2*offX/sc,160);
    if(has('forest')){
      const im=IMG.forest,h=Math.min(470,(WY-TOP)*.85),w=h*im.naturalWidth/im.naturalHeight,off=((cam*.3)%w+w)%w,L=-offX/sc-40,Rr=W+offX/sc+40;
      // под цвет зоны: закат, облака, ночь — красим сам лес, не полосу
      const fc=forestTint(scaled('forest',w),mixc(zoneMix(zq,'bot'),zoneMix(zq,'top'),.3));
      for(let x=L-off;x<Rr;x+=w)if(x+w>L)cx.drawImage(fc,x,WY-h+8,w+.6,h);
    }else layer(tNear,.32,cam,WY+2,near,.8);
    // лианы среднего плана: качаются, ни за что не цепляют
    cx.lineCap='round';
    const step=96,first=Math.floor((cam*.7-offX/sc)/step)-1;
    for(let i=first;i<first+8;i++){
      const h=(Math.sin(i*12.9898)*43758.5453)%1,hh=Math.abs(h);
      if(hh<.35)continue;
      const x=i*step+hh*60-cam*.7,l=110+hh*220,sw=Math.sin(tGlobal*.9+i)*6;
      cx.strokeStyle='rgba(8,40,22,.55)';cx.lineWidth=3.2;cx.beginPath();cx.moveTo(x,-10);cx.quadraticCurveTo(x+sw,l*.55,x+sw*1.6,l);cx.stroke();
      cx.fillStyle='rgba(20,70,36,.6)';
      for(let k=1;k<5;k++){const t=k/5,lx=x+sw*1.6*t*t,ly=l*t;cx.beginPath();cx.ellipse(lx+(k%2?5:-5),ly,6,3,k%2?.6:-.6,0,7);cx.fill();}
    }
  }
  function drawCeiling(r,z){
    const cam=r.camX,L=cam-offX/sc-80,Rr=cam+W+offX/sc+80;
    // свет из дыр — тёплые лучи вниз, чуть дышат
    for(let i=0;i<r.segs.length-1;i++){
      const a=r.segs[i],b=r.segs[i+1];if(b.x0-a.x1<20||a.x1>Rr||b.x0<L)continue;
      const x0=a.x1-cam,x1=b.x0-cam,yt=Math.min(a.y,b.y)-40,br=.18+.05*Math.sin(tGlobal*1.3+i);
      const g=cx.createLinearGradient(0,yt,0,WY);g.addColorStop(0,`rgba(255,240,180,${br})`);g.addColorStop(1,'rgba(255,240,180,0)');
      cx.fillStyle=g;cx.beginPath();cx.moveTo(x0+6,yt);cx.lineTo(x1-6,yt);cx.lineTo(x1+70,WY);cx.lineTo(x0+40,WY);cx.closePath();cx.fill();
    }
    const night=z.b===ZONES[3]?z.t:(z.a===ZONES[3]?1:0);
    const top=mixc('#0f3a1f','#0a1c18',night);
    for(const s of r.segs){
      if(s.x1<L||s.x0>Rr)continue;
      const x0=s.x0-cam,x1=s.x1-cam,base=s.k==='w'?s.y:s.y-8,ty=base-BARK;
      cx.fillStyle=top;cx.fillRect(x0,-80,x1-x0,ty+42+80);
      tileStrip(s.k==='w'?tWood:tThorn,s.x0,s.x1,cam,ty);
    }
    for(let i=0;i<r.segs.length;i++){
      const s=r.segs[i],n=r.segs[i+1],p=r.segs[i-1];
      if(s.x1<L||s.x0>Rr)continue;
      const base=s.k==='w'?s.y:s.y-8;
      if(!n||n.x0-s.x1>2)cx.drawImage(tBushR,s.x1-cam-36,base-122,70,130);
      if(!p||s.x0-p.x1>2)cx.drawImage(tBushL,s.x0-cam-34,base-122,70,130);
    }
  }
  // свисающий камыш: картинка из Flappy, обрезанная сверху под нужную длину
  function drawRoot(o,cam){
    const L=o.y1-o.y0,x=o.x-cam,sw=Math.sin(tGlobal*1.1+o.ph)*1.5;
    if(has('reed_top')){
      const im=IMG.reed_top,w=46,s=w/im.naturalWidth,full=im.naturalHeight*s;
      cx.save();cx.translate(x+sw,o.y0-6);cx.rotate(sw*.004);
      if(L+6<=full){const sh=(L+6)/s;cx.drawImage(im,0,im.naturalHeight-sh,im.naturalWidth,sh,-w/2,0,w,L+6);}
      else cx.drawImage(im,-w/2,0,w,L+6);
      cx.restore();return;
    }
    cx.fillStyle='#3e8a3a';cx.fillRect(x-o.w/2,o.y0,o.w,L);
  }
  function drawReed(o,cam){
    const H=WY-o.top,x=o.x-cam;
    if(has('reed_bottom')){
      const im=IMG.reed_bottom,w=48,s=w/im.naturalWidth,full=im.naturalHeight*s,h=H+14;
      if(h<=full)cx.drawImage(im,0,0,im.naturalWidth,h/s,x-w/2,o.top-6,w,h);
      else cx.drawImage(im,x-w/2,o.top-6,w,h);
      return;
    }
    cx.fillStyle='#4fa246';cx.fillRect(x-o.w/2,o.top,o.w,H);
  }
  function drawFly(f,cam){
    const x=f.x-cam+(f.pull?0:Math.sin(f.t*3.1)*5),y=f.y+(f.pull?0:Math.sin(f.t*4.3)*4);
    const flap=Math.abs(Math.sin(f.t*38));
    if(f.gold){cx.fillStyle=`rgba(255,210,63,${.22+.1*Math.sin(f.t*6)})`;cx.beginPath();cx.arc(x,y,18,0,7);cx.fill();}
    else{cx.fillStyle='rgba(255,255,230,.13)';cx.beginPath();cx.arc(x,y,13,0,7);cx.fill();}
    cx.fillStyle='rgba(223,242,255,.9)';cx.strokeStyle='rgba(40,60,80,.5)';cx.lineWidth=.8;
    cx.beginPath();cx.ellipse(x-6,y-.5,7,2.4*flap+.7,-.95,0,7);cx.fill();cx.stroke();
    cx.beginPath();cx.ellipse(x+6,y-.5,7,2.4*flap+.7,.95,0,7);cx.fill();cx.stroke();
    cx.fillStyle=f.gold?'#f5b400':'#333a45';
    cx.beginPath();cx.ellipse(x,y+2.6,3.6,4.8,0,0,7);cx.fill();
    cx.beginPath();cx.ellipse(x,y-2,3.2,2.8,0,0,7);cx.fill();
    cx.fillStyle=f.gold?'#ffd97a':'#414b5c';cx.beginPath();cx.arc(x,y-5.6,2.6,0,7);cx.fill();
    cx.fillStyle=f.gold?'#ffe680':'#e0405f';cx.beginPath();cx.arc(x-1.5,y-6.2,1.3,0,7);cx.arc(x+1.5,y-6.2,1.3,0,7);cx.fill();
  }
  // цапля из Flappy: шея выходит из-за левого края, клюв щёлкает вперёд
  function drawHeron(r){
    const x=r.hx-r.camX,y=r.hy,snap=Math.max(0,Math.sin(tGlobal*7))*.12;
    if(has('heron')){
      const im=IMG.heron,h=120,w=h*im.naturalWidth/im.naturalHeight;
      // в картинке клюв смотрит вверх-вправо, шея уходит вниз: поворот кладёт клюв
      // горизонтально на лягушку, шея тянется из-за левого нижнего края
      cx.save();cx.translate(x,y);cx.rotate(.9-snap);
      cx.drawImage(im,-w*.4,-h*.3,w,h);
      cx.restore();
      return;
    }
    cx.fillStyle='#dfe6ec';cx.beginPath();cx.ellipse(x,y,26,12,0,0,7);cx.fill();
    cx.fillStyle='#e7a35a';cx.beginPath();cx.moveTo(x+20,y-4);cx.lineTo(x+52,y);cx.lineTo(x+20,y+4);cx.fill();
  }
  // язык — упругий: на вылете провисает, после зацепа дрожит и успокаивается,
  // у рта толще, к кончику тоньше
  function drawTongue(r){
    const tg=r.tongue;if(!tg)return;
    const m=mouth(r),dx=tg.x-m.x,dy=tg.y-m.y,d=Math.hypot(dx,dy)||1;
    const l=tg.st==='hold'?d:Math.min(d,Math.max(0,tg.len));
    const ux=dx/d,uy=dy/d,tx=m.x+ux*l,ty=m.y+uy*l,cam=r.camX;
    const wob=tg.st==='hold'?Math.sin((tg.wt||0)*42)*Math.exp(-(tg.wt||0)*7)*16:0;
    const sag=tg.st==='out'?Math.min(20,l*.09):tg.st==='back'?Math.min(14,l*.07):0;
    const qx=(m.x+tx)/2-uy*wob,qy=(m.y+ty)/2+ux*wob+sag;
    const N=14,Lp=[],Rp=[];
    for(let i=0;i<=N;i++){
      const t=i/N,a=1-t,px=a*a*m.x+2*a*t*qx+t*t*tx,py=a*a*m.y+2*a*t*qy+t*t*ty;
      const gx=2*a*(qx-m.x)+2*t*(tx-qx),gy=2*a*(qy-m.y)+2*t*(ty-qy),gl=Math.hypot(gx,gy)||1,w=lerp(4.6,2.6,t);
      Lp.push([px-cam-gy/gl*w,py+gx/gl*w]);Rp.push([px-cam+gy/gl*w,py-gx/gl*w]);
    }
    const poly=(grow)=>{cx.beginPath();Lp.forEach(([x,y],i)=>{const [rx,ry]=Rp[i],mx=(x+rx)/2,my=(y+ry)/2;const X2=mx+(x-mx)*grow,Y2=my+(y-my)*grow;i?cx.lineTo(X2,Y2):cx.moveTo(X2,Y2);});
      for(let i=N;i>=0;i--){const [x,y]=Rp[i],[lx,ly]=Lp[i],mx=(x+lx)/2,my=(y+ly)/2;cx.lineTo(mx+(x-mx)*grow,my+(y-my)*grow);}cx.closePath();cx.fill();};
    cx.fillStyle='#a82d50';poly(1.45);
    cx.fillStyle='#ff6f8e';poly(1);
    cx.strokeStyle='rgba(255,215,225,.75)';cx.lineWidth=1.2;cx.lineCap='round';cx.beginPath();
    for(let i=1;i<N;i++){const [x,y]=Lp[i],[rx,ry]=Rp[i],px=x*.7+rx*.3,py=y*.7+ry*.3;i>1?cx.lineTo(px,py):cx.moveTo(px,py);}cx.stroke();
    // липкий кончик; на держании — расплющен о кору
    cx.fillStyle='#ff8fa8';cx.beginPath();
    if(tg.st==='hold')cx.ellipse(tx-cam,ty-1,8,4.5,0,0,7);else cx.arc(tx-cam,ty,5.2,0,7);
    cx.fill();
  }
  // прицел: где прилипнет язык, если зажать сейчас
  function drawAim(r){
    if(!r.alive||!r.started)return;
    if(r.tongue&&r.tongue.st!=='back')return;
    const a=r.aim||(r.aim=aimAt(r)),cam=r.camX;
    const mx=a.mx-cam,my=a.my,tx=a.x-cam,ty=a.y;
    const len=Math.hypot(tx-mx,ty-my),ux=(tx-mx)/len,uy=(ty-my)/len;
    // пунктир от рта: точки бегут к цели
    const off=(tGlobal*90)%16;
    for(let t=26+off;t<len-12;t+=16){
      const k=t/len;cx.globalAlpha=(a.ok?.55:.3)*(a.ok?1:1-k);
      cx.fillStyle=a.ok?'#fff':'#ffb3c0';cx.beginPath();cx.arc(mx+ux*t,my+uy*t,2.2,0,7);cx.fill();
    }
    cx.globalAlpha=1;
    if(a.ok){
      const p=1+Math.sin(tGlobal*7)*.1,rr=11*p;
      cx.lineWidth=4;cx.strokeStyle='rgba(0,0,0,.35)';cx.beginPath();cx.arc(tx,ty+1,rr,0,7);cx.stroke();
      cx.lineWidth=2.4;cx.strokeStyle='#fff';cx.beginPath();cx.arc(tx,ty,rr,0,7);cx.stroke();
      cx.beginPath();
      for(const [ax,ay] of [[1,0],[-1,0],[0,1],[0,-1]]){cx.moveTo(tx+ax*(rr+3),ty+ay*(rr+3));cx.lineTo(tx+ax*(rr+8),ty+ay*(rr+8));}
      cx.stroke();
      cx.fillStyle='#ff6f8e';cx.beginPath();cx.arc(tx,ty,3,0,7);cx.fill();
    }else{
      // опоры нет — крестик там, где кончается язык
      cx.globalAlpha=.75;cx.strokeStyle='#ff6f8e';cx.lineWidth=3;cx.lineCap='round';
      cx.beginPath();cx.moveTo(tx-6,ty-6);cx.lineTo(tx+6,ty+6);cx.moveTo(tx+6,ty-6);cx.lineTo(tx-6,ty+6);cx.stroke();
      cx.globalAlpha=1;
    }
  }
  function frogAt(x,y,rot,va,sx,sy){
    cx.save();cx.translate(x,y);cx.rotate(va);cx.scale(sx,sy);cx.rotate(rot-va);
    if(frogImg)cx.drawImage(frogImg,-FROG/2,-FROG*.55,FROG,FROG);
    else{cx.fillStyle='#5cc27a';cx.beginPath();cx.ellipse(0,0,FROG*.4,FROG*.3,0,0,7);cx.fill();}
    cx.restore();
  }
  function drawFrog(r){
    const cam=r.camX,x=r.x-cam,y=r.y;
    // шлейф на скорости
    r.trail.forEach((t,i)=>{cx.globalAlpha=.06+.05*i;frogAt(t.x-cam,t.y,t.rot,0,1,1);});cx.globalAlpha=1;
    if(r.dragon>0&&has('dragonfly')){cx.save();cx.translate(x,y-FROG*.62);cx.scale(1,1+Math.sin(tGlobal*46)*.07);blit('dragonfly',0,0,74);cx.restore();}
    // растяжение по скорости в полёте и пружинка при зацепе/отскоке
    const sp=Math.hypot(r.vx,r.vy),hold=r.tongue&&r.tongue.st==='hold';
    const st=r.alive&&!hold?clamp((sp-300)/1800,0,.14):0,va=Math.atan2(r.vy,r.vx);
    if(r.invul>0&&r.alive&&!(r.dragon>0)&&Math.floor(tGlobal*16)%2)cx.globalAlpha=.55;
    frogAt(x,y,r.rot,va,(1+st)*(1+r.sq*.5),(1-st*.6)*(1-r.sq*.5));
    cx.globalAlpha=1;
    if(r.shield&&has('bubble')){cx.globalAlpha=.9;blit('bubble',x,y,FROG*1.3+Math.sin(tGlobal*3)*2);cx.globalAlpha=1;}
  }
  function drawItem(it,cam){
    const x=it.x-cam,y=it.y+Math.sin(it.t*2.4)*5;
    if(it.k==='b'){if(has('bubble'))blit('bubble',x,y,44+Math.sin(it.t*3)*2);else{cx.strokeStyle='#dff';cx.lineWidth=2;cx.beginPath();cx.arc(x,y,20,0,7);cx.stroke();}}
    else if(has('dragonfly')){cx.save();cx.translate(x,y);cx.scale(1,1+Math.sin(it.t*46)*.07);blit('dragonfly',0,0,60);cx.restore();}
    // мягкое свечение — видно, что это бонус
    cx.fillStyle=`rgba(255,255,220,${.12+.08*Math.sin(it.t*5)})`;cx.beginPath();cx.arc(x,y,30,0,7);cx.fill();
  }
  // подсказка первых забегов: момент отпускания
  function drawCoach(r){
    if(!r.coach||!r.alive)return;
    const tg=r.tongue;if(!tg||tg.st!=='hold')return;
    const ang=Math.atan2(-r.vy,r.vx);if(!(r.x>tg.x&&r.vx>150&&ang>.3&&ang<1.05))return;
    const x=r.x-r.camX,y=r.y+FROG*.75,s=1+Math.sin(tGlobal*14)*.06;
    cx.save();cx.translate(x,y);cx.scale(s,s);
    cx.font='900 15px Nunito,"Segoe UI",sans-serif';cx.textAlign='center';cx.textBaseline='middle';
    const w=cx.measureText('Отпускай!').width+22;
    cx.fillStyle='#f7b500';cx.beginPath();cx.roundRect?cx.roundRect(-w/2,-13,w,26,13):cx.rect(-w/2,-13,w,26);cx.fill();
    cx.fillStyle='#5a3b00';cx.fillText('Отпускай!',0,1);cx.restore();
  }
  function drawParts(r,front){
    const cam=r.camX;
    for(const p of r.parts){
      const isTxt=p.k==='txt';if(isTxt!==front)continue;
      const a=1-p.t/p.life,x=p.x-cam,y=p.y;
      if(p.k==='drop'){cx.fillStyle=p.c;cx.globalAlpha=a;cx.beginPath();cx.arc(x,y,p.s,0,7);cx.fill();}
      else if(p.k==='line'){cx.strokeStyle='rgba(255,255,255,.55)';cx.globalAlpha=a;cx.lineWidth=2;cx.lineCap='round';cx.beginPath();cx.moveTo(x,y);cx.lineTo(x+p.s,y);cx.stroke();}
      else if(p.k==='ring'){cx.strokeStyle=p.c+(a*.8).toFixed(2)+')';cx.lineWidth=2;const rr=p.s+p.t*110;cx.beginPath();cx.ellipse(x,y,rr,rr*.28,0,0,7);cx.stroke();}
      else if(p.k==='spark'){cx.fillStyle=p.c;cx.globalAlpha=a;cx.beginPath();cx.arc(x,y,p.s*(.5+a*.5),0,7);cx.fill();}
      else if(isTxt){
        const pop=p.t<.12?.6+p.t/.12*.5:(p.t<.2?1.1-(p.t-.12)/.08*.1:1);
        cx.globalAlpha=Math.min(1,a*2);cx.font=`900 ${p.s*pop}px Nunito,"Segoe UI",sans-serif`;cx.textAlign='center';cx.textBaseline='middle';
        cx.lineWidth=4;cx.strokeStyle='rgba(0,0,0,.45)';cx.strokeText(p.text,x,y);cx.fillStyle=p.c;cx.fillText(p.text,x,y);
      }
      cx.globalAlpha=1;
    }
  }
  // линия рекорда поперёк экрана — как в Frog Jump, только вертикальная
  let rivals=[];
  function drawRivals(r){
    cx.font='800 11px Nunito,"Segoe UI",sans-serif';cx.textBaseline='middle';cx.textAlign='center';
    rivals.forEach((rv,i)=>{
      const x=rv.best*UNIT-r.camX;if(x<-60||x>W+offX/sc+60)return;
      const done=r.passed.has(rv.id);
      cx.setLineDash([5,7]);cx.strokeStyle=done?'rgba(255,255,255,.25)':'rgba(255,255,255,.7)';cx.lineWidth=1.4;
      cx.beginPath();cx.moveTo(x,TOP+40);cx.lineTo(x,WY);cx.stroke();cx.setLineDash([]);
      const label=`${rv.name} · ${fmtM(rv.best)} м`,tw=cx.measureText(label).width+16,ly=WY-58-(i%2)*20;
      cx.fillStyle='rgba(8,30,22,.72)';cx.beginPath();cx.roundRect?cx.roundRect(x-tw/2,ly,tw,16,8):cx.rect(x-tw/2,ly,tw,16);cx.fill();
      cx.fillStyle='#fff';cx.fillText(label,x,ly+8);
    });
  }
  function drawBest(r){
    if(!(best>0))return;
    const x=best*UNIT-r.camX;if(x<-20||x>W+offX/sc+20)return;
    const passed=r.maxX/UNIT>best;
    cx.setLineDash([7,6]);cx.strokeStyle=passed?'rgba(255,210,63,.4)':'rgba(255,210,63,.95)';cx.lineWidth=1.6;
    cx.beginPath();cx.moveTo(x,0);cx.lineTo(x,WY);cx.stroke();cx.setLineDash([]);
    const label=passed?'Рекорд побит':`Твой рекорд · ${fmtM(best)} м`;
    cx.font='800 11px Nunito,"Segoe UI",sans-serif';cx.textBaseline='middle';
    const tw=cx.measureText(label).width+16,lx=x-tw/2,ly=WY-34;
    cx.fillStyle='rgba(8,30,22,.78)';cx.beginPath();cx.roundRect?cx.roundRect(lx,ly,tw,16,8):cx.rect(lx,ly,tw,16);cx.fill();
    cx.fillStyle='#ffd23f';cx.textAlign='center';cx.fillText(label,x,ly+8);
  }
  function render(){
    if(!run)return;const r=run;
    const z=zoneBlend(Math.max(0,r.camX/UNIT));
    cx.setTransform(dpr,0,0,dpr,0,0);
    const gr=cx.createLinearGradient(0,0,0,cssH);
    gr.addColorStop(0,mixc(z.a.top,z.b.top,z.t));gr.addColorStop(1,mixc(z.a.bot,z.b.bot,z.t));
    cx.fillStyle=gr;cx.fillRect(0,0,cssW,cssH);
    const camPx=r.camX*sc;
    drawMotes(z.a.mote,1-z.mt,camPx);if(z.mt>0)drawMotes(z.b.mote,z.mt,camPx);
    const shx=r.shake?rnd(-r.shake,r.shake):0,shy=r.shake?rnd(-r.shake,r.shake):0;
    cx.setTransform(dpr*sc,0,0,dpr*sc,(offX+shx*sc)*dpr,shy*sc*dpr);
    {const px=W*.4,py=VH*.5;cx.translate(px,py);cx.scale(r.zoom,r.zoom);cx.translate(-px,-py);}
    drawBack(r,z);
    // вода
    const L=-offX/sc-40,Rr=W+offX/sc+40;
    if(has('water')){
      const im=IMG.water,tw=170,th=tw*im.naturalHeight/im.naturalWidth,off=((r.camX+tGlobal*9)%tw+tw)%tw;
      cx.fillStyle='#234d5d';cx.fillRect(L,WY+th-10,Rr-L,VH-WY+60);
      for(let x=Math.floor((L+off)/tw)*tw-off;x<Rr;x+=tw)cx.drawImage(im,x,WY-8,tw+1,th);
    }else{cx.fillStyle='rgba(20,90,80,.9)';cx.fillRect(L,WY,Rr-L,VH-WY+40);}
    const cam=r.camX,vis=x=>x>cam+L-120&&x<cam+Rr+120;
    for(const p of r.pads)if(vis(p.x)){
      const y=WY+3+p.dip*.06+Math.sin(tGlobal*1.6+p.bob)*.8;
      if(has('pad'))blit('pad',p.x-cam,y,p.w+12,.5,.44);
      else{cx.fillStyle='#5cc27a';cx.beginPath();cx.ellipse(p.x-cam,y,p.w/2,10,0,0,7);cx.fill();}
      if(p.spring&&has('spring_low')){
        const up=p.springT<.45,k=p.springT<1?1+Math.sin(p.springT*Math.PI)*.12:1,im=IMG[up?'spring_high':'spring_low'],hgt=(up?46:34)*k,w=hgt*im.naturalWidth/im.naturalHeight;
        cx.drawImage(im,p.x-cam-w/2,y-4-hgt,w,hgt);
      }
    }
    for(const o of r.reeds)if(vis(o.x))drawReed(o,cam);
    drawRivals(r);drawBest(r);
    drawCeiling(r,z);
    for(const o of r.roots)if(vis(o.x))drawRoot(o,cam);
    for(const f of r.flies)if(!f.taken&&vis(f.x))drawFly(f,cam);
    for(const it of r.items)if(!it.taken&&vis(it.x))drawItem(it,cam);
    drawParts(r,false);
    r.aim=r.alive&&r.started?aimAt(r):null;
    drawAim(r);
    drawFrog(r);
    drawTongue(r);
    drawCoach(r);
    if(r.started&&r.hx>cam+L-90)drawHeron(r);
    // передний план — темнее и быстрее мира, даёт глубину
    layer(tFront,1.3,r.camX,VH+8,'#04140b',.92);
    drawParts(r,true);
    cx.setTransform(dpr,0,0,dpr,0,0);
    // цапля близко — край экрана краснеет
    if(r.alive&&r.heronWarn>0){
      const a=r.heronWarn*(.35+.15*Math.sin(tGlobal*10));
      const g=cx.createLinearGradient(offX,0,offX+cssW*.28,0);g.addColorStop(0,`rgba(224,64,95,${a})`);g.addColorStop(1,'rgba(224,64,95,0)');
      cx.fillStyle=g;cx.fillRect(0,0,cssW*.4,cssH);
    }
    if(offX>1){cx.fillStyle='rgba(0,0,0,.35)';cx.fillRect(0,0,offX,cssH);cx.fillRect(cssW-offX,0,offX,cssH);}
  }

  /* ---------- цикл ---------- */
  let fAcc=0,fN=0;
  function frame(ts){
    rafId=requestAnimationFrame(frame);
    const dt=Math.min(.05,last?(ts-last)/1000:0);last=ts;
    if(!run)return;
    if(dt>0){fAcc+=dt;fN++;if(fN>=45){const avg=fAcc/fN;fAcc=0;fN=0;if(quality&&avg>.028){quality=0;resize();}else if(!quality&&avg<.017){quality=1;resize();}}}
    if(!paused&&$('#fsOver').hidden){
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
  function startToken(){
    if(!hasApi())return Promise.resolve(null);
    return B.api('swingStart',{}).then(res=>res&&res.ok?res.run:null).catch(()=>null);
  }
  async function submit(r){
    const tok=await r.tokenP;if(!tok)return null;
    const ms=Math.round(performance.now()-(r.ms0||performance.now()));
    try{const res=await B.api('swingEnd',{run:tok,dist:dist(r),flies:r.flies_n,ms});if(res&&res.ok&&B.applySwing)B.applySwing(res);return res;}
    catch(e){return null;}
  }
  const CAUSE={water:'Плюх в воду',thorn:'Колючки!',root:'Врезалась в корень',reed:'Запуталась в камышах',heron:'Цапля догнала'};
  async function gameOver(){
    const r=run,m=dist(r);
    const isBest=m>(pref.best||0);
    if(isBest)pref.best=m;
    pref.flies=(pref.flies||0)+r.flies_n;savePref();
    $('#fsOverT').textContent=CAUSE[r.cause]||'Забег окончен';
    $('#fsOverH').textContent=fmtM(m);
    $('#fsOverF').textContent=r.flies_n;
    $('#fsNewRec').hidden=!(m>bestBefore&&bestBefore>0);   // первый забег рекордом не считаем
    $('#fsOverBest').textContent=`Рекорд: ${fmtM(Math.max(bestBefore,m))} м`;
    $('#fsStats').innerHTML=`<div><span>Зацепов</span><b>${r.sticks}</b></div><div><span>Идеальных отпусканий</span><b>${r.perfects}</b></div><div><span>Лучшая серия мошек</span><b>×${r.comboMax}</b></div><div><span>Отскоков</span><b>${r.bounces}</b></div>`;
    // ближе к рекорду — сильнее хочется ещё раз
    const left=bestBefore-m;
    $('#fsOverNote').textContent=left>0&&left<=Math.max(30,bestBefore*.2)?`До рекорда всего ${fmtM(left)} м!`:r.cause==='heron'?'Не раскачивайся на месте — цапля летит следом':r.cause==='water'?'Отпускай, когда лягушка летит вверх-вперёд':'';
    $('#fsOver').hidden=false;
    if(m>bestBefore&&bestBefore>0)B.haptic.success();
    const res=await submit(r);
    if(run!==r)return;
    if(res&&res.ok){
      $('#fsOverF').textContent=res.earned;
      const b=Math.max(res.prevBest||0,res.dist||0);
      $('#fsOverBest').textContent=`Рекорд: ${fmtM(b)} м`+(res.rank?` · место ${res.rank}`:'');
      if(res.isRecord)$('#fsOverNote').textContent='Это лучший результат в игре!';
    }
  }

  /* ---------- пауза ---------- */
  function sndLabel(){$('#fsSnd').innerHTML=`<svg class="ic"><use href="#i-sound-${B.soundOn()?'on':'off'}"></use></svg> Звук`;}
  function pause(){
    if(!run||!run.alive||paused)return;
    paused=true;ptrs.clear();if(holding){holding=false;letGo();}sndLabel();$('#fsPauseOv').hidden=false;
  }
  function resume(){paused=false;last=0;$('#fsPauseOv').hidden=true;SND.ui();}
  $('#fsPause').onclick=()=>{SND.ui();pause();};
  $('#fsResume').onclick=resume;
  $('#fsSnd').onclick=()=>{B.setSound(!B.soundOn());sndLabel();SND.ui();};
  $('#fsQuit').onclick=()=>{
    const r=run;paused=false;$('#fsPauseOv').hidden=true;
    if(r&&r.alive&&r.started){r.alive=false;r.over=true;submit(r);}
    close();
  };
  $('#fsAgain').onclick=()=>{SND.ui();start();};
  $('#fsExit').onclick=()=>{SND.ui();close();};
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&open)pause();});
  function onBack(){
    if(!$('#fsOver').hidden){close();return;}
    if(paused){$('#fsQuit').onclick();return;}
    pause();
  }

  /* ---------- открыть / закрыть ---------- */
  function start(seed){
    $('#fsOver').hidden=true;$('#fsPauseOv').hidden=true;paused=false;
    const sw=(B.net().swing)||{};
    bestBefore=Math.max(pref.best||0,sw.best||0);best=bestBefore;
    run=newRun(seed||Math.floor(Math.random()*2**31));
    const r=run;
    // соперники — вертикальные линии на их рекордах; показываем тех, кто рядом
    const me=(B.net().me||{}).id;
    rivals=((B.net().swingTop)||[]).filter(x=>x.id!==me&&x.best>0).sort((a,b)=>a.best-b.best).slice(0,12);
    // первые три забега подсказываем момент отпускания
    r.coach=(pref.coach||0)<3;pref.coach=(pref.coach||0)+1;savePref();
    gen(r);
    // старт: висим на языке под первым участком
    const s=r.segs[0];
    r.L=Math.min(200,WY-s.y-150);
    r.tongue={st:'hold',x:110,y:s.y,ok:true,len:r.L,t:0};
    r.x=110;r.y=s.y+r.L;r.camX=r.x-W*.33;
    r.tokenP=startToken();
    hudH(0);elFN.textContent='0';holding=false;ptrs.clear();acc=0;last=0;
    const h=$('#fsHint');
    if((pref.hinted||0)<3){pref.hinted=(pref.hinted||0)+1;savePref();hintOn=true;hintT=0;h.hidden=false;h.classList.remove('off');
      $('#fsHintT').textContent='Держи — язык держит, отпусти — летишь';}
    else h.hidden=true;
  }
  async function openGame(){
    if(open)return;
    loadImgs();
    try{await loadFrog((B.net().jump||{}).skin);}catch(e){B.toast('Не удалось загрузить лягушку');return;}
    open=true;root.hidden=false;B.setActive(true);
    resize();start();
    last=0;cancelAnimationFrame(rafId);rafId=requestAnimationFrame(frame);
    try{if(B.TG&&B.tgv('6.1')){B.TG.BackButton.onClick(onBack);B.TG.BackButton.show();}}catch(e){}
  }
  function close(){
    if(!open)return;
    open=false;root.hidden=true;cancelAnimationFrame(rafId);
    run=null;paused=false;holding=false;ptrs.clear();
    try{if(B.TG&&B.tgv('6.1')){B.TG.BackButton.offClick(onBack);B.TG.BackButton.hide();}}catch(e){}
    B.setActive(false);B.onClose();
  }
  // вне Telegram — ручки для проверки физики без кадров
  if(!B.inTG)window.__fs={get run(){return run;},start,close,pause,resume,pref,press:()=>{holding=true;press();},release:()=>{holding=false;letGo();},
    aim:()=>run&&aimAt(run),sim:(sec,onStep)=>{const n=Math.round(sec*120);for(let i=0;i<n&&run;i++){update(STEP);if(onStep)onStep(run,i);}return run;},render,
    consts:{G,MAXL,GAPMAX,UNIT},get WY(){return WY;}};
  return {open:openGame,close,preload:()=>{loadImgs();return loadFrog((B.net().jump||{}).skin).catch(()=>{});},localBest:()=>pref.best||0};
};
})();
