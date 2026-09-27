# 把 executor.chunk01..05 重排成「每行 ≤1200 字符」的粘贴段(live/ 目录),便于逐段读出再贴进线上页面。
# chunk01(执行器代码)去掉纯注释行;chunk02..05 的变更集 JSON 用 String.raw 分行拼接,最后一段 JSON.parse 后照原顺序 add + seal。
# 校验在 repack_check.mjs:新旧两套在 node:vm 里各装一遍,比 __cx.ops 与 exe/sum 完全一致。
import io, json, os, re

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'live')
os.makedirs(OUT, exist_ok=True)
for f in os.listdir(OUT):
    os.remove(os.path.join(OUT, f))
rd = lambda n: io.open(os.path.join(HERE, n), encoding='utf-8', newline='').read()

# ── chunk01:去掉纯注释行(// 开头、/* … */ 块),其余原样 ──
src = rd('executor.chunk01.js').replace('\r\n', '\n')
out, in_block = [], False
for line in src.split('\n'):
    s = line.strip()
    if in_block:
        if '*/' in s:
            in_block = False
        continue
    if s.startswith('/*'):
        if '*/' not in s:
            in_block = True
        continue
    if s.startswith('//'):
        continue
    out.append(line)
code = '\n'.join(out)
assert max(len(l) for l in out) <= 1200, max(len(l) for l in out)

# ── chunk02..05:取出 add(k,[...]) 的 JSON ──
data, pre05, seal = {}, None, None
for k in (2, 3, 4, 5):
    t = rd(f'executor.chunk0{k}.js').strip()
    if k == 5:
        i = t.index(f'window.__cx.add(5,')
        pre05 = t[:i]
        t = t[i:]
        j = t.rindex('window.__cx.seal(')
        seal = t[j:]
        t = t[:j]
    assert t.startswith(f'window.__cx.add({k},') and t.endswith(');'), (k, t[:40], t[-10:])
    data[k] = t[len(f'window.__cx.add({k},'):-2]
    json.loads(data[k])

# String.raw 分片:不能含反引号与 ${,片尾不能是反斜杠
def pieces(s, n=1100):
    assert '`' not in s and '${' not in s
    res, i = [], 0
    while i < len(s):
        j = min(i + n, len(s))
        while j < len(s) and s[j - 1] == '\\':
            j -= 1
        res.append(s[i:j])
        i = j
    return res

parts = []
parts.append(code)
BUDGET = 24000
for k in (2, 3, 4, 5):
    ps = pieces(data[k])
    cur, size = [], 0
    for p in ps:
        if size + len(p) > BUDGET and cur:
            parts.append('window.__cxd=window.__cxd||{};window.__cxd[%d]=(window.__cxd[%d]||"")+\n' % (k, k)
                         + '+\n'.join('String.raw`' + x + '`' for x in cur) + ';"d%d+"+window.__cxd[%d].length' % (k, k))
            cur, size = [], 0
        cur.append(p); size += len(p)
    if cur:
        parts.append('window.__cxd=window.__cxd||{};window.__cxd[%d]=(window.__cxd[%d]||"")+\n' % (k, k)
                     + '+\n'.join('String.raw`' + x + '`' for x in cur) + ';"d%d+"+window.__cxd[%d].length' % (k, k))
lens = {k: len(data[k]) for k in data}
final = (pre05 + '\n'
         + ''.join('if(window.__cxd[%d].length!==%d)throw new Error("段%d长度不对:"+window.__cxd[%d].length);\n' % (k, lens[k], k, k) for k in (2, 3, 4, 5))
         + ''.join('window.__cx.add(%d,JSON.parse(window.__cxd[%d]));\n' % (k, k) for k in (2, 3, 4, 5))
         + seal)
parts.append(final)
for i, p in enumerate(parts, 1):
    io.open(os.path.join(OUT, 'p%02d.js' % i), 'w', encoding='utf-8', newline='\n').write(p)
print(len(parts), 'parts', [len(p) for p in parts], 'total', sum(len(p) for p in parts), 'lens', lens)
