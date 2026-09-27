# 一期 water/elec book shared-charge (路灯) area vs contract apportion area (Σ non-dorm building rent area+area_shared).
# read-only -> out/p1-util.txt
import json, collections
from decimal import Decimal as D
import p1_compare as P
U=json.load(open('out/utility-area.json',encoding='utf-8'))
EXTRA={'宇劲':[395],'开利暖通':[111],'李李商铺':[145],'炳记':[142],'诺玲':[158],'鑫皇':[113],'速新企业':[397,374],'速新宿舍':[397,374],
       '王伍平宿舍':[382],'建奕':[280],'雷莱':[114],'曼克维':[95],'文广':[380],'保安宿舍':[387,399],'工程队宿舍':[385,388],
       '工程队宿舍（朱锐）':[388],'工程队宿舍（陈道文）':[385],'公交车站':[126],'个人宿舍':[],'大为':[],'张勇':[163]}
def ids(sh):
    if sh in EXTRA: return P.fam(EXTRA[sh])
    if sh in P.auto or sh in P.MANUAL: return P.tid_of(sh)
    return set()
out=[]; rows=collections.defaultdict(list)
for r in U:
    if r['zone']!='一期': continue
    la=sum((P.N(x['area']) for x in r.get('light',[]) if 'room' not in x), D(0))
    ga=sum((P.N(x['area']) for x in r.get('green',[]) if 'room' not in x), D(0))
    t=ids(r['sheet'])
    act=[c for i in t for c in P.cons[i] if P.active(c,r['ym'])]
    seen=set(); da=D(0)
    for c in act:
        for l in P.terms[c['id']]:
            if l['fee_key'] in ('rent_factory','rent_office','rent_shop') and l['area'] is not None:
                k=(l['location'],l['fee_key'],P.N(l['area']).normalize())
                if k in seen: continue
                seen.add(k); da+=P.N(l['area'])+(P.N(l['area_shared']) or D(0))
    rows[r['sheet']].append((r['ym'],la,ga,da,[c['contract_no'] for c in act],[(x['block'].replace('\n',''),x['area'],x['row']) for x in r.get('light',[]) if 'room' not in x]))
for sh,L in sorted(rows.items()):
    bad=[x for x in L if x[1] and abs(x[1]-x[3])>D('0.5')]
    if not bad: continue
    out.append(f"## {sh} ids={sorted(ids(sh))}")
    for ym,la,ga,da,act,blocks in L:
        flag='  ' if not la or abs(la-da)<=D('0.5') else '!!'
        out.append(f"  {flag}{ym} light={la} green={ga} db={da} act={act} {blocks}")
open('out/p1-util.txt','w',encoding='utf-8').write('\n'.join(out))
print(len(out))
