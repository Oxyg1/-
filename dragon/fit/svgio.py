"""Read/write the tracing template (absolute M/C/Z paths) as editable anchor structures."""
import re

PATH_RE = re.compile(r'<path id="([^"]+)" d="([^"]+)"\s*/>')


class Path:
    def __init__(self, pid, d):
        self.id = pid
        toks = re.findall(r'[MCZ]|-?\d+(?:\.\d+)?', d)
        self.cmds = []  # list of (cmd, [[x,y],...])
        cur = None
        for t in toks:
            if t in 'MCZ':
                cur = [t, []]
                self.cmds.append(cur)
            else:
                cur[1].append(float(t))
        self.cmds = [(c, [list(v[i:i + 2]) for i in range(0, len(v), 2)]) for c, v in self.cmds]
        self.closed = any(c == 'Z' for c, _ in self.cmds)

    def anchors(self):
        """list of (anchor_ref, [handle_refs]) — refs are the coordinate lists themselves (mutable)."""
        out = []
        segs = [p for c, p in self.cmds if c == 'C']
        m = self.cmds[0][1][0]
        # anchor 0 = M point; its out-handle = first C's c1; in-handle = last C's c2 if closed and last C ends on M
        pts = [(m, [])]
        for s in segs:
            pts[-1][1].append(s[0])          # out handle of previous anchor
            pts.append((s[2], [s[1]]))        # new anchor with its in handle
        if self.closed and segs and abs(segs[-1][2][0] - m[0]) < 0.05 and abs(segs[-1][2][1] - m[1]) < 0.05:
            # last anchor duplicates M: merge its handles into anchor 0, keep refs in sync
            last = pts.pop()
            pts[0][1].extend(last[1])
            pts[0] = (pts[0][0], pts[0][1] + [last[0]])  # the duplicate end point moves with anchor 0
        return pts

    def all_points(self):
        return [pt for _, ps in self.cmds for pt in ps]

    def d(self):
        out = []
        for c, ps in self.cmds:
            out.append(c + ''.join(' %.1f %.1f' % (x, y) for x, y in ps))
        return ' '.join(out)


def load(path):
    s = open(path).read()
    return s, {pid: Path(pid, d) for pid, d in PATH_RE.findall(s)}


def save(src, paths, out):
    def rep(m):
        p = paths[m.group(1)]
        return '<path id="%s" d="%s"/>' % (p.id, p.d())
    open(out, 'w').write(PATH_RE.sub(rep, src))
