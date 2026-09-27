# Digest 一期 notices: per sheet, distinct row signatures across months
import json, collections
d=json.load(open('out/all.json',encoding='utf-8'))
ns=[n for n in d['notices'] if n['zone']=='一期']
by=collections.defaultdict(list)
for n in ns: by[n['sheet']].append(n)
lines=[]
def f(x):
    if x is None: return ''
    try:
        v=float(x); return ('%.4f'%v).rstrip('0').rstrip('.')
    except: return str(x)
for sh in sorted(by):
    L=by[sh]
    months=sorted(set(n['ym'] for n in L))
    addrs=collections.Counter(n['addressee'] for n in L)
    lines.append(f"## SHEET {sh} | months {months[0]}..{months[-1]} ({len(months)}) | addr {dict(addrs)} | hidden={set(n['sheetState'] for n in L)}")
    sig=collections.OrderedDict()
    for n in sorted(L,key=lambda n:(n['ym'],n['notice'])):
        rows=[]
        for r in n['rows']:
            keys=['location','fee','item','room','rooms','coef','taxRate','landArea','buildArea','shareArea','innerArea','billArea','area','unitPrice','unitPriceExTax','shareUnitPrice','monthly','colC','colD','position']
            rows.append(' / '.join(f"{k}={f(r[k])}" for k in keys if r.get(k) not in (None,'')))
        key=(n['kind'],tuple(rows))
        sig.setdefault(key,[]).append(f"{n['ym'][2:]}({f(n['total'])})")
    for (kind,rows),ms in sig.items():
        lines.append(f"  [{kind}] months: {', '.join(ms)}")
        for r in rows: lines.append('     '+r)
open('out/p1-digest.txt','w',encoding='utf-8').write('\n'.join(lines))
print(len(by), len(lines))
