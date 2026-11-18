import sys, svgio, edges, snap
SRC = '../template/dragon_template.svg'
LINE_PARTS = ['body', 'head', 'jaw', 'horn_left', 'horn_right', 'spike_head_1', 'spike_head_2', 'spike_head_3',
              'spike_back_1', 'wing_lobe', 'wing_main', 'tail', 'foot_front_far', 'leg_front_near',
              'leg_front_near_line', 'hind_leg', 'hind_leg_line', 'mouth_line', 'eye_near_outer', 'belly']
frame = sys.argv[1]; out = sys.argv[2]
src, P = svgio.load(SRC)
F = edges.ridge_map(frame)
rep = snap.snap(P, LINE_PARTS, F)
svgio.save(src, P, out)
for k, v in rep.items(): print('%-20s %.1f' % (k, v))
