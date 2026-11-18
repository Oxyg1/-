const {chromium}=require('playwright');const fs=require('fs');
(async()=>{
const d=JSON.parse(fs.readFileSync('/home/user/-/dragon/ref/kissed-frog-original.json','utf8'));
d.layers.forEach((l,i)=>{l.ln='L'+l.ind;});
const lib=fs.readFileSync('/home/user/obeskay/lottie-animator-skill/node_modules/lottie-web/build/player/lottie.min.js','utf8');
const b=await chromium.launch();const p=await b.newPage({viewport:{width:512,height:512}});
await p.setContent('<body style="margin:0"><div id="c" style="width:512px;height:512px"></div></body>');
await p.addScriptTag({content:lib});
const res=await p.evaluate((data)=>{
  const a=lottie.loadAnimation({container:document.getElementById('c'),renderer:'svg',loop:false,autoplay:false,animationData:data});
  a.goToAndStop(0,true);
  const svg=document.querySelector('svg');const out=[];
  svg.querySelectorAll('path').forEach(pa=>{
    const dd=pa.getAttribute('d'); if(!dd) return;
    // find owning layer
    let g=pa, layer=null; while(g&&g!==svg){ if(g.id&&g.id.startsWith('L')){layer=g.id;break;} g=g.parentNode;}
    let vis=true, e=pa; while(e&&e!==svg){const cs=getComputedStyle(e); if(cs.display==='none'||cs.opacity==='0'){vis=false;break;} e=e.parentNode;}
    const m=pa.getCTM(); const svgm=svg.getCTM();
    out.push({layer,d:dd,vis,fill:pa.getAttribute('fill'),stroke:pa.getAttribute('stroke'),sw:pa.getAttribute('stroke-width'),m:[m.a,m.b,m.c,m.d,m.e,m.f]});
  });
  return out;
},d);
fs.writeFileSync(process.argv[2],JSON.stringify(res));await b.close();})();
