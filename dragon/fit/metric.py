import sys, numpy as np, svgio, edges, snap
def path_score(p, F):
    vals = []
    for p0, c1, c2, p1 in snap.segments(p):
        pts = snap.bez(*map(np.array, (p0, c1, c2, p1)), np.linspace(0, 1, 20))
        vals.append(snap.sample_field(F, pts))
    return float(np.concatenate(vals).mean()) if vals else 0
if __name__ == '__main__':
    F = edges.ridge_map(sys.argv[1])
    files = sys.argv[2:]
    Ps = [svgio.load(f)[1] for f in files]
    for pid in Ps[0]:
        print('%-22s' % pid + ''.join('%7.2f' % path_score(P[pid], F) for P in Ps))
