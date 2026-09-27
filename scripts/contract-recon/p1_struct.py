# 一期 structural checks on contracts of matched tenants: R15 cache drift, R06 天面/空地 as building rent,
# R07 line-shape anomalies, R12 kva on undated shells, R14 unbound rent lines. read-only -> out/p1-struct.txt
import json, collections
from decimal import Decimal as D
import p1_compare as P
db=P.db
btu=collections.defaultdict(list)
for b in db['btu']: btu[b['term_id']].append(b['unit_id'])
cu=collections.defaultdict(list)
for x in db['contract_unit']: cu[x['contract_id']].append(x['unit_id'])
tids=set()
for sh in P.by: tids|=P.tid_of(sh)
P1B={b['id'] for b in db['building'] if b['phase'] in (1,4)}
out=[]
def dedup(lines,keys):
    s=set(); tot=D(0)
    for l in lines:
        if l['fee_key'] in keys and l['area'] is not None:
            k=(l['location'],l['fee_key'],P.N(l['area']).normalize())
            if k not in s: s.add(k); tot+=P.N(l['area'])
    return tot
for c in sorted(P.db['contract'],key=lambda c:c['id']):
    if c['tenant_id'] not in tids or c['building_id'] not in P1B: continue
    L=P.terms[c['id']]
    tag=f"C{c['id']} {c['contract_no']} t{c['tenant_id']} {P.T[c['tenant_id']]['company_name']} {c['start_date']}~{c['end_date']}"
    mr=sum((P.lm(l) or D(0)) for l in L)
    if L and abs(mr-P.N(c['monthly_rent']))>D('0.01'): out.append(f"R15-MR {tag} monthly_rent={c['monthly_rent']} Σlines={mr}")
    has=any(l['fee_key'] in ('rent_factory','rent_office','rent_shop','rent_dorm') for l in L)
    ra=dedup(L,{'rent_factory','rent_office','rent_shop'}) if has else dedup(L,{'infra'})
    if L and abs(ra-P.N(c['rent_area']))>D('0.01'): out.append(f"R15-RA {tag} rent_area={c['rent_area']} Σ={ra}")
    for l in L:
        loc=l['location'] or ''
        if l['fee_key'] in ('rent_factory','rent_office','rent_shop') and any(k in loc for k in ('天面','空地','绿化','通道')):
            out.append(f"R06-LAND-AS-BUILDING {tag} L{l['id']} {l['fee_key']}/{l['property_type']} @{loc} a={l['area']} p={l['unit_price']}")
        if l['fee_key']=='rent_land' and l['property_type']!='land':
            out.append(f"R06-PT {tag} L{l['id']} rent_land/{l['property_type']} @{loc}")
        if l['fee_key']=='access' and l['bill_mode']=='per_room_year' and P.N(l['unit_price']) not in (D(100),):
            out.append(f"R07-ACCESS {tag} L{l['id']} per_room_year up={l['unit_price']} rooms={l['room_count']} mo={P.lm(l)}")
        if l['fee_key'] in ('access','network') and l['bill_mode'] in ('per_room_year','per_room_month') and not l['room_count']:
            out.append(f"R07-ROOMS {tag} L{l['id']} {l['fee_key']} {l['bill_mode']} room_count=NULL -> 0/月")
        if l['fee_key'] in ('elevator','transformer','other') and l['bill_mode']=='per_month' and (P.N(l['amount_override']) or D(0))==0:
            out.append(f"R07-ZERO {tag} L{l['id']} {l['fee_key']} per_month override={l['amount_override']}")
        if l['fee_key'] in ('mgmt','infra','rent_factory','rent_office','rent_shop','rent_dorm','rent_land') and l['bill_mode']=='per_sqm_month' and (P.N(l['unit_price']) or 0)==0:
            out.append(f"R07-ZEROPRICE {tag} L{l['id']} {l['fee_key']} per_sqm_month up=0 a={l['area']}")
        if l['property_type'] and l['fee_key'] not in {'factory':{'rent_factory','mgmt','infra','elevator','transformer','land_tax','other'},'office':{'rent_office','mgmt','infra','elevator','transformer','land_tax','other'},'dorm':{'rent_dorm','infra','access','network','land_tax','other'},'shop':{'rent_shop','infra','mgmt','transformer','land_tax','other'},'land':{'rent_land','infra','land_tax','other'}}[l['property_type']]:
            out.append(f"R07-ALLOWED {tag} L{l['id']} {l['fee_key']} not allowed in {l['property_type']}")
        if l['fee_key'] in ('rent_factory','rent_office','rent_shop','rent_dorm') and not btu[l['id']]:
            out.append(f"R14-UNBOUND {tag} L{l['id']} {l['fee_key']} @{loc}")
    if (not c['start_date'] or not c['end_date']):
        out.append(f"UNDATED {tag} lines={len(L)} mr={c['monthly_rent']} kva={c['kva']} remark={(c['remark'] or '')[:80]}")
    if not L and c['start_date'] and 'SIM' not in c['contract_no'] and 'HIST' not in c['contract_no']:
        out.append(f"NOLINES {tag} rent_area={c['rent_area']} mr={c['monthly_rent']} remark={(c['remark'] or '')[:80]}")
    if c['status'] not in ('active',): out.append(f"STATUS {tag} status={c['status']}")
open('out/p1-struct.txt','w',encoding='utf-8').write('\n'.join(out))
import collections as C
print(C.Counter(x.split()[0] for x in out))
