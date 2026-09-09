"""Собирает игру в один HTML-файл со встроенными ассетами (стикеры + иконки).
Запуск: python build.py  ->  dist/frog-merge.html (полный документ) и dist/frog-merge-artifact.html (без html/head/body — для встраивания)."""
import base64, glob, os, re
here=os.path.dirname(os.path.abspath(__file__))
src=open(os.path.join(here,'index.html'),encoding='utf-8').read()
levels=open(os.path.join(here,'levels.js'),encoding='utf-8').read()
cats=open(os.path.join(here,'cats.js'),encoding='utf-8').read()
backdrops=open(os.path.join(here,'backdrops.js'),encoding='utf-8').read()
# ключ встраивания — с папкой вида: слаги original/loader есть и у лягушек, и у котов
embed={}
for d in ('frogs','cats'):
    for f in sorted(glob.glob(os.path.join(here,d,'*.tgs'))):
        embed[d+'/'+os.path.splitext(os.path.basename(f))[0]]=base64.b64encode(open(f,'rb').read()).decode()
icons={}
for f in sorted(glob.glob(os.path.join(here,'icons','*.png'))):
    icons[os.path.basename(f)]='data:image/png;base64,'+base64.b64encode(open(f,'rb').read()).decode()
embed_js='window.EMBED='+'{'+','.join(f'"{k}":"{v}"' for k,v in embed.items())+'};'
out=src.replace('<script src="levels.js"></script>','<script>\n'+levels+cats+backdrops+'\n'+embed_js+'\n</script>')
out=out.replace('<script src="cats.js"></script>','')
out=out.replace('<script src="backdrops.js"></script>','')
for name,uri in icons.items():
    out=out.replace('icons/'+name,uri)
os.makedirs(os.path.join(here,'dist'),exist_ok=True)
open(os.path.join(here,'dist','frog-merge.html'),'w',encoding='utf-8').write(out)
# artifact variant: strip document wrapper tags
art=re.sub(r'<!doctype html>\s*|</?html[^>]*>\s*|</?head>\s*|</?body>\s*|<meta[^>]*>\s*','',out,flags=re.I)
open(os.path.join(here,'dist','frog-merge-artifact.html'),'w',encoding='utf-8').write(art)
print('frogs',len(embed),'icons',len(icons),'size',round(len(out)/1024/1024,2),'MB')
