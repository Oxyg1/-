const {chromium}=require('playwright');const fs=require('fs');
(async()=>{const [svg,img,out]=process.argv.slice(2);
const b=await chromium.launch();const p=await b.newPage({viewport:{width:2000,height:1609}});
const s=fs.readFileSync(svg,'utf8');const im='data:image/jpeg;base64,'+fs.readFileSync(img).toString('base64');
await p.setContent(`<body style="margin:0"><div style="position:relative;width:2000px;height:1609px"><img src="${im}" style="position:absolute;left:0;top:0;width:2000px;height:1609px"><div style="position:absolute;left:0;top:0">${s}</div></div></body>`);
await p.screenshot({path:out});await b.close();})();
