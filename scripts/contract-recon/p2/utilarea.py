# 水电费册 路灯/绿化水公摊面积 vs 合同分摊面积(只读)
import json, calendar
from collections import defaultdict
from decimal import Decimal as D
import pymysql
OUT = 'C:/financial_dashboard/demo3/scripts/contract-recon/'
u = json.load(open(OUT + 'out/utility-area.json', encoding='utf-8'))
c = pymysql.connect(host='127.0.0.1', port=13306, user='root', password='root', database='park_demo3', charset='utf8mb4')
cur = c.cursor(pymysql.cursors.DictCursor)
cur.execute("select id, company_name, aliases from tenant")
ten = cur.fetchall()
def match(name):
    hits = [t for t in ten if t['company_name'] and (t['company_name'] in name or name in t['company_name'])
            or any(a and (a in name) for a in (t['aliases'] or '').split(','))]
    return hits
cur.execute("select * from contract where kind<>'master_lease' and status<>'draft'")
cons = defaultdict(list)
for r in cur.fetchall(): cons[r['tenant_id']].append(r)
cur.execute("select * from contract_billing_term")
lines = defaultdict(list)
for l in cur.fetchall(): lines[l['contract_id']].append(l)
BR = {'rent_factory', 'rent_office', 'rent_shop'}
agg = defaultdict(lambda: defaultdict(set))
for r in u:
    if r['zone'] != '二期': continue
    for p in r['light'] + r['green']:
        if p.get('room'): continue  # 宿舍段
        agg[(r['tenant'], r['sheet'])][r['ym']].add(((p.get('pool') or '')[:6], D(p['area'])))
for (name, sheet), months in sorted(agg.items()):
    ts = match(name) or match(sheet)
    for ym in sorted(months):
        y, m = map(int, ym.split('-')); first = ym + '-01'; last = f'{ym}-{calendar.monthrange(y, m)[1]:02d}'
        srcA = sorted({a for _, a in months[ym]})
        dbA = []; info = []
        for t in ts:
            for k in cons.get(t['id'], []):
                if not (k['start_date'] and k['end_date'] and str(k['start_date']) <= last and str(k['end_date']) >= first): continue
                ls = lines[k['id']]
                rent = [l for l in ls if l['fee_key'] in BR]
                if rent: a = sum((l['area'] or 0) + (l['area_shared'] or 0) for l in rent); kind = 'rent'
                else: a = sum((l['area'] or 0) for l in ls if l['fee_key'] == 'infra' and l['property_type'] != 'dorm'); kind = 'infra'
                if a: dbA.append(a); info.append(f"{k['contract_no']}:{kind}{a}")
        ok = sum(srcA) == sum(dbA) or (len(srcA) == len(dbA) and srcA == sorted(dbA))
        print(('   ' if ok else '!! ') + f"{name}/{sheet} {ym} src={[str(a) for a in srcA]} db={info} tenants={[t['id'] for t in ts]}")
