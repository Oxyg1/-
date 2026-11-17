import sys, subprocess, json
sys.path.insert(0, "/home/user/-/dragon")
import art
from motion import dumps
from PIL import Image

R = "node /home/user/obeskay/lottie-animator-skill/scripts/render.mjs"

def write(doc, path):
    open(path, "w").write(dumps(doc))

def render(js, frames, bg, out):
    subprocess.run(f'{R} {js} --frames {frames} --bg "{bg}" --out {out}', shell=True, check=True,
                   stdout=subprocess.DEVNULL)

def overlay(png, out):
    c = Image.open("/home/user/-/dragon/ref/concept.png").convert("RGB")
    c = c.resize((round(c.width*.7), round(c.height*.7)))
    base = Image.new("RGB", (512, 512), (23, 33, 43))
    base.paste(c, (30, 63))
    d = Image.open(png).convert("RGB").resize((512, 512))
    ov = Image.blend(base, d, 0.5)
    sheet = Image.new("RGB", (1536, 512))
    sheet.paste(base, (0, 0)); sheet.paste(d, (512, 0)); sheet.paste(ov, (1024, 0))
    sheet.save(out)
    box=(60,80,512,420)
    a=base.crop(box).resize((904,680)); b=d.crop(box).resize((904,680)); o=ov.crop(box).resize((904,680))
    big=Image.new("RGB",(1808,1360)); big.paste(a,(0,0)); big.paste(b,(904,0)); big.paste(o,(0,680)); 
    big.paste(Image.blend(base,d,0.5).crop(box).resize((904,680)),(904,680)); big.save(out.replace(".png","_big.png"))

if __name__ == "__main__":
    write(art.static_comp(), "build/art_P.json")
    render("build/art_P.json", 0, "#17212B", "build/prev_P")
    import glob
    f = sorted(glob.glob("build/prev_P/*.png"))
    print(f)
    p = [x for x in f if "filmstrip" not in x][0]
    overlay(p, "build/overlay_P.png")
