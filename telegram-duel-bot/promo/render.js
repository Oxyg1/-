// Покадровый рендер promo.html → frames/*.png (1080×1920, 30 fps)
const {chromium}=require('playwright');const fs=require('fs');const path=require('path');
(async()=>{const FPS=30,DUR=21,out=path.join(__dirname,'frames');fs.mkdirSync(out,{recursive:true});
const b=await chromium.launch();const p=await b.newPage({viewport:{width:540,height:675},deviceScaleFactor:2});
await p.goto('file://'+path.join(__dirname,'promo.html'));await p.waitForTimeout(500);
for(let i=0;i<FPS*DUR;i++){await p.evaluate(t=>render(t),i/FPS);await p.screenshot({path:path.join(out,String(i).padStart(4,'0')+'.png')})}
await b.close()})();
