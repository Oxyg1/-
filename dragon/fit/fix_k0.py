"""Re-sync K0's lips/cavity/tongue/teeth to its mouth_line (writes build/K0_snapped.svg from the .orig copy)."""
import svgio, mouth
src, P = svgio.load('../build/K0_snapped.orig.svg')
P0 = svgio.load('../build/K0_snapped.orig.svg')[1]
mouth.sync_closed(P, P0)
# parked far eye: a tiny disc (bbox diagonal < 6 canvas px, so the assembler hides it) on the snout-bridge silhouette
from warp import ellipse_pts as E
for pid, r, k in (('eye_far_outer', 4.5, 8), ('eye_far_ring', 3.5, 8), ('eye_far_iris', 2.3, 8), ('eye_far_shine', 1.2, 4)):
    mouth.place(P[pid], {i + 1: tuple(p) for i, p in enumerate(E(478, 514, r, r, 0, k=k))})
# smooth the zig-zag at the haunch (foot cluster of hind_leg, hind_leg_line) so it does not read as a crack
mouth.place(P['hind_leg'], {3: (1185, 1262), 4: (1140, 1272), 5: (1091, 1277)})
mouth.place(P['hind_leg_line'], {1: (1092, 1278), 2: (1160, 1268), 3: (1235, 1245), 4: (1320, 1170), 5: (1395, 1090)})
svgio.save(src, P, '../build/K0_snapped.svg')
