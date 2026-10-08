/* Flappy Frog — вторая мини-игра хаба SWAMP.

   Лягушка летит над болотом между зарослями камыша: тап — взмах вверх,
   отпустил — плавно снижается. Как и Frog Jump, ничего не видит в основной
   игре сама: получает узкий «мост» B (звук, стикер наряда, сервер, покупка).

   На чём держится ощущение:
   • взмах всегда одинаковый — скорость вверх задаётся, а не прибавляется;
   • лягушка наклоняется носом по скорости, сплющивается на взмахе;
   • первое касание воды прощается: лягушка отскакивает от кувшинки;
   • мошки висят в проходах, язык ловит их сам — та же валюта, что в Frog Jump;
   • каждые 25 очков меняется время суток, сложность растёт до ~100 очков
     и дальше не растёт: бесконечный рост превращает игру в лотерею. */
(function(){
'use strict';
window.FlappyFrogInit=function(B){
  delete window.FlappyFrogInit;

  /* ---------- мир ---------- */
  const W=360;                    // ширина поля в мировых единицах
  const G=1650, FLAP=-520;        // гравитация и скорость взмаха (вниз — плюс)
  const FROG=54, HIT=17;          // размер лягушки и радиус столкновения
  const RW=66, SPACING=232;       // ширина зарослей и шаг между проходами
  const STEP=1/120;
  const REVIVE_PRICES=[10,25];
  const ZONES=[
    {s:0,  top:'#7cc9e8',bot:'#2f8a5e',far:'#2e7a52',mid:'#1f5e3e',water:'#2f7f86',name:'Утро на болоте'},
    {s:25, top:'#f6b27a',bot:'#8e3f3a',far:'#7a3d38',mid:'#4f2a2c',water:'#6a4a63',name:'Закат'},
    {s:50, top:'#23265e',bot:'#0b1238',far:'#1a1f4a',mid:'#10142f',water:'#1d2c55',name:'Ночь'},
    {s:75, top:'#9fd6f5',bot:'#4a86cf',far:'#3a6fa8',mid:'#2b5687',water:'#2f6aa0',name:'Рассвет'},
  ];

  const rnd=(a,b)=>a+Math.random()*(b-a);
  const lerp=(a,b,t)=>a+(b-a)*t;
  const clamp=(v,a,b)=>v<a?a:v>b?b:v;
  const hex=h=>[parseInt(h.slice(1,3),16),parseInt(h.slice(3,5),16),parseInt(h.slice(5,7),16)];
  const mixc=(a,b,t)=>{const x=hex(a),y=hex(b);return `rgb(${x.map((v,i)=>Math.round(v+(y[i]-v)*t)).join(',')})`;};
  const fmt=n=>String(Math.floor(n)).replace(/\B(?=(\d{3})+(?!\d))/g,' ');
  const pts=n=>{const x=n%10,y=n%100;return x===1&&y!==11?'очко':x>=2&&x<=4&&(y<12||y>14)?'очка':'очков';};
  const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  /* ---------- звук ---------- */
  const X=B.sfx, V=X.voice, TH=X.thud, N=X.note;
  const SND={
    flap:()=>V(330*(1+rnd(-.04,.04)),.08,.035,0,{glide:1.5}),
    score:k=>{V(N(k%10,1),.12,.04,0,{reward:true});if(k%10===0)V(N(k%10+4,1),.18,.03,.06,{reward:true});},
    gulp:()=>V(N(7,0),.07,.04,0,{glide:.6}),
    gold:()=>{V(N(4,1),.14,.05,0,{reward:true});V(N(9,1),.2,.04,.07,{reward:true});},
    bounce:()=>{V(180,.3,.06,0,{glide:3});TH(.07,0,110);},
    hit:()=>{TH(.16,0,80);V(150,.25,.05,.02,{glide:.4});},
    zone:()=>[0,4,7].forEach((d,i)=>V(N(d,1),.3,.04,i*.08,{reward:true})),
    ui:()=>V(640,.04,.03),
    record:()=>[0,2,4,7,9].forEach((d,i)=>V(N(d,1),.45,.06,i*.07,{reward:true})),
  };

  /* ---------- стили: те же, что у Frog Jump, со своим префиксом ---------- */
  const st=document.createElement('style');
  st.textContent=`
#ff{position:fixed;inset:0;z-index:180;background:#0c3a2a;touch-action:none;user-select:none;-webkit-user-select:none;overflow:hidden;font-family:Nunito,system-ui,sans-serif;color:#fff}
#ff canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
#ff .ff-top{position:absolute;left:0;right:0;top:0;padding:calc(var(--tg-safe-area-inset-top,env(safe-area-inset-top,0px)) + var(--tg-content-safe-area-inset-top,0px) + 10px) 12px 0;display:flex;align-items:flex-start;justify-content:space-between;pointer-events:none}
#ff .ff-ib{pointer-events:auto;width:40px;height:40px;border:0;border-radius:13px;background:rgba(6,26,18,.55);display:flex;align-items:center;justify-content:center;color:#fff;padding:0}
#ff .ff-ib svg{width:20px;height:20px}
#ff .ff-sc{font-size:54px;font-weight:900;line-height:1;text-shadow:0 4px 0 rgba(0,0,0,.28);font-variant-numeric:tabular-nums;transition:transform .12s}
#ff .ff-sc.kick{animation:ffBump .22s}
#ff .ff-mid{display:flex;flex-direction:column;align-items:center;gap:6px}
#ff .ff-lily{display:flex;align-items:center;gap:4px;background:rgba(6,26,18,.55);border-radius:999px;padding:2px 10px 2px 4px;font-size:12px;font-weight:800;transition:opacity .3s}
#ff .ff-lily img{width:22px;height:22px;object-fit:contain}
#ff .ff-lily.off{opacity:.35}
#ff .ff-fl{display:flex;align-items:center;gap:4px;background:rgba(6,26,18,.55);border-radius:999px;padding:5px 12px 5px 8px;font-size:17px;font-weight:900;font-variant-numeric:tabular-nums}
#ff .ff-fl svg{width:22px;height:22px}
#ff .ff-fl.bump{animation:ffBump .25s}
@keyframes ffBump{40%{transform:scale(1.18)}}
#ff .ff-tap{position:absolute;left:50%;top:62%;transform:translateX(-50%);background:rgba(8,30,22,.8);border-radius:999px;padding:8px 18px;font-size:16px;font-weight:900;white-space:nowrap;pointer-events:none;animation:ffPulse 1.2s ease-in-out infinite}
@keyframes ffPulse{50%{transform:translateX(-50%) scale(1.06)}}
#ff .ff-banner{position:absolute;left:50%;top:30%;transform:translate(-50%,-50%) scale(.4);opacity:0;background:rgba(8,30,22,.78);border-radius:18px;padding:10px 18px;font-size:21px;font-weight:900;text-align:center;white-space:nowrap;pointer-events:none;box-shadow:0 10px 30px rgba(0,0,0,.35)}
#ff .ff-banner small{display:block;font-size:13px;font-weight:800;opacity:.8;margin-top:2px}
#ff .ff-banner.gold{background:linear-gradient(#ffe36b,#f7b500);color:#5a3b00}
#ff .ff-banner.on{animation:ffBanner 1.6s cubic-bezier(.2,.9,.3,1.3) forwards}
@keyframes ffBanner{0%{opacity:0;transform:translate(-50%,-50%) scale(.4)}14%{opacity:1;transform:translate(-50%,-50%) scale(1.08)}22%{transform:translate(-50%,-50%) scale(1)}80%{opacity:1}100%{opacity:0;transform:translate(-50%,-80%) scale(.92)}}
#ff .ff-ov{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(3,25,17,.72);z-index:10}
#ff .ff-ov .card{max-width:360px}
#ff .card .btn{width:100%}
#ff .card .row .btn{width:auto;flex:1}
#ff .ff-big{font-size:62px;font-weight:900;line-height:1;color:#ffd23f;text-shadow:0 4px 0 rgba(0,0,0,.3);font-variant-numeric:tabular-nums}
#ff .ff-newrec{background:linear-gradient(#ffe36b,#f7b500);color:#5a3b00;border-radius:999px;padding:4px 14px;font-size:14px;font-weight:900;box-shadow:0 3px 0 #a86f00}
#ff .ff-earn{display:flex;align-items:center;justify-content:center;gap:8px;font-size:18px;font-weight:900;background:rgba(0,0,0,.22);border-radius:14px;padding:6px 14px}
#ff .ff-earn svg{width:28px;height:28px}
#ff .ff-note{font-size:13px;opacity:.75;text-align:center;line-height:1.3}
#ff .ff-th{width:100%;display:flex;flex-direction:column;align-items:flex-start;gap:2px;background:rgba(255,210,63,.16);box-shadow:inset 0 0 0 1.5px rgba(255,210,63,.55);border-radius:12px;padding:8px 12px;text-align:left}
#ff .ff-th b{font-size:15px;color:#ffd23f}
#ff .ff-th small{font-size:12px;opacity:.85}
#ff .ff-th.in{background:rgba(120,230,140,.16);box-shadow:inset 0 0 0 1.5px rgba(140,240,160,.6)}
#ff .ff-th.in b{color:#9dffb0}
`;
  document.head.appendChild(st);

  const FLY='<svg class="ic"><use href="#i-fly"></use></svg>';
  const root=document.createElement('div');root.id='ff';root.hidden=true;
  root.innerHTML=`
<canvas></canvas>
<div class="ff-top">
  <button class="ff-ib" id="ffPause" aria-label="Пауза"><svg><use href="#i-pause"></use></svg></button>
  <div class="ff-mid"><div class="ff-sc" id="ffSc">0</div><div class="ff-lily" id="ffLily"><img src="jump/pad.png" alt=""><span>отскок</span></div></div>
  <div class="ff-fl" id="ffFl">${FLY}<b id="ffFN">0</b></div>
</div>
<div class="ff-tap" id="ffTap">Тапни, чтобы взлететь</div>
<div class="ff-banner" id="ffBanner"></div>
<div class="ff-ov" id="ffPauseOv" hidden><div class="card">
  <h2>Пауза</h2>
  <button class="btn" id="ffResume">Продолжить</button>
  <div class="row"><button class="btn ghost sm" id="ffSnd"></button><button class="btn ghost sm" id="ffQuit">Выйти</button></div>
</div></div>
<div class="ff-ov" id="ffOver" hidden><div class="card">
  <div class="ff-newrec" id="ffNewRec" hidden>Новый рекорд!</div>
  <h2 id="ffOverT">Полёт окончен</h2>
  <div class="ff-big" id="ffOverS">0</div>
  <div class="sub" id="ffOverBest"></div>
  <div class="ff-earn">${FLY}<span>+<b id="ffOverF">0</b></span></div>
  <div class="ff-note" id="ffOverNote"></div>
  <div class="ff-th" id="ffTour" hidden></div>
  <button class="btn" id="ffRevive">Продолжить · 10 <img class="ic" src="icons/tgstar.png" alt=""></button>
  <button class="btn" id="ffAgain">Ещё раз</button>
  <div class="row"><button class="btn ghost sm" id="ffExit">В хаб</button></div>
</div></div>`;
  document.body.appendChild(root);
  const $=s=>root.querySelector(s);
  const cv=root.querySelector('canvas'),cx=cv.getContext('2d');

  /* ---------- картинки: готовые ассеты Frog Jump + свои камыши ----------
     Если картинки камышей нет (или не загрузилась), заросли рисуются кодом */
  const IMG_SRC={
    pad:'jump/pad.png',water:'jump/water.png',dragonfly:'jump/dragonfly.png',
    cloud_1:'jump/cloud_1.png',cloud_2:'jump/cloud_2.png',cloud_3:'jump/cloud_3.png',
    reed_bottom:'flappy/reed_bottom.png',reed_top:'flappy/reed_top.png',heron:'flappy/heron.png',
  };
  const IMG={};
  function loadImgs(){for(const k in IMG_SRC){if(IMG[k])continue;const im=new Image();im.decoding='async';im.onload=()=>{im.ok=true;};im.src=IMG_SRC[k];IMG[k]=im;}}
  const has=k=>{const im=IMG[k];return !!(im&&im.ok&&im.naturalWidth);};

  /* ---------- экран ---------- */
  let dpr=1,sc=1,VH=640,cssW=360,cssH=640,offX=0,fieldW=360,waterY=560;
  function resize(){
    cssW=root.clientWidth||window.innerWidth;cssH=root.clientHeight||window.innerHeight;
    dpr=Math.min(2,window.devicePixelRatio||1);
    cv.width=Math.round(cssW*dpr);cv.height=Math.round(cssH*dpr);
    fieldW=Math.min(cssW,cssH*.62);offX=(cssW-fieldW)/2;
    sc=fieldW/W;VH=cssH/sc;waterY=VH-78;
    reedCache.clear();
  }
  window.addEventListener('resize',()=>{if(open)resize();});

  /* ---------- камыши: колонна рисуется один раз и режется по высоте ---------- */
  const reedCache=new Map();
  function reedColumn(top,zi){
    const key=(top?'t':'b')+zi;let c=reedCache.get(key);if(c)return c;
    const w=RW+28,h=Math.ceil(VH+40);
    c=document.createElement('canvas');c.width=Math.ceil(w*sc*dpr);c.height=Math.ceil(h*sc*dpr);
    const g=c.getContext('2d');g.scale(sc*dpr,sc*dpr);
    const z=ZONES[zi],k=zi===2?.6:.35,dark=mixc('#1f6b3a',z.mid,k),light=mixc('#7fcf6a',z.top,k*.5),mid=mixc('#3f9a4e',z.mid,k*.8);   // ночью камыши темнеют вместе с небом
    // стебли: плотный пучок разной толщины с лёгким изгибом; у нижних — рогоз на макушке
    const stems=[];for(let i=0;i<9;i++)stems.push({x:6+i*(w-12)/8+rnd(-4,4),wd:rnd(5,9),bend:rnd(-6,6),tone:Math.random()});
    g.save();if(top){g.translate(0,h);g.scale(1,-1);}
    for(const s of stems){
      const gr=g.createLinearGradient(s.x-s.wd,0,s.x+s.wd,0);
      gr.addColorStop(0,dark);gr.addColorStop(.45,s.tone>.5?light:mid);gr.addColorStop(1,dark);
      g.fillStyle=gr;g.beginPath();
      g.moveTo(s.x-s.wd/2,h);g.quadraticCurveTo(s.x-s.wd/2+s.bend,h*.5,s.x-s.wd*.3+s.bend*.6,0);
      g.lineTo(s.x+s.wd*.3+s.bend*.6,0);g.quadraticCurveTo(s.x+s.wd/2+s.bend,h*.5,s.x+s.wd/2,h);g.closePath();g.fill();
    }
    // широкие листья по краям, чтобы силуэт не был ровным столбом
    for(let i=0;i<7;i++){
      const y0=14+i*rnd(26,40),side=i%2?1:-1,x0=side>0?w-10:10;
      g.fillStyle=i%2?mid:dark;g.beginPath();g.moveTo(x0,y0+40);
      g.quadraticCurveTo(x0+side*16,y0+12,x0+side*4,y0-6);g.quadraticCurveTo(x0+side*2,y0+16,x0-side*4,y0+40);g.closePath();g.fill();
    }
    // у края прохода — тёмная кромка, чтобы граница читалась на любом фоне
    g.fillStyle='rgba(0,0,0,.18)';g.fillRect(0,0,w,6);
    if(!top){
      // рогоз: коричневые початки на макушке нижних зарослей
      for(const x of [w*.28,w*.55,w*.78]){
        g.fillStyle='#6b3f1f';g.beginPath();g.ellipse(x,10,6,15,0,0,Math.PI*2);g.fill();
        g.fillStyle='#8f5a2e';g.beginPath();g.ellipse(x-2,7,2.5,9,0,0,Math.PI*2);g.fill();
        g.fillStyle=dark;g.fillRect(x-1.2,-12,2.4,10);
      }
    }else{
      // сверху — свисающий мох и капли
      g.fillStyle=mixc('#4f8f3a',z.mid,.3);
      for(let x=4;x<w-4;x+=9){const l=rnd(8,22);g.beginPath();g.moveTo(x-4,0);g.quadraticCurveTo(x,l*1.3,x+4,0);g.fill();}
    }
    g.restore();
    reedCache.set(key,c);return c;
  }

  /* ---------- состояние ---------- */
  let open=false,run=null,rafId=0,last=0,acc=0,tGlobal=0,paused=false;
  let bestBefore=0,tourR=[],overRes=null,frogImg=null,frogSlug='';
  const PREF_KEY='ff.v1';let pref={best:0};
  try{Object.assign(pref,JSON.parse(localStorage.getItem(PREF_KEY)||'{}'));}catch(e){}
  const savePref=()=>{try{localStorage.setItem(PREF_KEY,JSON.stringify(pref));}catch(e){}};
  const hasApi=()=>B.hasApi&&B.hasApi();

  function loadFrog(){
    const slug=((B.net().jump||{}).skin)||'original';
    if(slug===frogSlug&&frogImg)return;
    frogSlug=slug;frogImg=null;
    B.bake('frogs/'+slug,256).then(c=>{if(frogSlug===slug)frogImg=c;}).catch(()=>{if(slug!=='original'){frogSlug='';B.bake('frogs/original',256).then(c=>{frogImg=c;}).catch(()=>{});}});
  }

  function mkRun(base){
    return {
      t:0,x:0,y:VH*.42,vy:0,rot:0,sq:0,started:false,alive:true,dead:0,
      score:base||0,flies:0,bounces:1,inv:0,gates:[],flyItems:[],parts:[],
      nextX:W*1.15,lastGy:VH*.42,zone:0,zoneT:1,reviveN:0,seg:{t0:0,f0:0,tokenP:null},
      clouds:[...Array(4)].map((_,i)=>({x:rnd(0,W*1.4),y:rnd(VH*.06,VH*.36),k:'cloud_'+(1+i%3),w:rnd(70,120),p:rnd(.08,.16)})),
      pads:[...Array(5)].map((_,i)=>({x:i*110+rnd(-20,20),w:rnd(46,70)})),
      motes:[...Array(18)].map(()=>({x:rnd(0,W),y:rnd(0,VH),p:rnd(.2,.6),t:rnd(0,6)})),
      shake:0,tongue:null,
    };
  }
  // параметры прохода по счёту: ширина сужается до 100 очков, потом держится
  function gapH(n){return n<5?268:lerp(236,168,clamp((n-5)/95,0,1));}
  function speed(n){return lerp(150,212,clamp(n/100,0,1));}
  function addGate(r){
    const n=r.genN=(r.genN||0)+1;   // номер прохода с начала полёта — по нему растёт сложность
    const h=gapH(n),minY=VH*.16+h/2,maxY=waterY-56-h/2;
    let y=clamp(r.lastGy+rnd(-170,170),minY,Math.max(minY,maxY));
    if(n<5)y=clamp(lerp(r.lastGy,(minY+maxY)/2,.6),minY,maxY);
    r.lastGy=y;
    const g={x:r.nextX,y,h,passed:false,amp:n>=30?lerp(14,46,clamp((n-30)/60,0,1))*(Math.random()<.65?1:0):0,ph:rnd(0,6),
      heron:n>=60&&Math.random()<.2?{t:rnd(0,2.2)}:null};
    r.gates.push(g);r.nextX+=SPACING*rnd(.94,1.08);
    // мошки в проходе: обычная почти всегда, изредка золотая
    if(Math.random()<.7)r.flyItems.push({x:g.x+rnd(-14,14),y:y+rnd(-h*.25,h*.25),gold:Math.random()<.08,t:rnd(0,6),taken:false});
    if(Math.random()<.35)r.flyItems.push({x:g.x+SPACING*.5,y:clamp(y+rnd(-60,60),VH*.18,waterY-40),gold:false,t:rnd(0,6),taken:false});
  }
  const gy=(g,t)=>g.y+(g.amp?Math.sin(t*1.25+g.ph)*g.amp:0);

  /* ---------- сервер ---------- */
  function startToken(cont,tries=1){
    if(!hasApi())return Promise.resolve(null);
    return (async()=>{
      for(let i=0;i<tries;i++){
        try{
          const res=await B.api('flapStart',{cont:!!cont});
          if(res&&res.ok){if(res.tourRivals&&!cont)tourR=res.tourRivals;return res.run;}
          if(!(res&&res.error==='wait'))return null;
        }catch(e){return null;}
        await new Promise(r=>setTimeout(r,700));
      }
      return null;
    })();
  }
  async function submitSeg(r){
    const seg=r.seg,flies=r.flies-seg.f0,ms=Math.round((r.t-seg.t0)*1000);seg.f0=r.flies;
    if(r.score>(pref.best||0)){pref.best=r.score;savePref();}
    if(!hasApi())return {ok:true,local:true,earned:flies,flap:{best:pref.best}};
    const tok=await seg.tokenP;if(!tok)return {ok:false,error:'offline'};
    try{const res=await B.api('flapEnd',{run:tok,score:r.score,flies,ms});if(res&&res.ok&&B.applyFlap)B.applyFlap(res);return res;}
    catch(e){return {ok:false,error:'offline'};}
  }

  /* ---------- ход игры ---------- */
  function start(){
    loadFrog();
    run=mkRun(0);
    for(let i=0;i<4;i++)addGate(run);
    run.seg.tokenP=startToken(false);
    bestBefore=Math.max(pref.best||0,((B.net().flap||{}).best)||0);
    paused=false;hud(true);
    $('#ffOver').hidden=true;$('#ffPauseOv').hidden=true;$('#ffTap').hidden=false;
  }
  function flap(){
    const r=run;if(!r||!r.alive||paused)return;
    if(!r.started){r.started=true;$('#ffTap').hidden=true;r.seg.t0=r.t;}
    r.vy=FLAP;r.sq=.22;SND.flap();B.haptic.light&&B.haptic.light();
    for(let i=0;i<4;i++)P({k:'drop',x:r.x-8,y:r.y+10,vx:rnd(-90,-30),vy:rnd(20,90),life:rnd(.25,.4),s:rnd(2,3),c:'rgba(220,250,255,.8)'});
  }
  function P(o){if(run.parts.length>160)run.parts.splice(0,20);o.t=0;run.parts.push(o);}
  function banner(t,s='',gold=false){const el=$('#ffBanner');el.innerHTML=t+(s?`<small>${s}</small>`:'');el.classList.toggle('gold',gold);el.classList.remove('on');void el.offsetWidth;el.classList.add('on');}
  function kick(el,c){el.classList.remove(c);void el.offsetWidth;el.classList.add(c);}
  function hud(force){
    const r=run;if(!r)return;
    $('#ffSc').textContent=r.score;$('#ffFN').textContent=fmt(r.flies);
    $('#ffLily').classList.toggle('off',r.bounces<=0);
    $('#ffLily').querySelector('span').textContent=r.bounces>0?'отскок':'без отскока';
  }

  function update(dt){
    const r=run;tGlobal+=dt;r.t+=dt;
    const v=speed(r.score);
    if(r.started&&r.alive){
      r.vy=Math.min(r.vy+G*dt,760);r.y+=r.vy*dt;r.x+=v*dt;
    }else if(!r.started){
      r.y=(r.hoverY??VH*.42)+Math.sin(tGlobal*3)*8;   // ждём первого тапа — лягушка парит на месте
    }else{
      r.dead+=dt;r.vy=Math.min(r.vy+G*dt,900);r.y=Math.min(r.y+r.vy*dt,waterY+30);r.rot+=dt*6;
    }
    r.sq*=Math.pow(.02,dt);
    if(r.alive)r.rot=lerp(r.rot,clamp(r.vy/900,-.45,.9),Math.min(1,dt*10));
    if(r.inv>0)r.inv-=dt;
    // генерация и уборка проходов
    const camX=r.x-W*.3;
    while(r.nextX<camX+W*1.6)addGate(r);
    r.gates=r.gates.filter(g=>g.x>camX-RW*2);
    r.flyItems=r.flyItems.filter(f=>f.x>camX-40&&!f.done);
    if(r.alive&&r.started){
      // потолок: выше экрана не улетаем, но и не умираем
      if(r.y<-10){r.y=-10;r.vy=Math.max(r.vy,0);}
      // вода: первый раз — отскок от кувшинки, второй — конец
      if(r.y+HIT>waterY){
        if(r.bounces>0||r.inv>0){
          if(r.inv<=0){r.bounces--;banner('Отскок!','кувшинка спасла');SND.bounce();B.haptic.medium&&B.haptic.medium();}
          r.y=waterY-HIT;r.vy=FLAP*1.12;r.bounceFx={x:r.x,t:0};splash(r.x,waterY);hud();
        }else die();
      }
      for(const g of r.gates){
        const y=gy(g,r.t),top=y-g.h/2,bot=y+g.h/2;
        if(Math.abs(r.x-g.x)<RW/2+HIT*.8&&r.inv<=0){
          if(r.y-HIT<top||r.y+HIT>bot){die();break;}
          if(g.heron&&heronHit(g,r))break;
        }
        if(!g.passed&&r.x>g.x){
          g.passed=true;r.score++;SND.score(r.score);kick($('#ffSc'),'kick');hud();
          if(r.score%25===0){const zi=Math.floor(r.score/25)%ZONES.length;r.zoneFrom=r.zone;r.zone=zi;r.zoneT=0;banner(ZONES[zi].name,`${r.score} ${pts(r.score)}`,true);SND.zone();}
          if(r.score===bestBefore+1&&bestBefore>0){banner('Новый рекорд!','',true);SND.record();}
        }
      }
      // язык ловит мошек рядом
      for(const f of r.flyItems){
        f.t+=dt;if(f.taken)continue;
        const dx=f.x-r.x,dy=f.y-r.y,d2=dx*dx+dy*dy;
        if(d2<62*62&&dx>-20){f.taken=true;r.tongue={f,t:0};}
      }
    }
    if(r.tongue){r.tongue.t+=dt;if(r.tongue.t>.13&&!r.tongue.f.done){const f=r.tongue.f;f.done=true;r.flies+=f.gold?5:1;f.gold?SND.gold():SND.gulp();kick($('#ffFl'),'bump');hud();
      for(let i=0;i<8;i++)P({k:'spark',x:f.x,y:f.y,vx:rnd(-90,90),vy:rnd(-90,90),life:.4,s:rnd(2,3.5),c:f.gold?'#ffe36b':'#d9ffe0'});}
      if(r.tongue.t>.22)r.tongue=null;}
    if(r.zoneT<1)r.zoneT=Math.min(1,r.zoneT+dt/1.5);
    for(const p of r.parts){p.t+=dt;p.x+=(p.vx||0)*dt;p.y+=(p.vy||0)*dt;if(p.k==='drop')p.vy+=900*dt;}
    r.parts=r.parts.filter(p=>p.t<p.life);
    if(r.shake>0)r.shake=Math.max(0,r.shake-dt*30);
    if(r.bounceFx){r.bounceFx.t+=dt;if(r.bounceFx.t>.9)r.bounceFx=null;}
    if(!r.alive&&r.dead>.75&&!r.overShown){r.overShown=true;showOver();}
  }
  function heronHit(g,r){
    const ph=(r.t+g.heron.t)%2.6;
    if(ph<1.75||ph>2.2)return false;
    const y=gy(g,r.t)+g.h/2,reach=lerp(0,62,Math.sin((ph-1.75)/.45*Math.PI));
    const bx=g.x-10,by=y-reach;
    if(Math.hypot(r.x-bx,r.y-by)<HIT+10){die('heron');return true;}
    return false;
  }
  function splash(x,y){for(let i=0;i<12;i++){const a=rnd(.3,Math.PI-.3);P({k:'drop',x:x+rnd(-12,12),y,vx:Math.cos(a)*rnd(40,150),vy:-Math.sin(a)*rnd(140,280),life:rnd(.35,.6),s:rnd(2,3.6),c:'rgba(210,245,255,.9)'});}}
  function die(cause){
    const r=run;if(!r.alive)return;
    r.alive=false;r.cause=cause||'reed';r.vy=-300;r.shake=10;
    SND.hit();B.haptic.error&&B.haptic.error();
    for(let i=0;i<14;i++)P({k:'spark',x:r.x,y:r.y,vx:rnd(-160,160),vy:rnd(-160,120),life:.5,s:rnd(2,4),c:i%2?'#ffffff':'#9dffb0'});
    overRes=submitSeg(r);
  }

  /* ---------- экран конца ---------- */
  function tourHint(s){
    let best=null;const now=Date.now();
    for(const t of tourR||[]){
      if(t.endsAt&&t.endsAt<now)continue;
      const P=t.places||3,rows=(t.rows||[]).filter(r=>r.best>0),rank=rows.filter(r=>r.best>=s).length+1;
      const left=t.endsAt?t.endsAt-now:0,hh=Math.floor(left/3600e3),mi=Math.floor(left/60e3)%60,lt=left?` · до конца ${hh?hh+' ч '+mi+' мин':mi+' мин'}`:'';
      const pz=k=>(t.prizes||[])[k-1]||'';let o;
      if(rank<=P){const up=rows[rank-2];o={inPrize:true,gap:0,head:`Этот полёт — ${rank}-е место${pz(rank)?' · '+pz(rank):''}`,sub:(up?`до ${rank-1}-го ещё ${up.best-s+1} ${pts(up.best-s+1)} — продолжи`:'это лидерство — продолжи и уйди в отрыв')+lt};}
      else{const edge=rows[P-1],gap=edge.best-s+1;o={inPrize:false,gap,head:`До ${P}-го места${pz(P)?' ('+pz(P)+')':''} — ${gap} ${pts(gap)}`,sub:`ты сейчас был бы ${rank}-м из ${rows.length+1}${lt}`};}
      if(!best||o.gap<best.gap)best=o;
    }
    return best;
  }
  function showOver(){
    const r=run,s=r.score,isBest=s>bestBefore&&s>0;
    $('#ffNewRec').hidden=!isBest;
    $('#ffOverT').textContent=r.cause==='heron'?'Цапля поймала':'Полёт окончен';
    $('#ffOverS').textContent=s;
    $('#ffOverBest').textContent=isBest?(bestBefore?`Прошлый рекорд — ${bestBefore}`:'Это твой первый полёт'):`Твой рекорд — ${Math.max(bestBefore,s)}`;
    $('#ffOverF').textContent=fmt(r.flies);$('#ffOverNote').textContent='';
    const th=tourHint(s),tb=$('#ffTour');
    tb.hidden=!th;if(th){tb.className='ff-th'+(th.inPrize?' in':'');tb.innerHTML=`<b>${esc(th.head)}</b><small>${esc(th.sub)}</small>`;}
    // продолжение главной кнопкой — когда жалко терять: рекорд рядом или приз рядом
    const rn=r.reviveN,canRev=rn<REVIVE_PRICES.length&&s>=3;
    const near=(th&&(th.inPrize||th.gap<=Math.max(4,s*.5)))||(bestBefore>=5&&s>=bestBefore*.7);
    const rv=$('#ffRevive');rv.hidden=!canRev;
    rv.innerHTML=`Продолжить · ${REVIVE_PRICES[rn]||''} <img class="ic" src="icons/tgstar.png" alt="">`;
    rv.className=near?'btn':'btn ghost';$('#ffAgain').className=canRev&&near?'btn ghost':'btn';
    if(canRev&&!near)$('#ffAgain').after(rv);else $('#ffAgain').before(rv);
    $('#ffOver').hidden=false;
    if(isBest)SND.record();
    Promise.resolve(overRes).then(res=>{
      if(run!==r)return;
      const note=$('#ffOverNote');
      if(!res||!res.ok){note.textContent=res&&res.error==='offline'?'Нет связи с сервером — результат не засчитан':'';return;}
      const tot=res.jump?res.jump.flies:null;
      note.textContent=(tot!=null?`Мошек всего: ${fmt(tot)}`:'')+(res.rank?` · место в рейтинге: ${res.rank}`:'');
    });
  }
  async function revive(){
    const r=run;if(!r||r.alive)return;
    $('#ffRevive').disabled=true;$('#ffRevive').textContent='Возвращаемся…';
    try{await overRes;}catch(e){}
    const tok=startToken(true,20);const t=await tok;
    $('#ffRevive').disabled=false;
    if(!t){B.toast&&B.toast('Оплата ещё идёт — попробуй через пару секунд',3000);$('#ffRevive').innerHTML=`Продолжить · ${REVIVE_PRICES[r.reviveN]} <img class="ic" src="icons/tgstar.png" alt="">`;return;}
    r.reviveN++;r.alive=true;r.overShown=false;r.dead=0;r.inv=2.2;r.bounces=Math.max(r.bounces,1);
    // ставим лягушку в середину ближайшего прохода впереди и ждём тапа
    const next=r.gates.find(g=>g.x>r.x+20)||r.gates[r.gates.length-1];
    r.y=gy(next,r.t);r.hoverY=r.y;r.vy=0;r.rot=0;r.started=false;
    r.seg={t0:r.t,f0:r.flies,tokenP:Promise.resolve(t)};
    $('#ffOver').hidden=true;$('#ffTap').hidden=false;hud();
  }
  $('#ffRevive').onclick=()=>{
    const r=run;if(!r)return;SND.ui();
    B.buyJumpItem(r.reviveN?'flapRevive2':'flapRevive',()=>revive());
  };
  $('#ffAgain').onclick=()=>{SND.ui();start();};
  $('#ffExit').onclick=()=>{SND.ui();close();};
  $('#ffPause').onclick=e=>{e.stopPropagation();SND.ui();pause();};
  $('#ffResume').onclick=()=>{SND.ui();resume();};
  $('#ffQuit').onclick=()=>{SND.ui();if(run&&run.alive&&run.started){run.alive=false;overRes=submitSeg(run);}close();};
  function sndLabel(){$('#ffSnd').textContent=B.soundOn()?'Звук: вкл':'Звук: выкл';}
  $('#ffSnd').onclick=()=>{B.setSound(!B.soundOn());sndLabel();};
  function pause(){if(!run||!run.alive||!run.started)return;paused=true;sndLabel();$('#ffPauseOv').hidden=false;}
  function resume(){paused=false;$('#ffPauseOv').hidden=true;last=0;}

  // тап — в любом месте поля, кроме кнопок и окон
  root.addEventListener('pointerdown',e=>{if(e.target.closest('button,.ff-ov'))return;e.preventDefault();flap();});
  window.addEventListener('keydown',e=>{if(!open)return;if(e.code==='Space'||e.key==='ArrowUp'){e.preventDefault();flap();}else if(e.key==='Escape')paused?resume():pause();});
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&open)pause();});

  /* ---------- отрисовка ---------- */
  const X0=()=>run.x-W*.3;   // левый край камеры в мире
  function zcol(k){const r=run,a=ZONES[r.zoneFrom??r.zone][k],b=ZONES[r.zone][k];return r.zoneT<1?mixc(a,b,r.zoneT):b;}
  function draw(){
    const r=run;
    cx.setTransform(dpr,0,0,dpr,0,0);
    cx.fillStyle='#0c3a2a';cx.fillRect(0,0,cssW,cssH);
    cx.save();cx.translate(offX+(r.shake?rnd(-r.shake,r.shake):0),r.shake?rnd(-r.shake,r.shake)*.6:0);cx.scale(sc,sc);
    cx.beginPath();cx.rect(0,0,W,VH);cx.clip();
    const cam=X0();
    // небо
    const sky=cx.createLinearGradient(0,0,0,waterY);sky.addColorStop(0,zcol('top'));sky.addColorStop(1,zcol('bot'));
    cx.fillStyle=sky;cx.fillRect(0,0,W,VH);
    // светлячки/звёзды
    const night=r.zone===2;
    for(const m of r.motes){m.t+=.016;const x=((m.x-cam*m.p*.2)%W+W)%W,y=m.y;cx.globalAlpha=night?.5+.4*Math.sin(m.t*2):.18+.12*Math.sin(m.t*2);cx.fillStyle=night?'#fff6c9':'#eaffc9';cx.beginPath();cx.arc(x,y,night?1.4:2,0,7);cx.fill();}
    cx.globalAlpha=1;
    // облака
    for(const c of r.clouds){
      let x=c.x-cam*c.p;x=((x%(W*1.6))+W*1.6)%(W*1.6)-W*.3;
      if(has(c.k)){const im=IMG[c.k],h=c.w*im.naturalHeight/im.naturalWidth;cx.globalAlpha=night?.35:.9;cx.drawImage(im,x,c.y,c.w,h);cx.globalAlpha=1;}
      else{cx.fillStyle=night?'rgba(255,255,255,.12)':'rgba(255,255,255,.55)';cx.beginPath();cx.ellipse(x+c.w/2,c.y+10,c.w/2,12,0,0,7);cx.fill();}
    }
    // дальний лес и ближние заросли — параллакс силуэтами
    hills(cam*.15,waterY-120,46,zcol('far'),.011,3);
    hills(cam*.35,waterY-60,30,zcol('mid'),.023,7);
    // камыши
    const zi=r.zone;
    for(const g of r.gates){
      const x=g.x-cam,y=gy(g,r.t),top=y-g.h/2,bot=y+g.h/2;
      if(x<-RW||x>W+RW)continue;
      drawReed(x,top,true,zi);drawReed(x,bot,false,zi);
      if(g.heron)drawHeron(g,x,bot);
    }
    // мошки
    for(const f of r.flyItems){if(f.done)continue;const x=f.x-cam,y=f.y+Math.sin(f.t*3)*4;
      if(f.gold){cx.fillStyle='rgba(255,210,63,.28)';cx.beginPath();cx.arc(x,y,13+Math.sin(f.t*6)*2,0,7);cx.fill();}
      drawFly(x,y,f.gold,f.t);}
    // вода с кувшинками
    const wg=cx.createLinearGradient(0,waterY,0,VH);wg.addColorStop(0,zcol('water'));wg.addColorStop(1,'#0a2a2a');
    cx.fillStyle=wg;cx.fillRect(0,waterY,W,VH-waterY);
    cx.strokeStyle='rgba(210,245,255,.35)';cx.lineWidth=1.4;
    for(let i=0;i<3;i++){const yy=waterY+6+i*13;cx.beginPath();for(let x=0;x<=W;x+=12)cx.lineTo(x,yy+Math.sin((x+cam)*.05+tGlobal*2+i)*2);cx.stroke();}
    for(const p of r.pads){let x=((p.x-cam)%(W+140)+W+140)%(W+140)-70;
      if(has('pad')){const im=IMG.pad,h=p.w*im.naturalHeight/im.naturalWidth;cx.drawImage(im,x-p.w/2,waterY-h*.35,p.w,h);}
      else{cx.fillStyle='#4fb36a';cx.beginPath();cx.ellipse(x,waterY+3,p.w/2,6,0,0,7);cx.fill();}}
    // кувшинка, от которой отскочили
    if(r.bounceFx){const k=r.bounceFx.t,x=r.bounceFx.x-cam;cx.globalAlpha=1-k;cx.strokeStyle='rgba(220,250,255,.8)';cx.lineWidth=2;cx.beginPath();cx.ellipse(x,waterY+2,20+k*40,5+k*8,0,0,7);cx.stroke();cx.globalAlpha=1;}
    // частицы
    for(const p of r.parts){cx.globalAlpha=1-p.t/p.life;cx.fillStyle=p.c;cx.beginPath();cx.arc(p.x-cam,p.y,p.s,0,7);cx.fill();}
    cx.globalAlpha=1;
    // язык
    if(r.tongue){const f=r.tongue.f,k=Math.min(1,r.tongue.t/.13),mx=r.x-cam+14,my=r.y+4;cx.strokeStyle='#ff7ea0';cx.lineWidth=4;cx.lineCap='round';cx.beginPath();cx.moveTo(mx,my);cx.lineTo(lerp(mx,f.x-cam,k),lerp(my,f.y,k));cx.stroke();}
    // лягушка
    drawFrog(r.x-cam,r.y,r);
    cx.restore();
  }
  function hills(off,base,amp,col,fr,seed){
    cx.fillStyle=col;cx.beginPath();cx.moveTo(0,VH);
    for(let x=0;x<=W;x+=8){const t=(x+off)*fr;cx.lineTo(x,base-amp*(.55+.25*Math.sin(t+seed)+.2*Math.sin(t*2.7+seed*2)));}
    cx.lineTo(W,VH);cx.closePath();cx.fill();
  }
  function drawReed(x,edge,top,zi){
    const k=top?'reed_top':'reed_bottom';
    if(has(k)){
      const im=IMG[k],w=RW+28,h=w*im.naturalHeight/im.naturalWidth;
      if(top)cx.drawImage(im,x-w/2,edge-h,w,h);else cx.drawImage(im,x-w/2,edge,w,h);
      if(top&&edge-h>0){cx.drawImage(im,x-w/2,edge-2*h,w,h);}      // очень высокие — дорисовываем
      return;
    }
    const c=reedColumn(top,zi),w=RW+28,h=c.height/(sc*dpr);
    if(top)cx.drawImage(c,x-w/2,edge-h,w,h);else cx.drawImage(c,x-w/2,edge-6,w,h);
  }
  function drawHeron(g,x,bot){
    const ph=(run.t+g.heron.t)%2.6;
    let reach=0;if(ph>1.75&&ph<2.2)reach=lerp(0,62,Math.sin((ph-1.75)/.45*Math.PI));
    const warn=ph>1.25&&ph<1.75;
    const hx=x-10,hy=bot-6-reach;
    if(warn){cx.fillStyle='rgba(255,90,70,'+(.5+.5*Math.sin(tGlobal*20))+')';cx.font='900 22px Nunito,system-ui,sans-serif';cx.textAlign='center';cx.fillText('!',hx,bot-14);}
    if(has('heron')){const im=IMG.heron,w=56,h=w*im.naturalHeight/im.naturalWidth;cx.drawImage(im,hx-w/2,hy-h*.25,w,h);return;}
    // шея и голова цапли, клюв вверх
    cx.strokeStyle='#e8eef2';cx.lineWidth=7;cx.lineCap='round';cx.beginPath();cx.moveTo(hx+6,bot+30);cx.quadraticCurveTo(hx+14,hy+18,hx,hy+6);cx.stroke();
    cx.fillStyle='#f4f8fa';cx.beginPath();cx.ellipse(hx,hy+4,8,7,0,0,7);cx.fill();
    cx.fillStyle='#f2b134';cx.beginPath();cx.moveTo(hx-3,hy);cx.lineTo(hx+1,hy-22);cx.lineTo(hx+4,hy);cx.closePath();cx.fill();
    cx.fillStyle='#1d2b33';cx.beginPath();cx.arc(hx+3,hy+2,1.6,0,7);cx.fill();
  }
  function drawFly(x,y,gold,t){
    cx.save();cx.translate(x,y);
    const fl=Math.sin(t*40)*.5+.5;
    cx.fillStyle='rgba(235,245,255,.75)';cx.beginPath();cx.ellipse(-4,-4,5,3+fl*2,-.5,0,7);cx.ellipse(4,-4,5,3+fl*2,.5,0,7);cx.fill();
    cx.fillStyle=gold?'#f7b500':'#2b2f3a';cx.beginPath();cx.ellipse(0,1,4,5,0,0,7);cx.fill();
    cx.fillStyle='#e0405f';cx.beginPath();cx.arc(-1.6,-2,1.2,0,7);cx.arc(1.6,-2,1.2,0,7);cx.fill();
    cx.restore();
  }
  function drawFrog(x,y,r){
    cx.save();cx.translate(x,y);cx.rotate(r.rot);
    const s=1+r.sq;cx.scale(s,1/s);
    if(r.inv>0&&Math.floor(tGlobal*14)%2)cx.globalAlpha=.5;
    if(frogImg){cx.drawImage(frogImg,-FROG/2,-FROG/2,FROG,FROG);}
    else{cx.fillStyle='#5cc27a';cx.beginPath();cx.ellipse(0,0,FROG*.42,FROG*.34,0,0,7);cx.fill();cx.fillStyle='#fff';cx.beginPath();cx.arc(8,-10,7,0,7);cx.fill();cx.fillStyle='#000';cx.beginPath();cx.arc(10,-10,3,0,7);cx.fill();}
    cx.restore();
  }

  /* ---------- цикл ---------- */
  function frame(ts){
    if(!open)return;
    rafId=requestAnimationFrame(frame);
    if(!last)last=ts;let dt=Math.min(.05,(ts-last)/1000);last=ts;
    if(!run)return;
    if(!paused){acc+=dt;while(acc>=STEP){update(STEP);acc-=STEP;}}
    draw();
  }

  function openGame(){
    if(open)return;
    open=true;root.hidden=false;B.setActive&&B.setActive(true);
    loadImgs();resize();start();
    last=0;acc=0;cancelAnimationFrame(rafId);rafId=requestAnimationFrame(frame);
  }
  function close(){
    open=false;root.hidden=true;cancelAnimationFrame(rafId);
    B.setActive&&B.setActive(false);B.onClose&&B.onClose();
  }
  // только для локальной проверки: автопилот видит лягушку и ближайший проход
  if(/^(localhost|127\.0\.0\.1)$/.test(location.hostname))window.__ffDbg=()=>{if(!run)return null;const g=run.gates.find(g=>g.x>run.x-RW/2);return {y:run.y,vy:run.vy,alive:run.alive,score:run.score,cause:run.cause,started:run.started,gy:g?gy(g,run.t):null,gh:g?g.h:0,dx:g?g.x-run.x:0};};
  return {open:openGame,close,isOpen:()=>open};
};
})();
