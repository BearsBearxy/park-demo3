# -*- coding: utf-8 -*-
"""基础容量(kVA)回填(用户拍板 2026-07-27):从一期/二期 2024-02 水电册统计表提取各租户报装容量,
写入 contract.kva(整链盖章:同链所有段同值)。
跑法: python kva_import.py plan|apply   (plan 落 demo3/kva-import-plan.tsv 人审;apply 执行 SQL)
源表:
  P1《一期2024年2月水电费.xlsx》sheet'2024年2月电费总表':商业col3/工业col13/居民col23 三段基础容量,租户名续行前向填充
  P2《二期2024年2月水电费.xlsx》sheet'本月用电数据统计':一至四车间col3/五、六车间col13
规则:按位置文本解析楼栋对位合同;同租户多行同链求和(如方凯鑫 125+18.75);歧义进 MANUAL;
     翔海不在总表(账外)不经此路——其 2130kVA 由 MANUAL 清单人工定。
"""
import io, os, re, subprocess, sys
import pandas as pd
from collections import defaultdict

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
HERE = os.path.dirname(os.path.abspath(__file__))
DEMO3 = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
PLAN_TSV = os.path.join(DEMO3, 'kva-import-plan.tsv')
BASE = r'C:/financial_dashboard/2025全年发生额、预算对比/2024年/2024年3月费用数据/2024年3月费用数据'

ALIAS = {'锂鹏': '锂朋', '彭建宜': '彭健宜', '诺玲': '诺铃', '合源': '合源创盈',
         '可盈餐厅': '可盈', '精锐佳': '禹晨', '保奔路汽车': '保奔路'}
AMBIG = {'欧培仪'}   # P1 总表该行实为雷莱(跨表别名),且 DB 两名并存 → 人工

def db(sql, flags='--batch'):
    p = subprocess.run(['docker', 'exec', '-i', 'demo3-mysql', 'sh', '-c',
        f'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" --default-character-set=utf8mb4 {flags} park_demo3'],
        input=sql.encode('utf-8'), capture_output=True)
    if p.returncode != 0:
        raise RuntimeError(p.stderr.decode('utf-8', 'replace'))
    return p.stdout.decode('utf-8', 'replace')

def parse_kva(v):
    m = re.match(r'([\d.]+)\s*千伏安', str(v).replace(' ', ''))
    return float(m.group(1)) if m else None

CJ = {'8': '一', '9': '二', '10': '三', '11': '四', '12': '五', '13': '六'}
def building_of(loc, phase):
    s = str(loc).replace(' ', '')
    if phase == 2:
        m = re.search(r'(8|9|10|11|12|13)栋', s)
        if m: return f'二期 {CJ[m.group(1)]}车间'
        m = re.search(r'[（(]?([一二三四五六])车间', s)
        if m: return f'二期 {m.group(1)}车间'
        return None
    m = re.search(r'([A-G])座', s)
    if m: return f'一期 {m.group(1)}座'
    if '宿舍' in s: return '宿舍'   # 模糊,靠租户合同唯一性兜底
    return None

def extract():
    rows = []
    d1 = pd.read_excel(BASE + r'/一期/一期2024年2月水电费.xlsx', sheet_name='2024年2月电费总表', header=None)
    name = None
    for i in range(3, len(d1)):
        n = str(d1.iloc[i, 1]).strip()
        if n and n != 'nan' and '合计' not in n and '电费单' not in n and '盈亏' not in n:
            name = n
        if name is None or '合计' in str(d1.iloc[i, 1]):
            continue
        loc = str(d1.iloc[i, 2]).strip()
        for col in (3, 13, 23):   # 商业/工业/居民 三段基础容量
            k = parse_kva(d1.iloc[i, col])
            if k and k > 0:
                rows.append(dict(phase=1, name=name, loc=loc, kva=k))
    d2 = pd.read_excel(BASE + r'/二期/二期2024年2月水电费.xlsx', sheet_name='本月用电数据统计', header=None)
    name = None
    for i in range(3, len(d2)):
        n = str(d2.iloc[i, 1]).strip()
        if n and n != 'nan' and '合计' not in n:
            name = n
        if name is None:
            continue
        loc = str(d2.iloc[i, 2]).strip()
        for col in (3, 13):   # 一至四车间/五、六车间 两段基础容量
            k = parse_kva(d2.iloc[i, col])
            if k and k > 0:
                rows.append(dict(phase=2, name=name, loc=loc, kva=k))
    return rows

