# 源册月份覆盖 vs 系统在租合同覆盖(2023-07..2024-03),含二期楼合同的全部户
import json, calendar
from collections import defaultdict
import pymysql
exec(open('compare.py', encoding='utf-8').read().split('def fk(')[0].split('import pymysql')[1])  # SHEET2T/ADDR2T/P2B
a = json.load(open(OUT + 'out/all.json', encoding='utf-8'))
MONTHS = ['2023-07','2023-08','2023-09','2023-10','2023-11','2023-12','2024-01','2024-02','2024-03']
src = defaultdict(dict)
for x in a['notices']:
    if x['zone'] != '二期' or '@' in x['book']: continue
    tid = ADDR2T.get(x['addressee'], SHEET2T.get(x['sheet']))
    src[tid][x['bookYm']] = src[tid].get(x['bookYm'], 0) + float(x['total'] or 0)
c = pymysql.connect(host='127.0.0.1', port=13306, user='root', password='root', database='park_demo3', charset='utf8mb4')
cur = c.cursor(pymysql.cursors.DictCursor)
cur.execute("select c.*, t.company_name from contract c join tenant t on t.id=c.tenant_id where c.building_id in (15,16,30,31,32,33,34,35,38) or c.tenant_id in (select id from tenant where phase=2)")
cons = defaultdict(list)
for r in cur.fetchall(): cons[r['tenant_id']].append(r)
cur.execute("select tenant_id, min(period_year*100+period_month) mn, max(period_year*100+period_month) mx from monthly_ledger group by tenant_id")
led = {r['tenant_id']: (r['mn'], r['mx']) for r in cur.fetchall()}
for tid in sorted(set(cons) | {t for t in src if t}):
    row = []
    for ym in MONTHS:
        y, m = map(int, ym.split('-')); first = ym + '-01'; last = f'{ym}-{calendar.monthrange(y, m)[1]:02d}'
        eff = [k for k in cons.get(tid, []) if k['kind'] != 'master_lease' and k['status'] != 'draft' and k['start_date'] and k['end_date']
               and str(k['start_date']) <= last and str(k['end_date']) >= first and k['building_id'] in P2B]
        s = ym in src.get(tid, {})
        row.append(('S' if s else '.') + ('C' if eff else '.'))
    name = (cons.get(tid) or [{'company_name': '?'}])[0]['company_name']
    flag = any(r in ('S.', '.C') for r in row)
    print(('!! ' if flag else '   ') + f"T{tid} {name}: " + ' '.join(row) + f" | ledger={led.get(tid)} | " +
          '; '.join(f"{k['contract_no']}({k['start_date']}~{k['end_date']},{k['kind']},{k['status']},b{k['building_id']},rent={k['monthly_rent']})" for k in cons.get(tid, [])))
