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
/* пиксельный интерфейс: квадратные углы, жёсткие рамки без размытия, пиксельный шрифт для цифр и заголовков */
#ff,#ff .ff-ov .card{--pxf:'Press Start 2P',monospace}
#ff .ff-ib,#ff .ff-lily,#ff .ff-fl,#ff .ff-tap,#ff .ff-banner,#ff .ff-ov .card,#ff .btn,#ff .ff-earn,#ff .ff-th,#ff .ff-newrec{border-radius:0!important}
#ff .ff-ib,#ff .ff-lily,#ff .ff-fl,#ff .ff-tap,#ff .ff-banner{background:#173a26;box-shadow:0 0 0 3px #0b1d12,inset 0 -3px 0 #0e2a1a,inset 0 3px 0 #2f6a43}
#ff .ff-sc{font-family:var(--pxf);font-size:38px;font-weight:400;text-shadow:3px 3px 0 #0b1d12,-3px 0 0 #0b1d12,0 -3px 0 #0b1d12,3px 0 0 #0b1d12,0 3px 0 #0b1d12}
#ff .ff-fl,#ff .ff-lily{font-family:var(--pxf);font-weight:400;font-size:12px}
#ff .ff-lily{font-size:8px}
#ff .ff-lily img,#ff .ff-ov img{image-rendering:pixelated}
#ff .ff-tap{font-family:var(--pxf);font-weight:400;font-size:10px;padding:10px 14px;animation:ffBlink 1s steps(1) infinite;transform:translateX(-50%)}
@keyframes ffBlink{50%{opacity:.45}}
#ff .ff-banner{font-family:var(--pxf);font-weight:400;font-size:13px;line-height:1.5;padding:12px 16px}
#ff .ff-banner small{font-family:Nunito,system-ui,sans-serif;font-size:12px}
#ff .ff-banner.gold,#ff .ff-newrec{background:#f7b500;color:#3d2600;box-shadow:0 0 0 3px #5a3b00,inset 0 -3px 0 #c98a00,inset 0 3px 0 #ffe36b}
#ff .ff-ov{background:rgba(3,25,17,.6)}
#ff .ff-ov .card{background:#e8d9a8;color:#3a2a12;box-shadow:0 0 0 4px #3a2a12,inset 0 0 0 3px #f8efcc,8px 8px 0 4px rgba(0,0,0,.35);border:0}
#ff .ff-ov .card h2{font-family:var(--pxf);font-weight:400;font-size:15px;line-height:1.5;color:#c4541f;text-shadow:2px 2px 0 #f8efcc}
#ff .ff-ov .card .sub,#ff .ff-note{color:#5a4524;opacity:1}
#ff .ff-big{font-family:var(--pxf);font-weight:400;font-size:40px;color:#fff;text-shadow:3px 3px 0 #3a2a12,-3px 0 0 #3a2a12,0 -3px 0 #3a2a12,3px 0 0 #3a2a12,0 3px 0 #3a2a12}
#ff .ff-newrec{font-family:var(--pxf);font-weight:400;font-size:9px;padding:6px 10px}
#ff .ff-earn{background:#d6c58e;box-shadow:inset 0 0 0 2px #b8a46a;font-family:var(--pxf);font-weight:400;font-size:13px;color:#3a2a12}
#ff .ff-th{background:#f3e7bb;box-shadow:inset 0 0 0 2px #c4541f}
#ff .ff-th b{color:#c4541f}#ff .ff-th small{color:#5a4524}
#ff .ff-th.in{background:#dff0c0;box-shadow:inset 0 0 0 2px #3f8a3a}#ff .ff-th.in b{color:#2f6e2b}
#ff .btn{font-family:var(--pxf)!important;font-weight:400!important;font-size:11px!important;line-height:1.4;background:#f26b2a!important;color:#fff!important;box-shadow:0 0 0 3px #3a2a12,inset 0 -4px 0 #b8461a,inset 0 3px 0 #ff9a5c!important;border:0!important;text-shadow:2px 2px 0 #7a2a0a;padding:14px 10px 16px}
#ff .btn:active{transform:translateY(2px);box-shadow:0 0 0 3px #3a2a12,inset 0 3px 0 #b8461a!important}
#ff .btn.ghost{background:#4f9a5a!important;box-shadow:0 0 0 3px #3a2a12,inset 0 -4px 0 #2f6a3a,inset 0 3px 0 #7fcf8a!important;text-shadow:2px 2px 0 #1f4a2a}
#ff .card .row{gap:12px}
#ff .card{gap:14px}
#ff [hidden]{display:none!important}
#ff .ff-place{font-family:var(--pxf);font-size:10px;background:#173a26;box-shadow:0 0 0 3px #0b1d12,inset 0 -3px 0 #0e2a1a,inset 0 3px 0 #2f6a43;padding:6px 8px;line-height:1.5;text-align:center}
#ff .ff-place b{color:#ffd23f;font-weight:400}
#ff .ff-turbo{width:84px;height:8px;background:#0b1d12;box-shadow:0 0 0 2px #0b1d12;position:relative}
#ff .ff-turbo i{position:absolute;left:0;top:0;bottom:0;background:#ffd23f;box-shadow:inset 0 -2px 0 #c98a00}
#ff .ff-count{position:absolute;left:0;right:0;top:34%;text-align:center;font-family:var(--pxf);font-size:64px;color:#fff;pointer-events:none;text-shadow:5px 5px 0 #0b1d12,-4px 0 0 #0b1d12,0 -4px 0 #0b1d12,4px 0 0 #0b1d12,0 4px 0 #0b1d12}
#ff .ff-count small{display:block;font-size:12px;margin-top:22px;color:#9dffb0;text-shadow:2px 2px 0 #0b1d12}
#ff .ff-count.go{color:#ffd23f;font-size:40px}
.fr-list{width:100%;display:flex;flex-direction:column;gap:9px}
.fr-row{display:grid;grid-template-columns:30px 36px 1fr auto;gap:8px;align-items:center;background:#f3e7bb;box-shadow:inset 0 0 0 2px #b8a46a;padding:6px 8px;text-align:left;color:#3a2a12;font-weight:800;font-size:14px}
.fr-row .rk{font-family:'Press Start 2P',monospace;font-size:10px;width:26px;height:26px;line-height:26px;text-align:center;background:#d6c58e;color:#3a2a12}
.fr-row .rk.r1{background:#f7b500;box-shadow:0 0 0 2px #5a3b00}.fr-row .rk.r2{background:#cfd8de;box-shadow:0 0 0 2px #3a4248}.fr-row .rk.r3{background:#d9874a;box-shadow:0 0 0 2px #5a2e0e}
.fr-row img{width:36px;height:36px;image-rendering:pixelated;scale:-1 1}
.fr-row .nm{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fr-row .nm small{display:block;font-size:11px;font-weight:700;color:#7a6438}
.fr-row .sc{font-family:'Press Start 2P',monospace;font-size:12px;color:#c4541f}
.fr-row.me{background:#fff3c4;box-shadow:inset 0 0 0 2px #c4541f}
.fr-row.empty{background:transparent;box-shadow:inset 0 0 0 2px rgba(122,100,56,.35);color:#9a8656;font-weight:700;grid-template-columns:1fr;text-align:center;min-height:30px;padding:4px;font-size:12px}
.fr-tag{font-family:'Press Start 2P',monospace;font-size:7px;background:#c4541f;color:#fff;padding:3px 4px;margin-left:6px;vertical-align:2px}
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
  <div class="ff-mid" id="ffMp" hidden style="position:absolute;right:12px;top:calc(var(--tg-safe-area-inset-top,env(safe-area-inset-top,0px)) + var(--tg-content-safe-area-inset-top,0px) + 62px);align-items:flex-end"><div class="ff-place" id="ffPlace"></div><div class="ff-turbo" id="ffTurbo"><i></i></div></div>
</div>
<div class="ff-tap" id="ffTap">Тапни, чтобы взлететь</div>
<div class="ff-count" id="ffCount" hidden></div>
<div class="ff-banner" id="ffBanner"></div>
<div class="ff-ov" id="ffPauseOv" hidden><div class="card">
  <h2>Пауза</h2>
  <button class="btn" id="ffResume">Продолжить</button>
  <div class="row"><button class="btn ghost sm" id="ffSnd"></button><button class="btn ghost sm" id="ffGhostB"></button></div>
  <button class="btn ghost sm" id="ffQuit">Выйти</button>
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
</div></div>
<div class="ff-ov" id="ffRes" hidden><div class="card">
  <h2 id="ffResT">Итоги гонки</h2>
  <div class="ff-note" id="ffResN"></div>
  <div class="fr-list" id="ffResL"></div>
  <button class="btn" id="ffResGo" hidden>Ещё раунд</button>
  <button class="btn ghost" id="ffResRoom">В комнату</button>
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

  // общий уровень в гонке: одно зерно — одинаковые проходы у всех
  const mulberry=a=>()=>{a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};

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
    const px=c=>{try{return pixelate(c,36)||c;}catch(e){return c;}};
    B.bake('frogs/'+slug,256).then(c=>{if(frogSlug===slug)frogImg=px(c);}).catch(()=>{if(slug!=='original'){frogSlug='';B.bake('frogs/original',256).then(c=>{frogImg=px(c);}).catch(()=>{});}});
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
    const Rn=r.rng||Math.random,rr=(a,b)=>a+Rn()*(b-a);
    const h=gapH(n),minY=VH*.16+h/2,maxY=Math.max(minY,waterY-56-h/2);
    let y;
    if(r.rng){
      // в гонке высота прохода — доля свободной полосы: на любом экране проходы совпадают
      const u=n<5?lerp(r.lastU??.5,.5,.6):clamp((r.lastU??.5)+rr(-.42,.42),0,1);r.lastU=u;y=lerp(minY,maxY,u);
    }else{
      y=clamp(r.lastGy+rr(-170,170),minY,maxY);
      if(n<5)y=clamp(lerp(r.lastGy,(minY+maxY)/2,.6),minY,maxY);
    }
    r.lastGy=y;
    const g={x:r.nextX,y,h,passed:false,amp:n>=30?lerp(14,46,clamp((n-30)/60,0,1))*(Rn()<.65?1:0):0,ph:rr(0,6),
      heron:n>=60&&Rn()<.2?{t:rr(0,2.2)}:null};
    r.gates.push(g);r.nextX+=SPACING*rr(.94,1.08);
    // мошки в проходе: обычная почти всегда, изредка золотая
    const a1=Rn(),a2=rr(-14,14),a3=rr(-.25,.25),a4=Rn(),a5=Rn(),a6=rr(-60,60);
    if(a1<.7)r.flyItems.push({x:g.x+a2,y:y+a3*h,gold:a4<.08,t:rnd(0,6),taken:false});
    if(a5<.35)r.flyItems.push({x:g.x+SPACING*.5,y:clamp(y+a6,VH*.18,waterY-40),gold:false,t:rnd(0,6),taken:false});
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
    run.ghost=pref.ghost!==false&&ghostRec&&ghostRec.p&&ghostRec.p.length>10?ghostRec:null;
    mpHud();
    paused=false;hud(true);
    $('#ffOver').hidden=true;$('#ffPauseOv').hidden=true;$('#ffTap').hidden=false;
  }
  function flap(){
    const r=run;if(!r||!r.alive||paused)return;
    if(r.mp&&!r.started)return;   // в гонке взлетают все вместе по отсчёту
    if(!r.started){r.started=true;$('#ffTap').hidden=true;r.seg.t0=r.t;r.t0f=r.t;}
    if(r.mp&&r.mp.boostOn)r.boost=Math.min(.5,(r.boost||0)+.075);   // каждый взмах — короткий рывок
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
    const v=speed(r.score)*(r.mp&&r.mp.boostOn?1+(r.boost||0):1);
    if(r.mp){
      r.boost=(r.boost||0)*Math.exp(-dt*1.5);
      if(!r.started&&mpNow()>=r.mp.startAt){r.started=true;r.t0f=r.t;r.seg.t0=r.t;flap();r.mp.goT=tGlobal;}
      if(r.boost>.18&&r.alive&&Math.random()<r.boost*.9)P({k:'line',x:r.x-20,y:r.y+rnd(-16,16),vx:-260,vy:0,life:.22,s:2,c:'rgba(255,255,255,.75)'});
      // выбыл — камера плавно уходит к лидеру гонки
      if(!r.alive&&r.dead>1.1){const lx=mpLeaderX();if(lx!=null)r.camX=lerp(r.camX??r.x,lx,Math.min(1,dt*2.5));}
    }
    if(r.started&&r.alive){
      if(!r.mp&&!r.reviveN)ghostSample(r);
      r.vy=Math.min(r.vy+G*dt,760);r.y+=r.vy*dt;r.x+=v*dt;
    }else if(!r.started){
      r.y=(r.hoverY??VH*.42)+Math.sin(tGlobal*3)*8;   // ждём первого тапа — лягушка парит на месте
    }else{
      r.dead+=dt;r.vy=Math.min(r.vy+G*dt,900);r.y=Math.min(r.y+r.vy*dt,waterY-14);r.rot=Math.min(Math.PI/2,r.rot+dt*7);   // клюёт носом вниз и падает на воду, без кручения
    }
    r.sq*=Math.pow(.02,dt);
    if(r.alive)r.rot=lerp(r.rot,clamp(r.vy/900,-.45,.9),Math.min(1,dt*10));
    if(r.inv>0)r.inv-=dt;
    // генерация и уборка проходов
    const camX=(r.camX??r.x)-W*.3;
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
          if(!r.mp&&r.score===bestBefore+1&&bestBefore>0){banner('Новый рекорд!','',true);SND.record();}
        }
      }
      // язык ловит мошек рядом
      for(const f of r.flyItems){
        f.t+=dt;if(f.taken)continue;
        const dx=f.x-r.x,dy=f.y-r.y,d2=dx*dx+dy*dy;
        if(d2<62*62&&dx>-20){f.taken=true;r.tongue={f,t:0};}
      }
    }
    if(r.tongue){r.tongue.t+=dt;if(r.tongue.t>.13&&!r.tongue.f.done){const f=r.tongue.f;f.done=true;r.flies+=f.gold?5:1;if(r.mp&&r.mp.boostOn)r.boost=Math.min(.7,(r.boost||0)+(f.gold?.35:.18));f.gold?SND.gold():SND.gulp();kick($('#ffFl'),'bump');hud();
      for(let i=0;i<8;i++)P({k:'spark',x:f.x,y:f.y,vx:rnd(-90,90),vy:rnd(-90,90),life:.4,s:rnd(2,3.5),c:f.gold?'#ffe36b':'#d9ffe0'});}
      if(r.tongue.t>.22)r.tongue=null;}
    if(r.zoneT<1)r.zoneT=Math.min(1,r.zoneT+dt/1.5);
    for(const p of r.parts){p.t+=dt;p.x+=(p.vx||0)*dt;p.y+=(p.vy||0)*dt;if(p.k==='drop')p.vy+=900*dt;}
    r.parts=r.parts.filter(p=>p.t<p.life);
    if(r.shake>0)r.shake=Math.max(0,r.shake-dt*30);
    if(r.bounceFx){r.bounceFx.t+=dt;if(r.bounceFx.t>.9)r.bounceFx=null;}
    if(!r.alive&&r.dead>.75&&!r.overShown){r.overShown=true;if(r.mp)mpDied();else showOver();}
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
    if(r.mp){overRes=null;mpTick(true);return;}
    if(!r.reviveN)ghostSave(r);
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
  function ghostLabel(){$('#ffGhostB').textContent=pref.ghost!==false?'Метка рекорда: вкл':'Метка рекорда: выкл';}
  $('#ffGhostB').onclick=()=>{pref.ghost=pref.ghost===false;savePref();ghostLabel();if(run&&!run.mp)run.ghost=pref.ghost!==false?ghostRec:null;};
  function pause(){if(!run||!run.alive||!run.started||run.mp)return;ghostLabel();paused=true;sndLabel();$('#ffPauseOv').hidden=false;}
  function resume(){paused=false;$('#ffPauseOv').hidden=true;last=0;}

  // тап — в любом месте поля, кроме кнопок и окон
  root.addEventListener('pointerdown',e=>{if(e.target.closest('button,.ff-ov'))return;e.preventDefault();flap();});
  window.addEventListener('keydown',e=>{if(!open)return;if(e.code==='Space'||e.key==='ArrowUp'){e.preventDefault();flap();}else if(e.key==='Escape')paused?resume():pause();});
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&open)pause();});

  /* ---------- отрисовка: пиксель-арт ----------
     Весь мир рисуется в маленький холст (1 пиксель = PX мировых единиц)
     только прямоугольниками, потом растягивается без сглаживания —
     как в оригинальной Flappy Bird. Наряд лягушки пикселизируется в 36×36 */
  const PX=1.5;
  const lo=document.createElement('canvas'),lx=lo.getContext('2d');
  let PW=240,PH=427;
  const rgb=c=>{if(Array.isArray(c))return c;if(c[0]==='#')return hex(c);return c.match(/\d+/g).slice(0,3).map(Number);};
  const mixA=(a,b,t)=>{a=rgb(a);b=rgb(b);return a.map((v,i)=>Math.round(v+(b[i]-v)*t));};
  const css=a=>`rgb(${a[0]},${a[1]},${a[2]})`;
  const q=v=>Math.round(v/PX);                       // мир → пиксель
  function R(c,x,y,w,h){lx.fillStyle=c;lx.fillRect(x|0,y|0,w|0,h|0);}   // в пикселях
  function sprite(rows,pal,x,y){for(let j=0;j<rows.length;j++)for(let i=0;i<rows[j].length;i++){const ch=rows[j][i];if(ch!=='.')R(pal[ch],x+i,y+j,1,1);}}

  /* пикселизация наряда: палитра k-средних + решения по клетке, чтобы
     контуры, белки глаз и яркие акценты не растворялись в среднем цвете */
  function pixelate(src,N){
    const S=src.width,d=src.getContext('2d').getImageData(0,0,S,S).data;
    const lum=(r,g,b)=>.299*r+.587*g+.114*b;
    const hsv=(r,g,b)=>{const mx=Math.max(r,g,b),mn=Math.min(r,g,b),df=mx-mn;let h=0;
      if(df){if(mx===r)h=((g-b)/df)%6;else if(mx===g)h=(b-r)/df+2;else h=(r-g)/df+4;h/=6;if(h<0)h+=1;}return [h,mx?df/mx:0];};
    const pts=[];for(let i=0;i<S*S;i+=3){if(d[i*4+3]>128)pts.push([d[i*4],d[i*4+1],d[i*4+2]]);}
    const K=Math.min(14,pts.length);if(!K)return null;
    let C=[...Array(K)].map((_,i)=>pts[Math.floor(i*pts.length/K)].slice());
    const near=p=>{let bi=0,bd=1e9;for(let k=0;k<C.length;k++){const c=C[k],dd=(p[0]-c[0])**2+(p[1]-c[1])**2+(p[2]-c[2])**2;if(dd<bd){bd=dd;bi=k;}}return bi;};
    for(let it=0;it<8;it++){const s=C.map(()=>[0,0,0,0]);for(const p of pts){const k=near(p),t=s[k];t[0]+=p[0];t[1]+=p[1];t[2]+=p[2];t[3]++;}
      C=C.map((c,k)=>s[k][3]?[s[k][0]/s[k][3],s[k][1]/s[k][3],s[k][2]/s[k][3]]:c);}
    const CH=C.map(c=>hsv(...c));
    const out=document.createElement('canvas');out.width=out.height=N;
    const g=out.getContext('2d'),im=g.createImageData(N,N),o=im.data,fill=new Uint8Array(N*N),cs=S/N;
    const put=(i,c)=>{o[i*4]=c[0];o[i*4+1]=c[1];o[i*4+2]=c[2];o[i*4+3]=255;fill[i]=1;};
    for(let cy=0;cy<N;cy++)for(let cxl=0;cxl<N;cxl++){
      let n=0,a=0,wh=0,dk=0;const hist=new Array(C.length).fill(0);
      for(let y=Math.floor(cy*cs);y<Math.floor((cy+1)*cs);y++)for(let x=Math.floor(cxl*cs);x<Math.floor((cxl+1)*cs);x++){
        n++;const i=(y*S+x)*4;if(d[i+3]<=128)continue;a++;
        const r=d[i],gg=d[i+1],b=d[i+2],L=lum(r,gg,b);
        if(L>225&&hsv(r,gg,b)[1]<.18)wh++;else if(L<70)dk++;
        hist[near([r,gg,b])]++;
      }
      if(!n||a/n<.45)continue;
      const ci=cy*N+cxl;
      if(wh/a>.25&&wh>=dk*.6){put(ci,[244,247,242]);continue;}
      if(dk/a>.3){put(ci,[22,34,26]);continue;}
      let m=0;for(let k=1;k<hist.length;k++)if(hist[k]>hist[m])m=k;
      let pick=m;
      for(let k=0;k<hist.length;k++){if(k===m||hist[k]/a<=.22)continue;const [h,s]=CH[k];let hd=Math.abs(h-CH[m][0]);hd=Math.min(hd,1-hd);
        if(s>.35&&hd>.12&&(pick===m||hist[k]>hist[pick]))pick=k;}
      put(ci,C[pick].map(Math.round));
    }
    // контур в 1 пиксель вокруг силуэта
    const ol=[];for(let y=0;y<N;y++)for(let x=0;x<N;x++){const i=y*N+x;if(fill[i])continue;
      if((x>0&&fill[i-1])||(x<N-1&&fill[i+1])||(y>0&&fill[i-N])||(y<N-1&&fill[i+N]))ol.push(i);}
    for(const i of ol)put(i,[22,34,26]);
    g.putImageData(im,0,0);return out;
  }

  const X0=()=>(run.camX??run.x)-W*.3;   // левый край камеры в мире
  function zcol(k){const r=run,a=ZONES[r.zoneFrom??r.zone][k],b=ZONES[r.zone][k];return r.zoneT<1?mixA(a,b,r.zoneT):rgb(b);}
  function draw(){drawWorld();blit();}
  function drawWorld(){
    const r=run;
    PW=Math.round(W/PX);PH=Math.ceil(VH/PX);
    if(lo.width!==PW||lo.height!==PH){lo.width=PW;lo.height=PH;}
    lx.setTransform(1,0,0,1,0,0);lx.imageSmoothingEnabled=false;
    const cam=X0(),wy=q(waterY),night=r.zone===2;
    // небо — ступенчатый градиент полосами
    const top=zcol('top'),bot=zcol('bot');
    for(let i=0;i<10;i++){const y0=Math.floor(wy*i/10),y1=Math.floor(wy*(i+1)/10);R(css(mixA(top,bot,i/9)),0,y0,PW,y1-y0);}
    // звёзды/пылинки
    for(const m of r.motes){m.t+=.016;const x=((m.x-cam*m.p*.2)%W+W)%W;if(Math.sin(m.t*2)>(night?-.3:.6))R(night?'#fff6c9':'rgba(234,255,201,.6)',q(x),q(m.y),1,1);}
    // облака
    const cw=night?'rgba(255,255,255,.18)':'#f4fbff',cs=night?'rgba(255,255,255,.1)':'#d4ecf4';
    for(const c of r.clouds){
      let x=c.x-cam*c.p;x=((x%(W*1.6))+W*1.6)%(W*1.6)-W*.3;
      const px=q(x),py=q(c.y),w=q(c.w);
      R(cs,px,py+6,w,4);R(cw,px+2,py+3,w-4,6);R(cw,px+Math.floor(w*.18),py,Math.floor(w*.34),4);R(cw,px+Math.floor(w*.5),py-2,Math.floor(w*.3),6);
    }
    // дальний лес и ближние заросли — ступеньками
    hills(cam*.15,waterY-120,46,css(zcol('far')),.011,3);
    hills(cam*.35,waterY-60,30,css(zcol('mid')),.023,7);
    // камыши
    const pal=reedPal();
    for(const g of r.gates){
      const x=g.x-cam,y=gy(g,r.t),t=y-g.h/2,b=y+g.h/2;
      if(x<-RW||x>W+RW)continue;
      drawReed(x,t,true,pal);
      if(g.heron)drawHeron(g,x,b);
      drawReed(x,b,false,pal);
    }
    // мошки
    for(const f of r.flyItems){if(f.done)continue;drawFly(f.x-cam,f.y+Math.sin(f.t*3)*4,f.gold,f.t);}
    // вода: полосы, рябь, кувшинки
    const wc=zcol('water');
    R(css(wc),0,wy,PW,PH-wy);R(css(mixA(wc,[10,42,42],.5)),0,wy+8,PW,PH-wy-8);R(css(mixA(wc,[10,42,42],.85)),0,wy+22,PW,PH-wy-22);
    R(css(mixA(wc,[255,255,255],.35)),0,wy,PW,1);
    for(let i=0;i<3;i++)for(let x=-((cam/PX*(1+i*.3)+tGlobal*6)%16);x<PW;x+=16)R('rgba(210,245,255,.45)',Math.round(x+i*5),wy+4+i*7,5,1);
    for(const p of r.pads){const x=q(((p.x-cam)%(W+140)+W+140)%(W+140)-70),w=q(p.w);
      R('#1f5e34',x-w/2,wy-1,w,4);R('#4fb36a',x-w/2+1,wy-2,w-2,3);R('#7fd98a',x-w/2+3,wy-2,Math.floor(w/3),1);R(css(wc),x+2,wy-2,3,2);}
    if(r.bounceFx){const k=r.bounceFx.t,x=q(r.bounceFx.x-cam),s=Math.round(8+k*26);lx.globalAlpha=1-k;R('#dcfaff',x-s,wy,s*2,1);R('#dcfaff',x-s-3,wy+3,3,1);R('#dcfaff',x+s,wy+3,3,1);lx.globalAlpha=1;}
    // время суток поверх мира (лягушка и мошки ярче)
    const TINT=['rgba(0,0,0,0)','rgba(120,40,30,.14)','rgba(8,12,48,.32)','rgba(40,70,140,.06)'];
    lx.fillStyle=TINT[r.zone];lx.globalAlpha=r.zoneT;lx.fillRect(0,0,PW,wy);
    if(r.zoneT<1){lx.fillStyle=TINT[r.zoneFrom??r.zone];lx.globalAlpha=1-r.zoneT;lx.fillRect(0,0,PW,wy);}
    lx.globalAlpha=1;
    // частицы — квадратиками
    for(const p of r.parts){lx.globalAlpha=1-p.t/p.life;const s=Math.max(1,Math.round(p.s/PX));R(p.c,q(p.x-cam)-(s>>1),q(p.y)-(s>>1),s,s);}
    lx.globalAlpha=1;
    // язык — ступенчатая линия
    if(r.tongue){const f=r.tongue.f,k=Math.min(1,r.tongue.t/.13),x0=q(r.x-cam+14),y0=q(r.y+4),x1=q(lerp(r.x-cam+14,f.x-cam,k)),y1=q(lerp(r.y+4,f.y,k));
      const n=Math.max(Math.abs(x1-x0),Math.abs(y1-y0),1);for(let i=0;i<=n;i++)R('#ff7ea0',Math.round(lerp(x0,x1,i/n))-1,Math.round(lerp(y0,y1,i/n))-1,2,2);}
    r.fx=(r.x-cam)/PX;r.fy=r.y/PX;   // лягушку дорисует blit поверх
    // упал — над лягушкой нимб, как в оригинале
    if(!r.alive&&r.y>=waterY-15){const hx=q(r.x-cam),hy=q(r.y)-27+(Math.sin(tGlobal*3)>0?0:1);
      R('#b8860b',hx-7,hy,14,4);R('#ffd23f',hx-6,hy,12,1);R('#ffd23f',hx-7,hy+1,2,2);R('#ffd23f',hx+5,hy+1,2,2);R('#ffd23f',hx-6,hy+3,12,1);R('#fff6c9',hx-3,hy,4,1);}
  }
  function blit(){
    const r=run;
    // на экран — без сглаживания
    cx.setTransform(1,0,0,1,0,0);cx.imageSmoothingEnabled=false;
    cx.fillStyle='#0c3a2a';cx.fillRect(0,0,cv.width,cv.height);
    const sx=(r.shake?rnd(-r.shake,r.shake):0)*sc*dpr,sy=(r.shake?rnd(-r.shake,r.shake)*.6:0)*sc*dpr;
    const ox=Math.round(offX*dpr+sx),oy=Math.round(sy),k=fieldW*dpr/PW;
    cx.drawImage(lo,0,0,PW,PH,ox,oy,Math.round(fieldW*dpr),Math.round(PH*PX*sc*dpr));
    drawGhosts(cx,ox,oy,k,r);
    drawFrog(cx,ox,oy,k,r,r.fx,r.fy);
  }
  function hills(off,base,amp,col,fr,seed){
    for(let x=0;x<PW;x+=2){const t=(x*PX+off)*fr;const y=q(base-amp*(.55+.25*Math.sin(t+seed)+.2*Math.sin(t*2.7+seed*2)));R(col,x,y,2,PH-y);R('rgba(255,255,255,.12)',x,y,2,1);}
  }
  // камыши: «труба» из пучка стеблей с тёмной обводкой; у нижних — рогоз над краем
  function reedPal(){
    const z=zcol('mid'),k=run.zone===2?.5:.25;
    return {o:'#123a22',d:css(mixA([31,107,58],z,k)),m:css(mixA([63,154,78],z,k*.8)),l:css(mixA([127,207,106],z,k*.6)),h:css(mixA([190,240,150],z,k*.5)),
      c:'#5a3418',cl:'#8f5a2e'};
  }
  function drawReed(x,edge,top,p){
    const w=q(RW),x0=q(x)-(w>>1),e=q(edge);
    const y0=top?0:e,y1=top?e:PH;
    // тело: полосы стеблей
    R(p.o,x0,y0,w,y1-y0);
    for(let i=1;i<w-1;i++){const s=i%7;R(s===0?p.d:s<3?p.l:s===3?p.h:s<6?p.m:p.d,x0+i,y0,1,y1-y0);}
    // кромка у прохода — шире тела, как в оригинале
    const lip=6,lx0=x0-3,lw=w+6,ly=top?e-lip:e;
    R(p.o,lx0,ly,lw,lip);
    for(let i=1;i<lw-1;i++){const s=i%7;R(s===0?p.d:s<3?p.l:s===3?p.h:p.m,lx0+i,ly+1,1,lip-2);}
    if(!top){
      // рогоз: три початка торчат над краем
      for(const fx of [.25,.55,.8]){const cxp=x0+Math.round(w*fx);R(p.o,cxp,e-11,1,4);R(p.o,cxp-2,e-8,5,9);R(p.c,cxp-1,e-7,3,7);R(p.cl,cxp-1,e-7,1,4);}
    }else{
      // сверху свисают листья
      for(let i=2;i<lw-2;i+=5){const l=2+((i*7)%4);R(p.o,lx0+i,e,2,l+1);R(p.m,lx0+i,e,1,l);}
    }
  }
  const HERON=[
    '....k....','...kyk...','...kyk...','...kyk...','..kyyk...','..kyyk...','..kyyk...',
    '.kwwwwk..','kwwwkwwk.','kwwwwwwk.','kwwwwwgk.','.kwwwggk.','..kwwgk..','..kwwgk..',
    '..kwwgk..','...kwgk..','...kwgk..','...kwwgk.','...kwwgk.','...kwwgk.'];
  const HPAL={k:'#1d2b33',y:'#f2b134',w:'#f4f8fa',g:'#b9c7cf'};
  function drawHeron(g,x,bot){
    const ph=(run.t+g.heron.t)%2.6;
    let reach=0;if(ph>1.75&&ph<2.2)reach=lerp(0,62,Math.sin((ph-1.75)/.45*Math.PI));
    const hx=q(x-10),hy=q(bot-reach);
    if(ph>1.25&&ph<1.75&&Math.sin(tGlobal*20)>0){const ex=hx,ey=q(bot)-22;R('#1d2b33',ex-2,ey-1,5,12);R('#ff5a46',ex-1,ey,3,7);R('#ff5a46',ex-1,ey+8,3,2);}
    // кончик клюва — в точке удара; шея уходит под камыши
    sprite(HERON,HPAL,hx-4,hy);
    for(let y=hy+HERON.length;y<q(bot)+30;y++)sprite(['...kwwgk.'],HPAL,hx-4,y);
  }
  function drawFly(x,y,gold,t){
    const px=q(x),py=q(y),fl=Math.sin(t*40)>0;
    if(gold&&Math.sin(t*6)>-.2){R('rgba(255,210,63,.35)',px-5,py-4,11,9);}
    // крылья растут из спинки и машут вверх-вниз, глаза — спереди на голове
    const wc='rgba(235,245,255,.85)';
    if(fl){R(wc,px-3,py-4,2,3);R(wc,px,py-4,2,3);}else{R(wc,px-4,py-2,3,2);R(wc,px+1,py-2,3,2);}
    R(gold?'#f7b500':'#2b2f3a',px-2,py-1,4,3);R(gold?'#f7b500':'#2b2f3a',px+2,py-1,2,2);R('#e0405f',px+3,py-1,1,1);
  }
  /* лягушка рисуется поверх уже растянутого мира, на экранном холсте:
     спрайт поворачивается целиком, как жёсткая картинка из квадратиков,
     и его пиксели не перестраиваются на каждом наклоне.
     g — холст, ox/oy — где на нём левый верхний угол мира, k — экранных точек на пиксель */
  function drawFrog(g,ox,oy,k,r,fx,fy){
    if(r.inv>0&&Math.floor(tGlobal*14)%2)return;
    g.save();g.imageSmoothingEnabled=false;
    g.translate(ox+fx*k,oy+fy*k);g.rotate(r.rot);g.scale(-k,k);   // стикеры смотрят влево — разворачиваем по полёту
    if(frogImg)g.drawImage(frogImg,-18,-18,36,36);
    else{g.fillStyle='#5cc27a';g.fillRect(-12,-9,24,18);}
    g.restore();
  }

  /* ---------- призрак рекорда ----------
     Лучший полёт пишется по точкам каждые 50 мс (x и высота как доля экрана)
     и проигрывается полупрозрачной лягушкой. В конце он падает с нимбом —
     видно, где оборвался рекорд */
  const GH_KEY='ff.ghost.v1';
  let ghostRec=null;try{ghostRec=JSON.parse(localStorage.getItem(GH_KEY)||'null');}catch(e){}
  function ghostSample(r){
    const k=Math.floor((r.t-r.t0f)*20);if(!r.rec)r.rec=[];
    if(k>9000)return;
    while(r.rec.length<=k)r.rec.push([Math.round(r.x),Math.round(r.y/waterY*1000)]);
  }
  function ghostSave(r){
    if(!r.rec||r.score<=0||(ghostRec&&ghostRec.s>=r.score))return;
    ghostRec={s:r.score,p:r.rec};try{localStorage.setItem(GH_KEY,JSON.stringify(ghostRec));}catch(e){}
  }
  function soloGhost(r){
    const g=r.ghost;if(!g||!r.started||r.t0f==null)return null;
    const p=g.p,tt=(r.t-r.t0f)*20,i=Math.floor(tt);
    if(i>=p.length-1){const L=p[p.length-1],te=(tt-(p.length-1))/20,y0=L[1]/1000*waterY;
      return {x:L[0],y:Math.min(waterY-14,y0+.5*G*te*te),rot:Math.min(Math.PI/2,te*7),dead:te>.4};}
    const a=p[i],b=p[i+1],f=tt-i,y0=a[1]/1000*waterY,y1=b[1]/1000*waterY;
    return {x:lerp(a[0],b[0],f),y:lerp(y0,y1,f),rot:clamp((y1-y0)*20/900,-.45,.9)};
  }
  // пиксельные наряды соперников — по одному разу на наряд
  const skinPx=new Map();
  function skinImg(sk){
    if(!skinPx.has(sk)){skinPx.set(sk,null);B.bake('frogs/'+sk,256).then(c=>skinPx.set(sk,pixelate(c,36)||c)).catch(()=>B.bake('frogs/original',256).then(c=>skinPx.set(sk,pixelate(c,36))).catch(()=>{}));}
    return skinPx.get(sk)||frogImg;
  }
  function drawSprite(g,ox,oy,k,img,fx,fy,rot,alpha){
    if(!img)return;
    g.save();g.globalAlpha=alpha;g.imageSmoothingEnabled=false;
    g.translate(ox+fx*k,oy+fy*k);g.rotate(rot);g.scale(-k,k);g.drawImage(img,-18,-18,36,36);g.restore();
  }
  function haloAt(g,ox,oy,k,fx,fy,alpha){
    g.save();g.globalAlpha=alpha;const x=ox+(fx-7)*k,y=oy+(fy-27+(Math.sin(tGlobal*3)>0?0:1))*k;
    g.fillStyle='#b8860b';g.fillRect(x,y,14*k,4*k);g.fillStyle='#ffd23f';g.fillRect(x+k,y,12*k,k);g.fillRect(x,y+k,2*k,2*k);g.fillRect(x+12*k,y+k,2*k,2*k);g.fillRect(x+k,y+3*k,12*k,k);
    g.restore();
  }
  function tagAt(g,x,y,k,text,bg,fg){
    const fs=Math.max(8,Math.round(3.4*k));g.save();g.font=`${fs}px 'Press Start 2P',monospace`;g.textAlign='center';g.textBaseline='middle';
    const w=g.measureText(text).width+fs*1.1,h=fs*1.9;
    g.fillStyle='#0b1d12';g.fillRect(Math.round(x-w/2-2),Math.round(y-h/2-2),Math.round(w+4),Math.round(h+4));
    g.fillStyle=bg;g.fillRect(Math.round(x-w/2),Math.round(y-h/2),Math.round(w),Math.round(h));
    g.fillStyle=fg;g.fillText(text,Math.round(x),Math.round(y+fs*.08));g.restore();
  }
  function drawGhosts(g,ox,oy,k,r){
    const cam=X0();
    if(!r.mp){
      // соло: вместо призрака — тонкая отметка там, где оборвался рекорд
      const gr=r.ghost;if(!gr)return;
      const L=gr.p[gr.p.length-1],fx=(L[0]-cam)/PX;if(fx<-20||fx>PW+20)return;
      const passed=r.x>L[0],x=Math.round(ox+fx*k),wy=oy+q(waterY)*k;
      g.save();g.globalAlpha=passed?.35:.75;g.fillStyle='#ffd23f';
      for(let y=oy;y<wy-16*k;y+=6*k)g.fillRect(x-k/2,Math.round(y),Math.max(1,Math.round(k)),Math.round(3*k));
      g.restore();
      tagAt(g,clamp(x,ox+34*k,ox+(PW-34)*k),wy-9*k,k,passed?'РЕКОРД ПОБИТ':`РЕКОРД ${gr.s}`,passed?'#f7b500':'rgba(23,58,38,.9)',passed?'#3d2600':'#ffd23f');
      return;
    }
    for(const o of mpGhosts()){
      const fx=(o.x-cam)/PX,fy=o.y*waterY/PX;
      if(fx<-14||fx>PW+14){
        // соперник за кадром — метка у края с отрывом в метрах
        const right=fx>PW,ex=right?ox+PW*k-6:ox+6,ey=oy+clamp(fy,30,PH-60)*k,d=Math.round(Math.abs(o.x-r.x)/12);
        g.save();g.font=`${Math.max(8,Math.round(3*k))}px 'Press Start 2P',monospace`;const t=(right?'':'◀ ')+o.name.slice(0,8)+` ${right?'+':'−'}${d}м`+(right?' ▶':'');
        const w=g.measureText(t).width+12;g.restore();
        tagAt(g,right?ex-w/2:ex+w/2,ey,k*.9,t,o.a?'#173a26':'#4a3a2a',o.a?'#9dffb0':'#cfc0a0');
        continue;
      }
      drawSprite(g,ox,oy,k,skinImg(o.skin),fx,fy,o.a?o.r:Math.PI/2,o.a?.5:.35);
      if(!o.a)haloAt(g,ox,oy,k,fx,fy,.7);
      tagAt(g,ox+fx*k,oy+(fy-(o.a?26:36))*k,k,o.name.slice(0,10),o.a?'rgba(23,58,38,.8)':'rgba(74,58,42,.8)',o.a?'#fff':'#e8d9a8');
    }
  }

  /* ---------- полёт с друзьями ----------
     Комната на сервере хранит игроков, зерно уровня и время старта. Здесь —
     меню комнаты, опрос сервера (в гонке ~7 раз в секунду, в лобби — раз в секунду),
     отсчёт, призраки соперников с плавной интерполяцией и итоги */
  let room=null;   // {id, me, view, off, buf:Map, timer, busy, raceRound, shownRes}
  const mpNow=()=>Date.now()+(room?room.off||0:0);
  function mpGhosts(){
    if(!room)return [];
    const T=mpNow()-260,out=[];
    for(const p of room.view.players){
      if(p.id===room.me||!p.inRace)continue;
      const b=room.buf.get(p.id);if(!b||!b.length)continue;
      let i=b.length-1;while(i>0&&b[i-1].t>T)i--;
      const a=b[Math.max(0,i-1)],c=b[i];let o=c;
      if(a!==c&&T<c.t&&T>a.t){const f=(T-a.t)/(c.t-a.t);o={x:lerp(a.x,c.x,f),y:lerp(a.y,c.y,f),r:lerp(a.r,c.r,f),a:c.a,s:c.s};}
      else if(T>=c.t&&c.a){const ex=Math.min(.4,(T-c.t)/1000);o={...c,x:c.x+speed(c.s)*ex};}   // пакет опаздывает — чуть продлеваем движение
      out.push({...o,name:p.name||'Игрок',skin:p.skin,id:p.id});
    }
    return out;
  }
  function mpLeaderX(){let m=null;for(const o of mpGhosts())if(o.a&&(m==null||o.x>m))m=o.x;return m;}
  function mpRank(){
    if(!room||!run||!run.mp)return null;
    const others=mpGhosts(),me={x:run.x,s:run.score};
    const all=[...others.map(o=>({x:o.x,s:o.s})),me].sort((a,b)=>(b.s-a.s)||(b.x-a.x));
    return {pos:all.indexOf(me)+1,n:all.length,alive:others.filter(o=>o.a).length+(run.alive?1:0)};
  }
  function mpHud(){
    const r=run,on=!!(r&&r.mp);
    $('#ffMp').hidden=!on;$('#ffPause').style.visibility=on?'hidden':'';$('#ffLily').hidden=on;
    if(!on){$('#ffCount').hidden=true;return;}
    const rk=mpRank();
    if(rk)$('#ffPlace').innerHTML=r.alive?`МЕСТО <b>${rk.pos}</b>/${rk.n}`:`ВЫБЫЛ · <b>${rk.pos}</b>/${rk.n}<br>в полёте: ${rk.alive}`;
    $('#ffTurbo').hidden=!r.mp.boostOn;
    $('#ffTurbo').firstChild.style.width=Math.round(clamp((r.boost||0)/.5,0,1)*100)+'%';
    // отсчёт до старта
    const el=$('#ffCount');
    if(!r.started){const n=Math.ceil((r.mp.startAt-mpNow())/1000);el.hidden=false;el.classList.remove('go');
      const t=n>0?String(Math.min(n,3)):'';if(el.dataset.n!==t){el.dataset.n=t;el.innerHTML=t+'<small>ВСЕ СТАРТУЮТ ВМЕСТЕ<br><br>ТАП — ВЗМАХ И РЫВОК</small>';if(t)SND.ui();}}
    else if(r.mp.goT!=null&&tGlobal-r.mp.goT<.8){if(el.dataset.n!=='go'){el.dataset.n='go';el.classList.add('go');el.innerHTML='ЛЕТИМ!';SND.zone();}el.hidden=false;}
    else el.hidden=true;
  }
  function startMP(v){
    loadFrog();
    run=mkRun(0);
    run.mp={round:v.round,startAt:v.startAt,boostOn:!!v.boost};run.rng=mulberry(v.seed);run.boost=0;
    for(let i=0;i<4;i++)addGate(run);
    bestBefore=1e9;paused=false;hud(true);
    $('#ffOver').hidden=true;$('#ffPauseOv').hidden=true;$('#ffRes').hidden=true;$('#ffTap').hidden=true;
    room.buf=new Map();room.shownRes=0;mpHud();
  }
  function mpDied(){
    B.haptic.error&&B.haptic.error();
    banner('Ты выбыл','смотрим, кто долетит дальше');
    if(room&&room.view.state==='results')mpResults();
  }
  function mpResults(){
    const v=room.view;if(!v.results||room.shownRes===v.round)return;room.shownRes=v.round;
    const host=v.host===room.me,meR=v.results.find(x=>x.id===room.me);
    $('#ffResT').textContent=meR&&meR.place===1?'Победа!':'Итоги гонки';
    $('#ffResN').textContent=meR?`Ты ${meR.place}-й из ${v.results.length}`:'';
    $('#ffResL').innerHTML=v.results.map(x=>`<div class="fr-row${x.id===room.me?' me':''}"><div class="rk${x.place<=3?' r'+x.place:''}">${x.place}</div><img data-sk="${esc(x.skin)}" alt=""><div class="nm">${esc(x.name)}</div><div class="sc">${x.s}</div></div>`).join('');
    fillThumbs($('#ffResL'));
    $('#ffResGo').hidden=!host;
    if(meR&&meR.place===1)SND.record();else SND.zone();
    $('#ffRes').hidden=false;
  }
  $('#ffResGo').onclick=async()=>{SND.ui();const res=await B.api('roomStart',{room:room&&room.id}).catch(()=>null);if(res&&res.ok)mpApply(res.room);else B.toast&&B.toast((res&&res.error)||'Нет связи');};
  $('#ffResRoom').onclick=()=>{SND.ui();$('#ffRes').hidden=true;run=null;open=false;root.hidden=true;cancelAnimationFrame(rafId);B.setActive&&B.setActive(false);B.onClose&&B.onClose();roomOpen();};

  // обмен с сервером: в гонке — часто и со своими координатами, иначе — раз в секунду
  async function mpTick(force){
    if(!room||(room.busy&&!force))return;
    room.busy=true;
    const r=run,racing=open&&r&&r.mp&&room.view&&r.mp.round===room.view.round;
    const body={room:room.id,round:racing?r.mp.round:-1};
    if(racing)Object.assign(body,{x:Math.round(r.x),y:+(r.y/waterY).toFixed(4),rot:+r.rot.toFixed(2),a:r.alive?1:0,s:r.score});
    const t0=Date.now();
    let res=null;try{res=await B.api('roomTick',body);}catch(e){}
    room&&(room.busy=false);
    if(!room)return;
    if(res&&res.ok){const t1=Date.now(),off=res.room.now-(t0+t1)/2;room.off=room.off==null?off:lerp(room.off,off,.2);mpApply(res.room);}
    else if(res&&res.error&&(res.gone||/закрыта/.test(res.error))){B.toast&&B.toast(res.error,3000);roomDrop();}
  }
  function mpLoop(){
    if(!room)return;
    const racing=open&&run&&run.mp;
    clearTimeout(room.timer);room.timer=setTimeout(()=>{mpTick();mpLoop();},racing?140:1000);
  }
  function mpApply(v){
    if(!room)return;
    room.view=v;room.me=v.me;
    for(const p of v.players){
      if(p.id===v.me||!p.inRace||!p.t)continue;
      let b=room.buf.get(p.id);if(!b)room.buf.set(p.id,b=[]);
      if(!b.length||b[b.length-1].t<p.t){b.push({t:p.t,x:p.x,y:p.y,r:p.r,a:p.a,s:p.s});if(b.length>40)b.shift();}
      if(skinPx.size<40)skinImg(p.skin);
    }
    const mine=v.players.find(p=>p.id===v.me);
    // хост нажал «Старт» — гонка начинается у всех, где бы ни был игрок
    if(v.state==='race'&&mine&&mine.inRace&&room.raceRound!==v.round&&v.startAt-v.now>-3000){
      room.raceRound=v.round;roomClose();
      if(!open){open=true;root.hidden=false;B.setActive&&B.setActive(true);loadImgs();resize();last=0;acc=0;cancelAnimationFrame(rafId);rafId=requestAnimationFrame(frame);B.onRace&&B.onRace();}
      startMP(v);
    }
    if(v.state==='results'&&open&&run&&run.mp&&run.mp.round===v.round&&!run.alive&&run.overShown)mpResults();
    if(!rr.hidden)roomRender();
    mpLoop();
  }
  function roomDrop(){if(!room)return;clearTimeout(room.timer);room=null;if(!rr.hidden)roomRender();}

  /* ---------- меню комнаты ---------- */
  const rst=document.createElement('style');
  rst.textContent=`
#ffr{position:fixed;inset:0;z-index:185;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(3,25,17,.7);font-family:Nunito,system-ui,sans-serif}
#ffr[hidden]{display:none}
#ffr .fr-card{position:relative;width:100%;max-width:370px;max-height:calc(100% - 20px);overflow:auto;background:#e8d9a8;color:#3a2a12;box-shadow:0 0 0 4px #3a2a12,inset 0 0 0 3px #f8efcc,8px 8px 0 4px rgba(0,0,0,.35);padding:20px 16px 18px;display:flex;flex-direction:column;align-items:center;gap:14px;text-align:center}
#ffr h2{margin:0;font-family:'Press Start 2P',monospace;font-weight:400;font-size:14px;line-height:1.6;color:#c4541f;text-shadow:2px 2px 0 #f8efcc}
#ffr p{margin:0;font-size:13px;line-height:1.35;color:#5a4524;font-weight:700}
#ffr .fr-x{position:absolute;right:8px;top:8px;width:34px;height:34px;border:0;background:#d6c58e;color:#3a2a12;font-family:'Press Start 2P',monospace;font-size:12px;box-shadow:inset 0 0 0 2px #b8a46a;padding:0}
#ffr .fr-set{width:100%;display:grid;grid-template-columns:auto 1fr;gap:10px 10px;align-items:center;text-align:left}
#ffr .fr-set>span{font-family:'Press Start 2P',monospace;font-size:8px;color:#5a4524}
#ffr .fr-seg{display:flex;gap:6px}
#ffr .fr-seg button{flex:1;border:0;background:#f3e7bb;color:#3a2a12;font-family:'Press Start 2P',monospace;font-size:10px;padding:9px 4px;box-shadow:inset 0 0 0 2px #b8a46a}
#ffr .fr-seg button.on{background:#4f9a5a;color:#fff;box-shadow:inset 0 0 0 2px #2f6a3a,inset 0 -3px 0 2px #2f6a3a;text-shadow:1px 1px 0 #1f4a2a}
#ffr .fr-seg button:disabled{opacity:.6}
#ffr .fr-btn{width:100%;border:0;font-family:'Press Start 2P',monospace;font-size:11px;line-height:1.4;color:#fff;background:#f26b2a;box-shadow:0 0 0 3px #3a2a12,inset 0 -4px 0 #b8461a,inset 0 3px 0 #ff9a5c;text-shadow:2px 2px 0 #7a2a0a;padding:14px 10px 16px;margin:3px 0}
#ffr .fr-btn.g{background:#4f9a5a;box-shadow:0 0 0 3px #3a2a12,inset 0 -4px 0 #2f6a3a,inset 0 3px 0 #7fcf8a;text-shadow:2px 2px 0 #1f4a2a}
#ffr .fr-btn.q{background:#d6c58e;color:#5a4524;text-shadow:none;box-shadow:0 0 0 3px #3a2a12,inset 0 -4px 0 #b8a46a,inset 0 3px 0 #f3e7bb;font-size:9px;padding:11px 8px 13px}
#ffr .fr-btn:active{transform:translateY(2px)}
#ffr .fr-btn:disabled{filter:grayscale(.7);opacity:.7}
#ffr .fr-code{font-family:'Press Start 2P',monospace;font-size:26px;letter-spacing:4px;color:#fff;background:#173a26;padding:12px 14px 12px 18px;box-shadow:0 0 0 3px #0b1d12,inset 0 -3px 0 #0e2a1a,inset 0 3px 0 #2f6a43;border:0}
#ffr .fr-code small{display:block;font-size:7px;letter-spacing:1px;color:#9dffb0;margin-top:8px}
#ffr .fr-join{display:flex;gap:8px;width:100%}
#ffr .fr-join input{flex:1;min-width:0;border:0;background:#f3e7bb;box-shadow:inset 0 0 0 2px #b8a46a;font-family:'Press Start 2P',monospace;font-size:13px;letter-spacing:3px;padding:10px;text-transform:uppercase;color:#3a2a12;text-align:center}
#ffr .fr-join .fr-btn{width:auto;margin:3px;padding:10px 12px 12px}
#ffr .fr-or{font-family:'Press Start 2P',monospace;font-size:8px;color:#9a8656}
#ffr .fr-wait{font-family:'Press Start 2P',monospace;font-size:9px;line-height:1.7;color:#4f9a5a;animation:frBlink 1.2s steps(1) infinite}
@keyframes frBlink{50%{opacity:.4}}
#ffr .fr-rules{display:grid;grid-template-columns:28px 1fr;gap:8px;text-align:left;font-size:12.5px;font-weight:700;color:#5a4524;line-height:1.3;align-items:center}
#ffr .fr-rules b{font-family:'Press Start 2P',monospace;font-weight:400;font-size:12px;color:#fff;background:#4f9a5a;width:26px;height:26px;line-height:26px;text-align:center;box-shadow:0 0 0 2px #2f6a3a}
`;
  document.head.appendChild(rst);
  const rr=document.createElement('div');rr.id='ffr';rr.hidden=true;
  rr.innerHTML='<div class="fr-card"><button class="fr-x" aria-label="Закрыть">X</button><div class="fr-body" style="width:100%;display:flex;flex-direction:column;align-items:center;gap:14px"></div></div>';
  document.body.appendChild(rr);
  const $r=s=>rr.querySelector(s);
  $r('.fr-x').onclick=()=>{SND.ui();roomClose();};
  rr.addEventListener('pointerdown',e=>{if(e.target===rr){roomClose();}});
  let roomCfg={max:6,boost:true},roomSig='';
  function roomClose(){rr.hidden=true;roomSig='';}
  function fillThumbs(el){el.querySelectorAll('img[data-sk]').forEach(im=>{const sk=im.dataset.sk;const c=skinPx.get(sk);if(c&&c.toDataURL)im.src=c.toDataURL();else{skinImg(sk);setTimeout(()=>{const c2=skinPx.get(sk);if(c2&&c2.toDataURL)im.src=c2.toDataURL();},900);}});}
  const seg=(key,opts,val,dis)=>`<div class="fr-seg" data-k="${key}">${opts.map(([v,t])=>`<button data-v="${v}" class="${String(v)===String(val)?'on':''}"${dis?' disabled':''}>${t}</button>`).join('')}</div>`;
  function roomRender(){
    const body=$r('.fr-body'),v=room&&room.view;
    const sig=JSON.stringify(v?{s:v.state,r:v.round,h:v.host,m:v.max,b:v.boost,p:v.players.map(p=>p.id+p.inRace)}:roomCfg)+!!room;
    if(sig===roomSig)return;roomSig=sig;
    if(!room){
      body.innerHTML=`<h2>Полёт<br>с друзьями</h2>
        <div class="fr-rules"><b>1</b><span>Создай комнату и отправь ссылку друзьям</span><b>2</b><span>Все взлетают одновременно — соперники летят рядом призраками и не мешают</span><b>3</b><span>Каждый взмах и пойманная мошка — короткий рывок вперёд</span><b>4</b><span>Кто пролетит больше камышей — победил</span></div>
        <div class="fr-set"><span>ИГРОКОВ</span>${seg('max',[[2,'2'],[4,'4'],[6,'6'],[8,'8']],roomCfg.max)}<span>РЫВКИ</span>${seg('boost',[[1,'ВКЛ'],[0,'ВЫКЛ']],roomCfg.boost?1:0)}</div>
        <button class="fr-btn" id="frNew">Создать комнату</button>
        <div class="fr-or">— ИЛИ ВВЕДИ КОД —</div>
        <div class="fr-join"><input id="frCode" maxlength="5" autocomplete="off" placeholder="КОД"><button class="fr-btn g" id="frJoin">ОК</button></div>`;
      body.querySelectorAll('.fr-seg button').forEach(b=>b.onclick=()=>{SND.ui();const k=b.parentNode.dataset.k;roomCfg[k]=k==='boost'?b.dataset.v==='1':+b.dataset.v;roomRender();});
      $r('#frNew').onclick=async e=>{SND.ui();e.target.disabled=true;const res=await B.api('roomCreate',roomCfg).catch(()=>null);e.target.disabled=false;
        if(res&&res.ok){room={id:res.room.id,me:res.room.me,view:res.room,buf:new Map(),off:null};mpApply(res.room);B.haptic.medium&&B.haptic.medium();}
        else B.toast&&B.toast((res&&res.error)||'Нет связи с сервером');};
      $r('#frJoin').onclick=()=>{const c=$r('#frCode').value.trim().toUpperCase();if(c.length<5){B.toast&&B.toast('Код — 5 символов');return;}SND.ui();roomJoin(c);};
      return;
    }
    const host=v.host===room.me,P=v.players,racing=v.state==='race';
    const rows=P.map(p=>`<div class="fr-row${p.id===room.me?' me':''}"><div class="rk">${P.indexOf(p)+1}</div><img data-sk="${esc(p.skin)}" alt=""><div class="nm">${esc(p.name)}${p.id===v.host?'<span class="fr-tag">ХОСТ</span>':''}${p.id===room.me?'<small>это ты</small>':''}</div><div class="sc"></div></div>`).join('')
      +[...Array(Math.max(0,v.max-P.length))].map(()=>'<div class="fr-row empty">свободно</div>').join('');
    const mine=P.find(p=>p.id===room.me);
    body.innerHTML=`<h2>Комната</h2>
      <button class="fr-code" id="frCopy">${v.id}<small>НАЖМИ, ЧТОБЫ СКОПИРОВАТЬ</small></button>
      <div class="fr-list">${rows}</div>
      ${host&&!racing?`<div class="fr-set"><span>ИГРОКОВ</span>${seg('max',[[2,'2'],[4,'4'],[6,'6'],[8,'8']],v.max)}<span>РЫВКИ</span>${seg('boost',[[1,'ВКЛ'],[0,'ВЫКЛ']],v.boost?1:0)}</div>`
        :`<p>Рывки за взмах: ${v.boost?'включены':'выключены'}</p>`}
      <button class="fr-btn g" id="frShare">Позвать друзей</button>
      ${racing?(mine&&mine.inRace?'<button class="fr-btn" id="frBack">Вернуться в гонку</button>':'<div class="fr-wait">ИДЁТ ГОНКА —<br>ТЫ В СЛЕДУЮЩЕМ РАУНДЕ</div>')
        :host?`<button class="fr-btn" id="frGo"${P.length<2&&!B.dev?' disabled':''}>Старт · ${P.length} ${P.length===1?'игрок':P.length<5?'игрока':'игроков'}</button>${P.length<2?'<p>Нужен хотя бы один друг — отправь ему ссылку</p>':''}`
        :'<div class="fr-wait">ЖДЁМ, КОГДА ХОСТ<br>НАЖМЁТ СТАРТ</div>'}
      <button class="fr-btn q" id="frLeave">Выйти из комнаты</button>`;
    fillThumbs(body);
    body.querySelectorAll('.fr-seg button').forEach(b=>b.onclick=async()=>{SND.ui();const k=b.parentNode.dataset.k,val=k==='boost'?b.dataset.v==='1':+b.dataset.v;
      const res=await B.api('roomSet',{room:room.id,[k]:val}).catch(()=>null);if(res&&res.ok)mpApply(res.room);else B.toast&&B.toast((res&&res.error)||'Нет связи');});
    $r('#frCopy').onclick=()=>{SND.ui();const l=B.roomLink(v.id);try{navigator.clipboard.writeText(l);B.toast&&B.toast('Ссылка скопирована');}catch(e){B.toast&&B.toast(l,5000);}};
    $r('#frShare').onclick=()=>{SND.ui();B.share(B.roomLink(v.id),`Полетели наперегонки во Flappy Frog! Комната ${v.id} — заходи, стартуем вместе`);};
    $r('#frLeave').onclick=async()=>{SND.ui();const id=room.id;roomDrop();B.api('roomLeave',{room:id}).catch(()=>{});};
    const go=$r('#frGo');if(go)go.onclick=async()=>{SND.ui();go.disabled=true;const res=await B.api('roomStart',{room:room.id}).catch(()=>null);go.disabled=false;if(res&&res.ok)mpApply(res.room);else B.toast&&B.toast((res&&res.error)||'Нет связи');};
    const bk=$r('#frBack');if(bk)bk.onclick=()=>{room.raceRound=null;mpApply(room.view);};
  }
  async function roomJoin(code){
    const res=await B.api('roomJoin',{room:code}).catch(()=>null);
    if(res&&res.ok){room={id:res.room.id,me:res.room.me,view:res.room,buf:new Map(),off:null};rr.hidden=false;roomSig='';mpApply(res.room);B.haptic.medium&&B.haptic.medium();}
    else{B.toast&&B.toast((res&&res.error)||'Нет связи с сервером',3000);rr.hidden=false;roomRender();}
  }
  function roomOpen(code){
    if(!hasApi()){B.toast&&B.toast('Игра с друзьями работает в Telegram');return;}
    rr.hidden=false;roomSig='';
    if(code&&(!room||room.id!==code.toUpperCase()))roomJoin(code);else{roomRender();if(room)mpTick(true);}
  }

  /* ---------- цикл ---------- */
  function frame(ts){
    if(!open)return;
    rafId=requestAnimationFrame(frame);
    if(!last)last=ts;let dt=Math.min(.05,(ts-last)/1000);last=ts;
    if(!run)return;
    if(!paused){acc+=dt;while(acc>=STEP){update(STEP);acc-=STEP;}}
    if(run.mp)mpHud();
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
  /* живая картинка для карточки в хабе: тот же пиксельный мир,
     лягушка сама пролетает проходы. Крутится, только пока карточка видна */
  let hubCv=null,hubRaf=0,hubLast=0,demo=null,demoKey='';
  function hubArt(c){hubCv=c;loadFrog();if(!hubRaf)hubRaf=requestAnimationFrame(hubTick);}
  function hubTick(ts){
    hubRaf=0;const c=hubCv;
    if(!c||!c.isConnected)return;
    if(open||!c.offsetParent||document.hidden){hubLast=0;setTimeout(()=>{if(!hubRaf)hubRaf=requestAnimationFrame(hubTick);},400);return;}
    hubRaf=requestAnimationFrame(hubTick);
    const dt=hubLast?Math.min(.05,(ts-hubLast)/1000):0;hubLast=ts;
    const sv={VH,waterY,run};
    VH=Math.round(W*c.clientHeight/Math.max(1,c.clientWidth));waterY=VH-14;
    const key=VH+'';
    if(!demo||demoKey!==key){
      demoKey=key;demo=mkRun(0);demo.started=true;demo.y=VH*.45;demo.pads=demo.pads.slice(0,3);
      demo.clouds.forEach(k=>{k.y=rnd(VH*.06,VH*.3);});demo.motes=[];
      for(let i=0;i<3;i++)demo.gates.push({x:W*.75+i*SPACING*.8,y:rnd(VH*.4,VH*.5),h:VH*.48,amp:0,ph:0,heron:null});
    }
    const d=demo;run=d;
    d.t+=dt;tGlobal+=0;d.x+=95*dt;
    const cam=d.x-W*.3;
    for(const g of d.gates)if(g.x-cam<-RW){g.x=Math.max(...d.gates.map(x=>x.x))+SPACING*.8;g.y=rnd(VH*.38,VH*.52);}
    // автопилот: взмах, когда опустились ниже центра следующего прохода
    const ng=d.gates.filter(g=>g.x>d.x-RW*.4).sort((a,b)=>a.x-b.x)[0];
    d.vy+=G*.55*dt;d.y+=d.vy*dt;
    if(ng&&d.y>ng.y+8&&d.vy>0)d.vy=FLAP*.6;
    d.rot=clamp(d.vy/700,-.5,.9);
    drawWorld();
    const cw=Math.round(c.clientWidth*Math.min(2,window.devicePixelRatio||1)),ch=Math.round(cw*PH/PW);
    if(c.width!==cw||c.height!==ch){c.width=cw;c.height=ch;}
    const g=c.getContext('2d');g.imageSmoothingEnabled=false;g.drawImage(lo,0,0,cw,ch);
    drawFrog(g,0,0,cw/PW,d,d.fx,d.fy);
    VH=sv.VH;waterY=sv.waterY;run=sv.run;
  }
  // пиксельный стикер наряда — для карточки в хабе
  function pixelFrog(slug){return B.bake('frogs/'+(slug||'original'),256).then(c=>{const p=pixelate(c,36);if(!p)throw 0;
    const o=document.createElement('canvas');o.width=o.height=36;o.getContext('2d').drawImage(p,0,0);return o.toDataURL();});}
  // только локально: доступ к забегу и журнал звуков — для записи промо-ролика
  if(/^(localhost|127\.0\.0\.1)$/.test(location.hostname)){
    window.__ffRun=()=>run;window.__ffEv=[];
    window.__ffSkin=k=>{const n=B.net();(n.jump=n.jump||{}).skin=k;frogSlug='';loadFrog();};window.__ffFrogUrl=()=>frogImg?frogImg.toDataURL():'';
    for(const k in SND){const f=SND[k];SND[k]=(...a)=>{window.__ffEv.push({k,a,t:Date.now()});return f(...a);};}
  }
  return {open:openGame,close,isOpen:()=>open,pixelFrog,hubArt,room:roomOpen};
};
})();