def build_plan():
    rows = extract()
    tenants = {r.split('\t')[1].strip(): int(r.split('\t')[0])
               for r in db('SELECT id, company_name FROM tenant;').splitlines()[1:] if r}
    crows = [r.split('\t') for r in db(
        "SELECT c.id, c.tenant_id, COALESCE(c.parent_contract_id,0), COALESCE(b.name,''), c.contract_no, COALESCE(c.kva,-1)"
        " FROM contract c LEFT JOIN building b ON b.id=c.building_id;").splitlines()[1:] if r]
    by_tenant = defaultdict(list)
    parent = {}
    for cid, tid, pid, bname, cno, kva in crows:
        cid, tid, pid = int(cid), int(tid), int(pid)
        by_tenant[tid].append(dict(id=cid, bld=bname, no=cno, kva=float(kva)))
        parent[cid] = pid

    def chain_root(cid):
        seen = set()
        while parent.get(cid, 0) and cid not in seen:
            seen.add(cid); cid = parent[cid]
        return cid
    chain_of = defaultdict(set)
    for cid in parent:
        chain_of[chain_root(cid)].add(cid)

    # 逐行解析→租户→按楼栋筛→链;同链多行求和
    per_chain = defaultdict(lambda: dict(kva=0.0, srcs=[], contracts=set(), tenant='', note=set()))
    manual = []
    for r in rows:
        nm = ALIAS.get(r['name'], r['name'])
        if r['name'] in AMBIG or nm in AMBIG:
            manual.append((r, 'ambiguous-alias(欧培仪↔雷莱)')); continue
        tid = tenants.get(nm)
        if tid is None:
            hits = [t for t in tenants if nm in t or t in nm]
            if len(hits) == 1: tid = tenants[hits[0]]
            else: manual.append((r, f'tenant-match:{len(hits)}')); continue
        cs = by_tenant.get(tid, [])
        if not cs:
            manual.append((r, 'no-contract')); continue
        want = building_of(r['loc'], r['phase'])
        if want and want != '宿舍':
            cand = [c for c in cs if c['bld'] == want]
            if not cand:   # 解析出了楼栋但该租户无此栋合同(疑同名/跨主体,如邓宇峰10栋401) → 人工
                manual.append((r, f'no-contract-in-building:{want}')); continue
        elif want == '宿舍':
            cand = [c for c in cs if '宿舍' in c['bld']] or cs
        else:
            cand = cs
        roots = {chain_root(c['id']) for c in cand}
        if len(roots) > 1:
            manual.append((r, f'multi-chain:{sorted(c["no"] for c in cand)}')); continue
        root = roots.pop()
        e = per_chain[root]
        e['kva'] += r['kva']; e['tenant'] = nm
        e['srcs'].append(f"{r['loc']}={r['kva']}")
        e['contracts'] = chain_of.get(root, {root}) or {root}
        if len(e['srcs']) > 1: e['note'].add('多处合并求和')
        exist = {c['kva'] for c in cs if c['id'] in e['contracts'] and c['kva'] >= 0}
        if exist: e['note'].add(f'已有值{exist}')
    id2no = {c['id']: c['no'] for cs in by_tenant.values() for c in cs}
    return per_chain, manual, id2no

def main():
    mode = sys.argv[-1]
    per_chain, manual, id2no = build_plan()
    with open(PLAN_TSV, 'w', encoding='utf-8') as f:
        f.write('tenant\tkva\tsources\tcontracts\tnote\n')
        for root, e in sorted(per_chain.items(), key=lambda x: x[1]['tenant']):
            nos = ';'.join(sorted(id2no[i] for i in e['contracts']))
            f.write(f"{e['tenant']}\t{e['kva']}\t{';'.join(e['srcs'])}\t{nos}\t{','.join(e['note'])}\n")
        f.write('--- MANUAL ---\n')
        for r, why in manual:
            f.write(f"{r['name']}\t{r['kva']}\t{r['phase']}期 {r['loc']}\t\t{why}\n")
    n_ct = sum(len(e['contracts']) for e in per_chain.values())
    print(f"plan: 链 {len(per_chain)} 条 / 合同 {n_ct} 份 / MANUAL {len(manual)} 行 → {PLAN_TSV}")
    if mode == 'apply':
        stmts = ['START TRANSACTION;']
        for root, e in per_chain.items():
            ids = ','.join(str(i) for i in e['contracts'])
            stmts.append(f"UPDATE contract SET kva={e['kva']} WHERE id IN ({ids});")
        stmts.append('COMMIT;')
        db('\n'.join(stmts), flags='')
        print(db('SELECT COUNT(*) n, SUM(kva) total_kva FROM contract WHERE kva IS NOT NULL;'))
        print('apply 完成')

if __name__ == '__main__':
    main()
