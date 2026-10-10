# Build fonts/MKChicago.woff2 from chicago-12px.json:
#   pip install fonttools brotli
#   python3 tools/font/build-font.py tools/font/chicago-12px.json fonts/MKChicago
import json, sys
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen

P = 128          # font units per pixel
EM = 12 * P      # 12 px em, Chicago's native size
BASE = 12        # baseline row in the raster
X0 = 4           # raster x origin
g = json.load(open(sys.argv[1]))

# Hand-drawn glyphs missing from ChicagoFLF (rows top..baseline-1, width)
custom = {
 '→': (11, ["...........", "...........", "...........", "...........", "......#....", "......##...", "#########..", "#########..", "......##...", "......#....", "...........", "..........."]),
 '←': (11, ["...........", "...........", "...........", "...........", "...#.......", "..##.......", ".#########.", ".#########.", "..##.......", "...#.......", "...........", "..........."]),
 '↑': (8,  ["........", "........", "...##...", "..####..", ".######.", "...##...", "...##...", "...##...", "...##...", "...##...", "...##...", "........"]),
 '↓': (8,  ["........", "........", "...##...", "...##...", "...##...", "...##...", "...##...", "...##...", ".######.", "..####..", "...##...", "........"]),
 '✗': (9,  [".........", ".........", ".........", ".##...##.", ".##...##.", "..##.##..", "...###...", "..##.##..", ".##...##.", ".##...##.", ".........", "........."]),
}
# Hand-drawn replacements: (width, first_row, rows) with x relative to the origin.
redraw = {
 '%': (12, 3, [".###...##.", "##.##..##.", "##.##.##..", ".###.##...", ".....##...", "....##.###.", "...##.##.##", "...##.##.##", "..##...###."]),
 '&': (9, 3, ["..###...", ".##.##..", ".##.##..", "..###...", ".###.##.", "##.###..", "##..##..", "##.####.", ".###..##"]),
 '<': (8, 4, [".....##", "...##..", ".##....", "##.....", ".##....", "...##..", ".....##"]),
 '>': (8, 4, ["##.....", "..##...", "....##.", ".....##", "....##.", "..##...", "##....."]),
 '`': (4, 3, ["##..", ".##."]),
}
# Chicago 12 descenders are three pixels deep: (char, rows 12-14)
desc = {
 'g': [".....##", ".#...##", "..####."],
 'y': [".....##", ".#...##", "..####."],
 'j': ["...##", "#..##", ".###."],
 'p': [".##", ".##", ".##"],
 'q': [".....##", ".....##", ".....##"],
}
glyphs = {}
for ch, v in g.items():
    if v['fb'] and ch not in custom: continue
    if ch in custom:
        w, rows = custom[ch]
        bits = [(x, y) for y, r in enumerate(rows) for x, c in enumerate(r) if c == '#']
    elif ch in redraw:
        w, top, rows = redraw[ch]
        bits = [(x, top + y) for y, r in enumerate(rows) for x, c in enumerate(r) if c == '#']
    else:
        w = round(v['w'])
        bits = [(x - X0, y) for y, r in enumerate(v['rows']) for x, c in enumerate(r) if c == '#']
        if ch in desc:
            bits = [(x, y) for x, y in bits if y < BASE]
            bits += [(x, BASE + y) for y, r in enumerate(desc[ch]) for x, c in enumerate(r) if c == '#']
    glyphs[ch] = (w, bits)

names = {' ': 'space'}
order = ['.notdef'] + ['uni%04X' % ord(c) if c not in names else names[c] for c in glyphs]
cmap = {ord(c): ('uni%04X' % ord(c) if c not in names else names[c]) for c in glyphs}

def draw(bits):
    pen = TTGlyphPen(None)
    rows = {}
    for x, y in bits: rows.setdefault(y, []).append(x)
    for y, xs in rows.items():
        xs.sort(); start = prev = xs[0]
        runs = []
        for x in xs[1:]:
            if x == prev + 1: prev = x; continue
            runs.append((start, prev)); start = prev = x
        runs.append((start, prev))
        for a, b in runs:
            top = (BASE - y) * P + 2      # tiny overlap with row above avoids seams
            bot = (BASE - y - 1) * P
            l, r = a * P, (b + 1) * P
            pen.moveTo((l, bot)); pen.lineTo((l, top)); pen.lineTo((r, top)); pen.lineTo((r, bot)); pen.closePath()
    return pen.glyph()

fb = FontBuilder(EM, isTTF=True)
fb.setupGlyphOrder(order)
fb.setupCharacterMap(cmap)
pen = TTGlyphPen(None)
pen.moveTo((P, 0)); pen.lineTo((P, 9 * P)); pen.lineTo((6 * P, 9 * P)); pen.lineTo((6 * P, 0)); pen.closePath()
tt = {'.notdef': pen.glyph()}
metrics = {'.notdef': (7 * P, P)}
for ch, (w, bits) in glyphs.items():
    n = cmap[ord(ch)]
    tt[n] = draw(bits)
    xs = [x for x, _ in bits]
    metrics[n] = (w * P, (min(xs) * P) if xs else 0)
fb.setupGlyf(tt)
fb.setupHorizontalMetrics(metrics)
ASC, DESC = 12 * P, 4 * P
fb.setupHorizontalHeader(ascent=ASC, descent=-DESC)
fb.setupNameTable({'familyName': 'MK Chicago', 'styleName': 'Regular',
  'copyright': 'Pixel rasterization of ChicagoFLF (public domain, Robin Casady). Public domain.',
  'uniqueFontIdentifier': 'MKChicago-Regular-1.0', 'fullName': 'MK Chicago Regular', 'psName': 'MKChicago-Regular', 'version': 'Version 1.0'})
fb.setupOS2(sTypoAscender=ASC, sTypoDescender=-DESC, sTypoLineGap=0, usWinAscent=ASC, usWinDescent=DESC, sxHeight=7 * P, sCapHeight=9 * P, fsSelection=0x40 | 0x80)
fb.setupPost()
pass
fb.font.flavor = 'woff2'
fb.save(sys.argv[2] + '.woff2')
print(len(glyphs), 'glyphs')
