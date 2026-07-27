# -*- coding: utf-8 -*-
"""多场地混装全量清查(2026-07-27):找出疑似"多份纸约被合并/一纸约多场地未理期"的租户,
输出 demo3/multi-premise-audit.tsv 供逐户配纸约。信号沉淀自 仁恒/碳紫/可莱恩 三例修复。
跑法: python multi_premise_audit.py
"""
import io, re, subprocess, sys
from collections import defaultdict

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
OUT = r'C:\financial_dashboard\demo3\multi-premise-audit.tsv'
FIXED = {'仁恒', '碳紫', '可莱恩'}

def db(sql):
    p = subprocess.run(['docker', 'exec', '-i', 'demo3-mysql', 'sh', '-c',
        'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" --default-character-set=utf8mb4 --batch park_demo3'],
        input=sql.encode('utf-8'), capture_output=True)
    return [r.split('\t') for r in p.stdout.decode('utf-8', 'replace').splitlines()[1:] if r]

CJ = {'8': '一', '9': '二', '10': '三', '11': '四', '12': '五', '13': '六'}
def building_of(loc):
    s = str(loc).replace(' ', '')
    if re.search(r'宿舍|保障房|新俊楼', s): return '宿舍'
    m = re.search(r'(8|9|10|11|12|13)[号栋座]', s)
    if m: return f'二期{CJ[m.group(1)]}车间'
    m = re.search(r'[（(]?([一二三四五六])车间', s)
    if m: return f'二期{m.group(1)}车间'
    m = re.search(r'([A-G])座', s)
    if m: return f'一期{m.group(1)}座'
    if '空地' in s: return '空地'
    if re.search(r'车位|手续费|维修|放行|饭堂|保证金', s): return None   # 杂费
    return '?'

GARBAGE = re.compile(r'车位|手续费|放行条|维修费')

rows = db("""SELECT c.id, c.contract_no, t.company_name, COALESCE(b.name,''), COALESCE(b.phase,0),
  c.status, COALESCE(c.link_type,''), COALESCE(c.term_type,''), COALESCE(c.term_text,''), c.start_date, c.end_date,
  (SELECT COUNT(*) FROM contract_billing_term x WHERE x.contract_id=c.id)
FROM contract c JOIN tenant t ON t.id=c.tenant_id LEFT JOIN building b ON b.id=c.building_id;""")
lines = db("SELECT contract_id, COALESCE(location,''), COALESCE(property_type,''), fee_key FROM contract_billing_term;")

locs_by_c = defaultdict(list)
for cid, loc, pt, fk in lines:
    locs_by_c[int(cid)].append((loc, pt, fk))

by_tenant = defaultdict(list)
meta = {}
for cid, no, tn, bld, phase, status, lt, tt, ttext, sd, ed, nl in rows:
    cid = int(cid)
    meta[cid] = dict(no=no, tenant=tn, bld=bld, phase=int(phase), status=status, link=lt,
                     ttype=tt, ttext=ttext, sd=sd, ed=ed, nl=int(nl))
    by_tenant[tn].append(cid)

findings = []
for tn, cids in sorted(by_tenant.items()):
    if tn in FIXED: continue
    if all(meta[c]['phase'] == 3 for c in cids): continue   # 三期不动
    shells = [c for c in cids if meta[c]['nl'] == 0 and meta[c]['status'] in ('active', 'renewed')]
    for cid in cids:
        m = meta[cid]
        if m['phase'] == 3 or m['nl'] == 0: continue
        ls = locs_by_c.get(cid, [])
        locgroups = sorted({l for l, _, _ in ls if l})
        blds = sorted({b for b in (building_of(l) for l in locgroups) if b and b != '?'})
        ptypes = sorted({p for _, p, _ in ls if p})
        garbage = sorted({l for l, _, _ in ls if GARBAGE.search(l)})
        dorm_mixed = '宿舍' in blds and len(blds) > 1
        cross = len([b for b in blds if b != '宿舍']) > 1
        multi_loc = len(locgroups) > 1
        sig = []
        if cross: sig.append('跨楼栋标的段')
        if dorm_mixed: sig.append('宿舍块混入')
        if shells: sig.append(f"同租户空壳×{len(shells)}({';'.join(meta[s]['no'] + '@' + meta[s]['bld'] for s in shells)})")
        if garbage: sig.append(f"杂费行({';'.join(garbage)})")
        if m['ttype'] == 'multiple' and m['link'] == 'new' and not any(
                meta[k]['link'] == 'escalation' for k in cids): sig.append('多段期限未拆链')
        if '商议' in m['ttext'] or '市场价' in m['ttext']: sig.append('商议段')
        if not sig and not multi_loc: continue
        grade = 'A' if (cross or dorm_mixed) else ('B' if (multi_loc or shells) else 'C')
        if sig or multi_loc:
            findings.append((grade, tn, m['no'], m['bld'], f"{m['sd']}~{m['ed']}",
                             len(locgroups), ' | '.join(locgroups)[:90], ','.join(ptypes),
                             '; '.join(sig) or '仅多位置'))
    # 商议段空壳(单列,如 C2024M-008 同类)
    for s in shells:
        m = meta[s]
        if '商议' in m['ttext'] or '市场价' in m['ttext']:
            findings.append(('C', tn, m['no'], m['bld'], f"{m['sd']}~{m['ed']}", 0, '',
                             '', '商议段造的空壳续签(候删)'))

findings.sort(key=lambda x: (x[0], x[1]))
with open(OUT, 'w', encoding='utf-8') as f:
    f.write('级\t租户\t合同\t现挂楼栋\t租期\t位置块数\t位置清单\t物业类型\t信号\n')
    for r in findings:
        f.write('\t'.join(str(x) for x in r) + '\n')
n = defaultdict(int)
for g, *_ in findings: n[g] += 1
print(f"清查完成 → {OUT}")
print(f"A级(跨栋/宿舍混入,疑多纸约需拆): {n['A']}  B级(多位置/有空壳,需理期核对): {n['B']}  C级(杂项清理): {n['C']}")
for r in findings:
    if r[0] == 'A': print(' A', r[1], r[2], '|', r[8])
