# 二期户合同标量缓存/面积/天面/单元绑定体检(只读)
from collections import defaultdict
from decimal import Decimal as D
import pymysql
c = pymysql.connect(host='127.0.0.1', port=13306, user='root', password='root', database='park_demo3', charset='utf8mb4')
cur = c.cursor(pymysql.cursors.DictCursor)
cur.execute("""select c.*, t.company_name from contract c join tenant t on t.id=c.tenant_id
  where c.building_id in (15,16,30,31,32,33,34,35,38) or c.tenant_id in (select id from tenant where phase=2) or c.tenant_id in (375,376,377,378,379,380,360)""")
cons = cur.fetchall()
cur.execute("select * from contract_billing_term")
lines = defaultdict(list)
for l in cur.fetchall(): lines[l['contract_id']].append(l)
cur.execute("select term_id, count(*) n from billing_term_unit group by term_id")
bound = {r['term_id']: r['n'] for r in cur.fetchall()}
NONDORM = {'rent_factory', 'rent_office', 'rent_shop'}
def lm(l, kva):
    m = l['bill_mode']; up = l['unit_price'] or D(0)
    if m == 'per_sqm_month': return None if l['area'] is None or l['unit_price'] is None else (l['area'] * up * (l['coeff'] or 1)).quantize(D('0.01'))
    if m == 'per_room_year': return None if not l['room_count'] else (up * l['room_count'] / 12).quantize(D('0.01'))
    if m == 'per_room_month': return None if not l['room_count'] else (up * l['room_count']).quantize(D('0.01'))
    if m == 'per_kva_month': return kva
    return l['amount_override']
for k in sorted(cons, key=lambda k: (k['tenant_id'], k['id'])):
    ls = lines[k['id']]
    s = sum((lm(l, k['kva']) or D(0)) for l in ls)
    seen = set(); ra = D(0)
    has_rent = any(l['fee_key'] in NONDORM | {'rent_dorm', 'rent_land'} for l in ls)
    for l in ls:
        if l['fee_key'] in (NONDORM if has_rent else {'infra'}):
            key = (l['location'], l['fee_key'], (l['area'] or D(0)).normalize())
            if key not in seen: seen.add(key); ra += l['area'] or D(0)
    probs = []
    if abs(s - (k['monthly_rent'] or 0)) > D('0.01'): probs.append(f"rent缓存{k['monthly_rent']}≠Σ行{s}")
    if abs(ra - (k['rent_area'] or 0)) > D('0.01'): probs.append(f"rent_area{k['rent_area']}≠Σ{ra}")
    nulls = [l['id'] for l in ls if lm(l, k['kva']) is None]
    if nulls: probs.append(f"缺参数行{nulls}")
    for l in ls:
        if ('天面' in (l['location'] or '') or '空地' in (l['location'] or '')) and l['fee_key'] != 'rent_land' and l['fee_key'].startswith('rent'):
            probs.append(f"天面/空地行L{l['id']}={l['fee_key']}/{l['property_type']} a={l['area']}")
        if l['fee_key'] == 'rent_land' and l['property_type'] != 'land': probs.append(f"L{l['id']} rent_land 挂 {l['property_type']}")
        if l['fee_key'] in NONDORM | {'rent_dorm'} and l['id'] not in bound and (l['area'] or 0) > 0: probs.append(f"未绑单元L{l['id']}")
    if probs:
        print(f"T{k['tenant_id']} {k['company_name']} C{k['id']} {k['contract_no']} ({k['start_date']}~{k['end_date']},{k['kind']},{k['status']},b{k['building_id']}): " + '; '.join(probs))
