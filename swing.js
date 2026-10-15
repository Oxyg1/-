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
  const G=1500, STEP=1/120, FROG=58, R=19;
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
  };

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
    const safe=parseFloat(getComputedStyle(root).getPropertyValue('--tg-safe-area-inset-top'))||0;
    TOP=(safe+64)/sc;
  }
  window.addEventListener('resize',()=>{if(open)resize();});

  /* ---------- картинки (общие с Frog Jump) ---------- */
  const IMG_SRC={pad:'jump/pad.png',water:'jump/water.png',cloud_1:'jump/cloud_1.png',cloud_2:'jump/cloud_2.png',cloud_3:'jump/cloud_3.png'};
  const IMG={};
  function loadImgs(){for(const k in IMG_SRC){if(IMG[k])continue;const im=new Image();im.decoding='async';im.onload=()=>{im.ok=true;};im.src=IMG_SRC[k];IMG[k]=im;}}
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
      flies_n:0,maxX:0,mile:100,zone:0,bestCrossed:false,
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
      if(r.genX<700){seg(r,r.genX,r.genX+700,y,'w');r.genX+=700;continue;}
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
      // мошки по дуге под участком
      const nf=1+Math.floor(R0()*3);
      for(let i=0;i<nf;i++){const fx=x0+len*(.2+.6*i/Math.max(1,nf-1||1)),fy=y+lerp(180,260,R0());
        if(!blocked(r,fx,fy,30))r.flies.push({x:fx,y:fy,t:R0()*6,gold:R0()<.05});}
      r.genX=x0+len;
      // дыра
      if(R0()<.3+.45*d){
        const g=Math.min(GAPMAX,lerp(110,200,d)+R0()*lerp(60,130,d));
        if(R0()<lerp(.65,.25,d))r.pads.push({x:r.genX+g*(.35+R0()*.3),w:84,dip:0,dipV:0,bob:R0()*6});
        // в дыре висит мошка — награда за риск
        if(R0()<.55)r.flies.push({x:r.genX+g/2,y:y+lerp(60,140,R0()),t:R0()*6,gold:R0()<.12});
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
    if(!r.started){r.started=true;r.ms0=performance.now();r.hx=r.camX-650;return;}   // первый забег начинается висящим
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
        sparks(r.x,r.y,8,'#ffe680');
      }else{r.perfN=0;SND.release();}
      r.lastRel=r.t;
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

  /* ---------- шаг физики ---------- */
  function update(dt){
    const r=run;r.t+=dt;tGlobal+=dt;
    if(r.shake>0)r.shake=Math.max(0,r.shake-dt*30);
    for(const p of r.pads){p.dipV+=(-p.dip*160-p.dipV*10)*dt;p.dip+=p.dipV*dt;}
    for(const f of r.flies)f.t+=dt;
    for(let i=r.parts.length-1;i>=0;i--){const p=r.parts[i];p.t+=dt;if(p.t>=p.life){r.parts.splice(i,1);continue;}p.vy+=(p.g||0)*dt;p.x+=(p.vx||0)*dt;p.y+=(p.vy||0)*dt;}
    if(hintT>0){hintT-=dt;if(hintT<=0){hintOn=false;$('#fsHint').classList.add('off');}}

    if(!r.alive){
      r.dyingT+=dt;
      if(r.cause!=='water'){r.vy+=G*dt;r.y=Math.min(r.y+r.vy*dt,WY+40);r.x+=r.vx*dt;r.vx*=.98;r.rot+=dt*5;}
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
            SND.stick(r.sticks%11);B.haptic.select();bark(tg.x,tg.y);
          }else{tg.st='back';tg.len=d;if(!tg.ok)SND.miss();}
        }
      }else if(tg.st==='back'){tg.len-=TSPD*1.4*dt;if(tg.len<=0)r.tongue=null;}
    }
    // зажал и опоры раньше не было — язык цепляется сам, как только появится
    if(holding&&r.started&&!r.tongue){const a=aimAt(r);if(a.ok)fire(r);}

    if(r.started){
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

    // потолок: лбом в дерево — сползаем вниз; в колючки — конец
    for(const ox of [-R*.7,0,R*.7]){
      const s=segAt(r,r.x+ox);
      if(s&&r.y-R<s.y){
        if(s.k==='t'){die('thorn');return;}
        if(r.y-R<s.y-14&&ox!==0){ // въехали в торец более низкого участка
          r.x-=Math.sign(ox)*2;r.vx=-r.vx*.3;
        }
        r.y=s.y+R;if(r.vy<0)r.vy=0;
      }
    }
    if(r.y<-80){r.y=-80;if(r.vy<0)r.vy=0;}
    // корни и камыши
    for(const o of r.roots){if(Math.abs(r.x-o.x)<o.w/2+R*.8&&r.y>o.y0&&r.y-R*.6<o.y1){die('root');return;}}
    for(const o of r.reeds){if(Math.abs(r.x-o.x)<o.w/2+R*.7&&r.y+R*.7>o.top+6){die('reed');return;}}
    // вода и кувшинки
    if(r.y+R*.6>WY&&r.vy>0){
      const p=r.pads.find(p=>Math.abs(p.x-r.x)<p.w/2+8);
      if(p){
        r.y=WY-R*.6;r.vy=-Math.max(820,r.vy*.6);r.vx=Math.max(r.vx,320);p.dipV=260;r.bounces++;
        if(r.tongue&&r.tongue.st!=='back')r.tongue.st='back';
        SND.bounce();B.haptic.light();splash(r.x,WY,6);txt(r.x,r.y-40,'Пружинит!',{c:'#9dffb0',s:16});
      }else{r.y=WY;die('water');splash(r.x,WY,16);SND.splash();return;}
    }
    // мошки ловим телом и прилипшим языком
    for(const f of r.flies){
      if(f.taken)continue;
      const fy=f.y+Math.sin(f.t*4.3)*4;
      if(Math.hypot(f.x-r.x,fy-r.y)<R+16){
        f.taken=true;const n=f.gold?5:1;r.flies_n+=n;elFN.textContent=r.flies_n;kick(elFl,'bump');
        SND.gulp(r.flies_n%15);sparks(f.x,fy,f.gold?10:5,f.gold?'#ffd23f':'#dff2ff');if(f.gold)txt(f.x,fy-20,'+5',{c:'#ffd23f'});
      }
    }
    // цапля сзади: не даёт стоять. Держится сразу за краем экрана и подлетает,
    // если лягушка медлит
    if(r.started){
      const m=r.x/UNIT,hv=lerp(150,340,clamp(m/2500,0,1));
      r.hx=Math.max(r.hx+hv*dt,r.camX-300);
      r.hy+=(r.y-r.hy)*Math.min(1,dt*2);
      const gap=r.x-r.hx;
      r.heronWarn=clamp(1-(gap-80)/320,0,1);
      if(!r.heronOn&&r.hx>r.camX-60){r.heronOn=true;SND.heron();}
      if(r.hx<r.camX-120)r.heronOn=false;
      if(gap<34){die('heron');return;}
    }
    // камера: лягушка на трети экрана, чуть впереди — куда летим
    const cam=r.x-W*.33+clamp(r.vx*.08,-20,50);
    r.camX+=(cam-r.camX)*Math.min(1,dt*4);
    if(r.x>r.maxX){
      r.maxX=r.x;const m=dist(r);hudH(m);
      if(m>=r.mile){r.mile+=100;SND.mile();kick(elHB,'pulse');}
      let zi=0;for(let i=0;i<ZONES.length;i++)if(m>=ZONES[i].m)zi=i;
      if(zi>r.zone){r.zone=zi;SND.zone();banner(ZONES[zi].name,`${fmtM(m)} м`);}
      if(!r.bestCrossed&&bestBefore>0&&m>bestBefore){r.bestCrossed=true;SND.record();banner('Новый рекорд!','',true);B.haptic.success();}
    }
    gen(r);
  }
  function die(cause){
    const r=run;if(!r.alive)return;
    r.alive=false;r.cause=cause;r.dyingT=0;holding=false;ptrs.clear();
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
  // дальний лес у воды: два слоя силуэтов с параллаксом
  function drawHills(r,z){
    const L=-offX/sc,Rr=W+offX/sc;
    const layers=[{k:.18,h:.22,c:'rgba(0,0,0,.16)',f:.011},{k:.4,h:.14,c:'rgba(0,0,0,.2)',f:.019}];
    for(const ly of layers){
      cx.fillStyle=ly.c;cx.beginPath();cx.moveTo(L,WY);
      for(let x=L;x<=Rr+8;x+=8){const wx=x+r.camX*ly.k;const h=VH*ly.h*(.55+.25*Math.sin(wx*ly.f)+.2*Math.sin(wx*ly.f*2.7+1));cx.lineTo(x,WY-h);}
      cx.lineTo(Rr,WY);cx.closePath();cx.fill();
    }
  }
  function canopyCol(z){return z.a===ZONES[3]||z.b===ZONES[3]&&z.t>.5?['#0e2a24','#163b30','#1f5240']:['#164a2c','#1f6a3a','#2c8a49'];}
  function drawCeiling(r,z){
    const cam=r.camX,[c0,c1,c2]=canopyCol(z);
    const L=cam-offX/sc-40,Rr=cam+W+offX/sc+40;
    // свет из дыр — тёплые лучи вниз
    for(let i=0;i<r.segs.length-1;i++){
      const a=r.segs[i],b=r.segs[i+1];if(b.x0-a.x1<20||a.x1>Rr||b.x0<L)continue;
      const x0=a.x1-cam,x1=b.x0-cam,yt=Math.min(a.y,b.y);
      const g=cx.createLinearGradient(0,yt,0,WY);g.addColorStop(0,'rgba(255,240,180,.22)');g.addColorStop(1,'rgba(255,240,180,0)');
      cx.fillStyle=g;cx.beginPath();cx.moveTo(x0,yt-20);cx.lineTo(x1,yt-20);cx.lineTo(x1+60,WY);cx.lineTo(x0+30,WY);cx.closePath();cx.fill();
    }
    for(const s of r.segs){
      if(s.x1<L||s.x0>Rr)continue;
      const x0=s.x0-cam,x1=s.x1-cam,y=s.y;
      // крона: тёмная масса сверху
      const g=cx.createLinearGradient(0,-40,0,y);g.addColorStop(0,c0);g.addColorStop(1,c1);
      cx.fillStyle=g;cx.fillRect(x0,-60,x1-x0,y+50);
      // нижняя кромка: листья-полукруги, у колючек — шипы
      if(s.k==='w'){
        cx.fillStyle='#6b4a2a';cx.fillRect(x0,y-12,x1-x0,12);         // кора, за неё цепляемся
        cx.fillStyle='#8a6238';cx.fillRect(x0,y-12,x1-x0,3);
        cx.fillStyle='#4e3420';cx.fillRect(x0,y-2,x1-x0,2);
        cx.fillStyle=c2;
        for(let x=Math.ceil(s.x0/26)*26;x<s.x1;x+=26){
          const h=((x*7.3)%11);cx.beginPath();cx.ellipse(x-cam,y-12,15,6+h*.4,0,Math.PI,0,true);cx.fill();
        }
        // свисающий мох — просто украшение
        cx.strokeStyle='rgba(120,200,110,.55)';cx.lineWidth=2;cx.lineCap='round';
        for(let x=Math.ceil(s.x0/57)*57+20;x<s.x1-10;x+=57){
          const l=10+((x*13)%18),sw=Math.sin(tGlobal*1.4+x)*2;
          cx.beginPath();cx.moveTo(x-cam,y);cx.quadraticCurveTo(x-cam+sw,y+l*.6,x-cam+sw*1.4,y+l);cx.stroke();
        }
      }else{
        cx.fillStyle='#4a2140';cx.fillRect(x0,y-14,x1-x0,14);
        cx.fillStyle='#e0405f';
        for(let x=x0+4;x<x1-4;x+=11){cx.beginPath();cx.moveTo(x,y-1);cx.lineTo(x+5.5,y+11+Math.sin(x)*2);cx.lineTo(x+11,y-1);cx.closePath();cx.fill();}
        cx.fillStyle='#ff8fa3';
        for(let x=x0+4;x<x1-4;x+=11){cx.beginPath();cx.moveTo(x+3,y);cx.lineTo(x+5.5,y+7);cx.lineTo(x+6.5,y);cx.closePath();cx.fill();}
      }
    }
    // края дыр — пышные кусты листвы, чтобы обрыв не был рубленым
    for(let i=0;i<r.segs.length;i++){
      const s=r.segs[i],n=r.segs[i+1],p=r.segs[i-1];
      if(s.x1<L||s.x0>Rr)continue;
      if(!n||n.x0-s.x1>2)bush(s.x1-cam,s.y,c1,c2,1);
      if(!p||s.x0-p.x1>2)bush(s.x0-cam,s.y,c1,c2,-1);
    }
  }
  function bush(x,y,c1,c2,side){
    cx.fillStyle=c1;cx.beginPath();cx.arc(x,y-30,24,0,7);cx.arc(x+side*6,y-60,20,0,7);cx.arc(x,y-4,14,0,7);cx.fill();
    cx.fillStyle=c2;cx.beginPath();cx.arc(x+side*4,y-12,10,0,7);cx.arc(x+side*8,y-38,9,0,7);cx.fill();
  }
  function drawRoot(o,cam){
    const x=o.x-cam,sw=Math.sin(tGlobal*1.1+o.ph)*2;
    cx.fillStyle='#5a3b22';cx.beginPath();
    cx.moveTo(x-o.w/2-3,o.y0);cx.quadraticCurveTo(x-o.w/2+sw,(o.y0+o.y1)/2,x-3+sw,o.y1);
    cx.quadraticCurveTo(x+sw,o.y1+10,x+3+sw,o.y1);cx.quadraticCurveTo(x+o.w/2+sw,(o.y0+o.y1)/2,x+o.w/2+3,o.y0);cx.closePath();cx.fill();
    cx.strokeStyle='#3e2816';cx.lineWidth=2;cx.beginPath();cx.moveTo(x-2,o.y0+6);cx.quadraticCurveTo(x+sw*.5,(o.y0+o.y1)/2,x-1+sw,o.y1-8);cx.stroke();
    cx.strokeStyle='#6f4c2d';cx.lineWidth=3;cx.lineCap='round';
    for(let k=1;k<=2;k++){const yy=lerp(o.y0,o.y1,k/3.2),s=k%2?-1:1;cx.beginPath();cx.moveTo(x+sw*.5,yy);cx.quadraticCurveTo(x+s*12,yy+4,x+s*16,yy+14);cx.stroke();}
    cx.fillStyle='rgba(120,200,110,.8)';cx.beginPath();cx.ellipse(x+sw,o.y0+16,10,5,.4,0,7);cx.fill();
  }
  function drawReed(o,cam){
    const x=o.x-cam;
    for(let i=-1;i<=1;i++){
      const sx=x+i*6,sw=Math.sin(tGlobal*1.3+o.ph+i)*3,top=o.top+Math.abs(i)*14;
      cx.strokeStyle=i?'#3e8a3a':'#4fa246';cx.lineWidth=4;cx.lineCap='round';
      cx.beginPath();cx.moveTo(sx,WY+4);cx.quadraticCurveTo(sx,top+(WY-top)*.4,sx+sw,top+12);cx.stroke();
      if(!i){cx.fillStyle='#7a4a24';cx.beginPath();cx.ellipse(sx+sw,top+4,5.5,15,0,0,7);cx.fill();cx.strokeStyle='#4fa246';cx.lineWidth=2;cx.beginPath();cx.moveTo(sx+sw,top-10);cx.lineTo(sx+sw,top-18);cx.stroke();}
    }
    cx.fillStyle='#4fa246';cx.beginPath();cx.moveTo(x-4,WY);cx.quadraticCurveTo(x-24,WY-50,x-30,WY-70);cx.quadraticCurveTo(x-14,WY-40,x+2,WY);cx.fill();
  }
  function drawFly(f,cam){
    const x=f.x-cam+Math.sin(f.t*3.1)*5,y=f.y+Math.sin(f.t*4.3)*4;
    const flap=Math.abs(Math.sin(f.t*38));
    if(f.gold){cx.fillStyle='rgba(255,210,63,.25)';cx.beginPath();cx.arc(x,y,16,0,7);cx.fill();}
    cx.fillStyle='rgba(223,242,255,.85)';
    cx.beginPath();cx.ellipse(x-6,y-.5,7,2.4*flap+.7,-.95,0,7);cx.fill();
    cx.beginPath();cx.ellipse(x+6,y-.5,7,2.4*flap+.7,.95,0,7);cx.fill();
    cx.fillStyle=f.gold?'#f5b400':'#333a45';
    cx.beginPath();cx.ellipse(x,y+2.6,3.4,4.6,0,0,7);cx.fill();
    cx.beginPath();cx.ellipse(x,y-2,3,2.7,0,0,7);cx.fill();
    cx.fillStyle=f.gold?'#ffd97a':'#414b5c';cx.beginPath();cx.arc(x,y-5.6,2.5,0,7);cx.fill();
    cx.fillStyle=f.gold?'#ffe680':'#e0405f';cx.beginPath();cx.arc(x-1.5,y-6.2,1.2,0,7);cx.arc(x+1.5,y-6.2,1.2,0,7);cx.fill();
  }
  function drawHeron(r){
    const x=r.hx-r.camX,y=r.hy-10,fl=Math.sin(tGlobal*9);
    cx.save();cx.translate(x,y);
    // крылья
    cx.fillStyle='#aab6c1';
    cx.beginPath();cx.moveTo(-6,-4);cx.quadraticCurveTo(-30,-30*fl-6,-58,-36*fl-4);cx.quadraticCurveTo(-30,-6,-6,6);cx.fill();
    cx.fillStyle='#dfe6ec';cx.beginPath();cx.ellipse(0,0,26,12,-.08,0,7);cx.fill();
    cx.fillStyle='#c9d3dc';
    cx.beginPath();cx.moveTo(4,-2);cx.quadraticCurveTo(-20,-24*fl,-44,-30*fl+4);cx.quadraticCurveTo(-18,-2,4,8);cx.fill();
    // шея и голова вперёд
    cx.strokeStyle='#dfe6ec';cx.lineWidth=7;cx.lineCap='round';cx.beginPath();cx.moveTo(18,-4);cx.quadraticCurveTo(30,-18,40,-12);cx.stroke();
    cx.fillStyle='#dfe6ec';cx.beginPath();cx.arc(42,-12,7,0,7);cx.fill();
    cx.fillStyle='#e7a35a';cx.beginPath();cx.moveTo(47,-15);cx.lineTo(72,-10);cx.lineTo(47,-8);cx.fill();
    cx.fillStyle='#1b2a22';cx.beginPath();cx.arc(44,-14,1.8,0,7);cx.fill();
    cx.fillStyle='#39434d';cx.beginPath();cx.moveTo(38,-17);cx.lineTo(28,-22);cx.lineTo(38,-14);cx.fill();
    cx.strokeStyle='#e7a35a';cx.lineWidth=2.5;cx.beginPath();cx.moveTo(-22,4);cx.lineTo(-44,10);cx.moveTo(-22,7);cx.lineTo(-44,14);cx.stroke();
    cx.restore();
  }
  function drawTongue(r){
    const tg=r.tongue;if(!tg)return;
    const m=mouth(r),dx=tg.x-m.x,dy=tg.y-m.y,d=Math.hypot(dx,dy)||1;
    const l=tg.st==='hold'?d:Math.min(d,Math.max(0,tg.len));
    const tx=m.x+dx/d*l,ty=m.y+dy/d*l,cam=r.camX;
    cx.lineCap='round';
    cx.strokeStyle='#c43d63';cx.lineWidth=6.5;cx.beginPath();cx.moveTo(m.x-cam,m.y);cx.lineTo(tx-cam,ty);cx.stroke();
    cx.strokeStyle='#ff6f8e';cx.lineWidth=4;cx.beginPath();cx.moveTo(m.x-cam,m.y);cx.lineTo(tx-cam,ty);cx.stroke();
    cx.strokeStyle='rgba(255,200,215,.7)';cx.lineWidth=1.3;cx.beginPath();cx.moveTo(m.x-cam-1,m.y);cx.lineTo(tx-cam-1,ty);cx.stroke();
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
  function drawFrog(r){
    const x=r.x-r.camX,y=r.y;
    const sp=Math.hypot(r.vx,r.vy),st=r.alive&&!(r.tongue&&r.tongue.st==='hold')?clamp(sp/1400,0,.12):0;
    cx.save();cx.translate(x,y);cx.rotate(r.rot);cx.scale(1-st*.5,1+st);
    if(frogImg)cx.drawImage(frogImg,-FROG/2,-FROG*.55,FROG,FROG);
    else{cx.fillStyle='#5cc27a';cx.beginPath();cx.ellipse(0,0,FROG*.4,FROG*.3,0,0,7);cx.fill();}
    cx.restore();
  }
  function drawParts(r,front){
    const cam=r.camX;
    for(const p of r.parts){
      const isTxt=p.k==='txt';if(isTxt!==front)continue;
      const a=1-p.t/p.life,x=p.x-cam,y=p.y;
      if(p.k==='drop'){cx.fillStyle=p.c;cx.globalAlpha=a;cx.beginPath();cx.arc(x,y,p.s,0,7);cx.fill();}
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
    drawHills(r,z);
    // вода
    const L=-offX/sc,Rr=W+offX/sc;
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
    }
    for(const o of r.reeds)if(vis(o.x))drawReed(o,cam);
    drawBest(r);
    drawCeiling(r,z);
    for(const o of r.roots)if(vis(o.x))drawRoot(o,cam);
    for(const f of r.flies)if(!f.taken&&vis(f.x))drawFly(f,cam);
    drawParts(r,false);
    r.aim=r.alive&&r.started?aimAt(r):null;
    drawAim(r);
    drawFrog(r);
    drawTongue(r);
    if(r.started&&r.hx>cam+L-90)drawHeron(r);
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
      acc+=dt;let n=0;
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
    $('#fsStats').innerHTML=`<div><span>Зацепов</span><b>${r.sticks}</b></div><div><span>Идеальных отпусканий</span><b>${r.perfects}</b></div>`;
    $('#fsOverNote').textContent=r.cause==='heron'?'Не раскачивайся на месте — цапля летит следом':r.cause==='water'?'Отпускай, когда лягушка летит вверх-вперёд':'';
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
