# 一期: line-level match of notice rows vs active contract billing lines; groups months with identical residue.
# read-only; writes out/p1-lines.txt
import json, collections, itertools
from decimal import Decimal as D
import p1_compare as P   # reuses loaders/mapping (p1_compare runs on import; cheap)

TAX=[D(1),D('1.128'),D('1.03'),D('1.09'),D('1.06'),D('1.05'),D('1.13')]
def taxmatch(a,b):
    if a is None or b is None: return None
    if abs(a-b)<=D('0.06'): return 'eq'
    if b and a:
        r=a/b
        for t in TAX[1:]:
            if abs(r-t)<D('0.0015'): return f'x{t}'
    return None
def nrow(r):
    k=P.cat(r.get('fee') or r.get('item'),r.get('location'))
    area=P.N(r.get('buildArea') or r.get('area') or r.get('billArea') or r.get('innerArea') or r.get('shareArea'))
    price=P.N(r.get('unitPrice')) if P.N(r.get('unitPrice')) is not None else P.N(r.get('shareUnitPrice'))
    mo=P.N(r.get('monthly'))
    if mo is None and area is not None and price is not None: mo=area*price
    if mo is None: mo=P.N(r.get('amount'))
    return {'row':r['row'],'cat':k,'loc':r.get('location') or '','fee':r.get('fee') or r.get('item') or '','area':area,'price':price,'mo':mo,
            'raw':{x:r[x] for x in r if x not in ('row','locFilled','feeFromLocation')}}
def dline(l):
    return {'id':l['id'],'cid':l['contract_id'],'cat':P.KEYCAT[l['fee_key']],'fk':l['fee_key'],'pt':l['property_type'],'loc':l['location'],
            'area':P.N(l['area']),'price':P.N(l['unit_price']),'mo':P.lm(l),'mode':l['bill_mode'],'coeff':l['coeff'],'sh':l['area_shared'],'src':l['source'],'rooms':l['room_count']}
def fmtn(x): return f"R{x['row']} {x['fee']}@{x['loc']} a={x['area']} p={x['price']} mo={x['mo']}"
def fmtd(x): return f"L{x['id']}(C{x['cid']}) {x['fk']}/{x['pt']}@{x['loc']} a={x['area']} p={x['price']} mo={x['mo']} {x['mode']} sh={x['sh']} {x['src']}"
COMPARE={'rent','rent_land','mgmt','infra','elevator','transformer','land_tax','access','network'}
def match(nr,dl):
    nr=[x for x in nr if x['cat'] in COMPARE and x['mo'] not in (None,D(0))]
    dl=[x for x in dl if x['cat'] in COMPARE and x['mo'] not in (None,)]
    used=set(); un=[]; notes=[]
    for x in nr:
        best=None
        for y in dl:
            if y['id'] in used: continue
            catok = x['cat']==y['cat'] or (x['cat']=='rent' and y['cat']=='rent_land') or (x['cat']=='rent_land' and y['cat']=='rent')
            if not catok: continue
            t=taxmatch(x['mo'],y['mo'])
            if t: best=(y,t); break
        if best:
            used.add(best[0]['id'])
            if best[1]!='eq': notes.append(f"tax{best[1]}:{x['cat']}")
            if x['cat']!=best[0]['cat']: notes.append(f"CATMISMATCH R{x['row']} {x['fee']}@{x['loc']} vs {best[0]['fk']} L{best[0]['id']}")
            continue
        un.append(x)
    # subset-sum for leftovers (dorm splits)
    left=[]
    for x in un:
        pool=[y for y in dl if y['id'] not in used and y['cat']==x['cat']]
        hit=None
        for k in range(2,5):
            for comb in itertools.combinations(pool,k):
                if taxmatch(x['mo'],sum(c['mo'] for c in comb)): hit=comb; break
            if hit: break
        if hit:
            for c in hit: used.add(c['id'])
        else: left.append(x)
    return left,[y for y in dl if y['id'] not in used],notes
out=[]
res={}
for sh in sorted(P.by):
    ids=P.tid_of(sh); allc=[c for i in ids for c in P.cons[i]]
    months=collections.defaultdict(list)
    for n in P.by[sh]: months[n['ym']].append(n)
    groups=collections.OrderedDict()
    for ym in sorted(months):
        nr=[nrow(r) for n in months[ym] for r in n['rows']]
        act=[c for c in allc if P.active(c,ym)]
        dl=[dline(l) for c in act for l in P.terms[c['id']]]
        # capacity
        left,dleft,notes=match(nr,dl)
        key=(tuple(sorted((x['cat'],str(x['area']),str(x['price']),str(x['mo']),x['loc']) for x in left)),tuple(sorted(y['id'] for y in dleft)),tuple(c['id'] for c in act))
        g=groups.setdefault(key,{'months':[],'left':left,'dleft':dleft,'act':act,'notes':set(),'tot':[]})
        g['months'].append(ym); g['notes'].update(notes); g['tot'].append((ym,[n['total'] for n in months[ym]]))
    out.append(f"## {sh} -> {sorted(ids)}")
    ok=True
    for key,g in groups.items():
        st='OK' if not g['left'] and not g['dleft'] else 'DIFF'
        if st=='DIFF': ok=False
        out.append(f"  [{st}] {g['months'][0]}..{g['months'][-1]} ({len(g['months'])}m) act={[c['contract_no'] for c in g['act']]} notes={sorted(g['notes'])}")
        for x in g['left']: out.append('     SRC-ONLY '+fmtn(x))
        for y in g['dleft']: out.append('     DB-ONLY  '+fmtd(y))
    res[sh]=ok
open('out/p1-lines.txt','w',encoding='utf-8').write('\n'.join(out))
print(sum(res.values()),'ok of',len(res))
print([k for k,v in res.items() if v])
