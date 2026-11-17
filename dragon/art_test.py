import sys
sys.path.insert(0, "/home/user/-/dragon")
import art
from motion import track, dumps
from art_preview import render
A = {
 "turn": [(0,0,"in-out"),(20,1,"in-out"),(40,1,"in-out"),(60,0,"in-out")],
 "lid.near": track((0,0,"in-out"),(30,0,"in-out"),(35,1,"in-out"),(40,0,"in-out"),(60,0)),
 "lid.far": track((0,0,"in-out"),(30,0.5,"in-out"),(40,0,"in-out"),(60,0)),
 "arm.r": track((0,0,"in-out"),(20,110,"in-out"),(40,110,"in-out"),(60,0)),
 "arm.outline": track((0,0,"in-out"),(20,1,"in-out"),(40,1,"in-out"),(60,0)),
 "mouth.open": track((0,0,"in-out"),(25,0,"in-out"),(32,1,"in-out"),(40,0,"in-out"),(60,0)),
 "head.r": track((0,0,"in-out"),(8,-4,"in-out"),(20,0,"in-out"),(60,0)),
}
doc = art.build_doc(A); doc["op"]=60
for l in doc["layers"]: l["op"]=60
open("build/art_test.json","w").write(dumps(doc))
for bg,n in (("#17212B","dark"),("#FFFFFF","white")):
    render("build/art_test.json","0,10,20,30,40,50,60",bg,"build/test_"+n)
