# 二期 源册通知单 ↔ park_demo3 合同计费行 逐户逐月比对(只读)。产物: p2/compare.txt
# 同户同月的多张通知单合并后再配行;连续月份签名相同则折叠成一段。
import json, calendar, re
from collections import defaultdict
from decimal import Decimal as D
import pymysql

OUT = 'C:/financial_dashboard/demo3/scripts/contract-recon/'
SHEET2T = {'丁天伦':50,'三龙':56,'两岸食品':33,'中科华贸':14,'何育平':13,'保奔路汽车':11,'健明包装':19,'刘彪':55,'力灏':48,
 '南一':62,'吉罗德':26,'嘉荣':375,'威玛斯':30,'广联':28,'应塘':58,'庞俊妨':57,'张文峰':65,'张木兰':32,'张炳南':9,'彭云霞':49,
 '徐翾':52,'恩科':3,'新疆三林':377,'方凯鑫':53,'易立':21,'星州':22,'曹小芳':68,'朱漫钳':61,'朱漫钳（装修期内）':61,'李李':15,
 '柯建伍':67,'欧伟杰':18,'欧培敬':59,'毅盛离合':27,'氙明':29,'永龙':23,'火炬园':1,'王红婷':64,'石荣杰':51,'科文':376,'管中旺':25,
 '罗立剑':54,'联洛贸易':17,'艾派斯':20,'苏明东':378,'谢福兵':7,'达博普':12,'邓宇峰':60,'铂超贸易':8,'锂朋':2,'陈书谨':69,
 '陈土生':66,'陈曼娜':16,'飞浪':4,'驰鸿印业':10,'魏杰瑜':5,'黎镇源':360}
ADDR2T = {'管中旺':25,'温小蓉':379,'文广':380}
P2B = {15,16,30,31,32,33,34,35,38,None}
FACS = ('1', '1.1', '1.128', '1.09', '1.06', '1.05', '1.03', '1.13', '1.12')

def fk(fee, loc):
    f = fee or ''; l = loc or ''
    if '保证金' in f or '押金' in f: return 'deposit'
    if '装机容量' in f or '容量费' in f: return 'capacity'
    if '宿舍' in f and '租金' in f: return 'rent_dorm'
    if '租金' in f and ('空地' in f or '空地' in l or '天面' in l): return 'rent_land?'
    if '租金' in f: return 'rent'
    if '管理' in f: return 'mgmt'
    if '基础设施' in f: return 'infra'
    if '电梯' in f: return 'elevator'
    if '变压器' in f: return 'transformer'
    if '土地' in f or '房产税' in f: return 'land_tax'
    if '门禁' in f: return 'access'
    if '网络' in f: return 'network'
    return 'other:' + f[:12]

def n(x):
    try: return D(str(x))
    except Exception: return None

def line_monthly(l, kva):
    mode = l['bill_mode']; up = l['unit_price'] or D(0)
    if mode == 'per_sqm_month': return (l['area'] or D(0)) * up * (l['coeff'] or 1)
    if mode == 'per_room_year': return up * (l['room_count'] or 0) / 12
    if mode == 'per_room_month': return up * (l['room_count'] or 0)
    if mode == 'per_kva_month': return kva
    return l['amount_override']

def main():
    a = json.load(open(OUT + 'out/all.json', encoding='utf-8'))
    ns = [x for x in a['notices'] if x['zone'] == '二期' and '@' not in x['book']]
    c = pymysql.connect(host='127.0.0.1', port=13306, user='root', password='root', database='park_demo3', charset='utf8mb4')
    cur = c.cursor(pymysql.cursors.DictCursor)
    cur.execute("select * from contract")
    cons = defaultdict(list)
    for r in cur.fetchall(): cons[r['tenant_id']].append(r)
    cur.execute("select * from contract_billing_term order by seq, id")
    lines = defaultdict(list)
    for r in cur.fetchall(): lines[r['contract_id']].append(r)
    by = defaultdict(lambda: defaultdict(list))
    for x in ns:
        tid = ADDR2T.get(x['addressee'], SHEET2T.get(x['sheet']))
        by[tid if tid else 'sheet:' + x['sheet']][x['bookYm']].append(x)
    out = []
    for tk in sorted(by, key=str):
        out.append('=' * 20 + f' T{tk} ' + '/'.join(sorted({x['sheet'] + ':' + x['addressee'] for m in by[tk].values() for x in m})))
        tid = tk if isinstance(tk, int) else None
        groups = []
        for ym in sorted(by[tk]):
            y, m = map(int, ym.split('-'))
            first = f'{ym}-01'; last = f'{ym}-{calendar.monthrange(y, m)[1]:02d}'
            eff = [k for k in cons.get(tid, []) if k['kind'] != 'master_lease' and k['status'] != 'draft'
                   and k['start_date'] and k['end_date'] and str(k['start_date']) <= last and str(k['end_date']) >= first]
            nod = [k for k in cons.get(tid, []) if not (k['start_date'] and k['end_date'])]
            ml = [k for k in cons.get(tid, []) if k['kind'] == 'master_lease' and k['start_date'] and str(k['start_date']) <= last and str(k['end_date']) >= first]
            dbl = [dict(p2=k['building_id'] in P2B, c=k['contract_no'], id=l['id'], fk=l['fee_key'], pt=l['property_type'],
                        loc=l['location'], a=l['area'], sh=l['area_shared'], up=l['unit_price'] or D(0), mon=line_monthly(l, k['kva']))
                   for k in eff for l in lines[k['id']]]
            blk = ['   DB eff: ' + (', '.join(f"C{k['id']}:{k['contract_no']}({k['start_date']}~{k['end_date']},ra={k['rent_area']},rent={k['monthly_rent']},kva={k['kva']},st={k['status']})" for k in eff) or 'NONE')
                   + ((' | nodate: ' + ', '.join(f"C{k['id']}:{k['contract_no']}" for k in nod)) if nod else '')
                   + ((' | master_lease: ' + ', '.join(f"C{k['id']}" for k in ml)) if ml else '')]
            used = set(); extras = []; hdrs = []
            RM = lambda t: set(re.findall(r'(?<!\d)(\d{3,4})(?!\d)', (t or '').replace(chr(10), ' ')))
            dsrc = defaultdict(lambda: [D(0), set()])
            for x in sorted(by[tk][ym], key=lambda x: (x['sheet'], x['notice'])):
                hdrs.append(f"{x['sheet']}#{x['notice']}({x['ym']},{x['kind'][:6]},imgs={x['images']},tot={x['total']})")
                for r in x['rows']:
                    key = fk(r.get('fee') or r.get('item'), r.get('location'))
                    area = n(r.get('buildArea') or r.get('area') or r.get('billArea') or r.get('landArea'))
                    up = n(r.get('unitPrice')); mon = n(r.get('monthly')) or n(r.get('amount'))
                    if key.startswith('other:') or key == 'deposit':
                        extras.append(f"{r.get('fee') or r.get('item') or ''}/{(r.get('location') or '')[:14]}={r.get('amount')}".replace(chr(10), ''))
                        continue
                    if '宿舍' in (r.get('location') or '') + (r.get('fee') or '') or key in ('access', 'network', 'rent_dorm'):
                        d = dsrc[key]; d[0] += mon or D(0); d[1] |= RM(r.get('location'))
                        continue
                    cands = [l for l in dbl if l['id'] not in used and l['mon'] is not None and mon is not None and l['pt'] != 'dorm' and
                             ((key in ('rent', 'rent_land?') and l['fk'].startswith('rent_') and l['fk'] != 'rent_dorm') or l['fk'] == key)]
                    best = next(((l, f) for f in FACS for l in cands
                                 if abs(l['mon'] * D(f) - mon) <= (D('0.06') if f == '1' else max(D('0.06'), mon * D('0.0005')))), None)
                    tag = f"{x['sheet'][:4]}#{x['notice']}r{r['row']}"
                    src = f"{key} {(r.get('fee') or '')[:10]} loc={(r.get('location') or '')[:26]!r} a={area} up={up} mon={mon}"
                    if best:
                        l, f = best; used.add(l['id'])
                        flag = 'OK' if f == '1' else f'OK×{f}'
                        if area is not None and l['a'] is not None and abs(area - l['a']) > D('0.01'): flag += f' AREA{area}≠{l["a"]}'
                        if key == 'rent_land?' or l['fk'] == 'rent_land' or '天面' in (l['loc'] or '') or '空地' in (l['loc'] or ''):
                            flag += f' LANDCHK(fk={l["fk"]},pt={l["pt"]})'
                        blk.append(f"   {flag:10s} {tag} {src} <-> L{l['id']} {l['fk']}/{l['pt']} a={l['a']} sh={l['sh']} up={l['up']} {l['c']}")
                    else:
                        blk.append(f"   {'MISS':10s} {tag} {src}")
            ddb = defaultdict(lambda: [D(0), set(), []])
            for l in dbl:
                if l['pt'] == 'dorm' and l['id'] not in used:
                    d = ddb[l['fk']]; d[0] += l['mon'] or D(0); d[1] |= RM(l['loc']); d[2].append(l['c']); used.add(l['id'])
            for k in sorted(set(dsrc) | set(ddb)):
                sv, sr = dsrc[k] if k in dsrc else (D(0), set())
                dv, dr, dc = ddb[k] if k in ddb else (D(0), set(), [])
                f = next((f for f in FACS if abs(dv * D(f) - sv) <= max(D('0.10'), sv * D('0.0005'))), None)
                flag = ('DORM-OK' if f == '1' else f'DORM-OK×{f}') if f and sr == dr else 'DORM-DIFF'
                blk.append(f"   {flag:10s} {k} src={sv:.2f} rooms={sorted(sr)} | db={dv:.2f} rooms={sorted(dr)} {sorted(set(dc))} | src-db={sorted(sr - dr)} db-src={sorted(dr - sr)}")
            other = sorted({l['c'] for l in dbl if l['id'] not in used and not l['p2']})
            if other: blk.append('   (非二期楼合同未配上: ' + ','.join(other) + ')')
            for l in dbl:
                if l['id'] not in used and l['p2']:
                    blk.append(f"   {'DBONLY':10s} L{l['id']} {l['fk']}/{l['pt']} loc={(l['loc'] or '')[:30]!r} a={l['a']} sh={l['sh']} up={l['up']} mon={(l['mon'] or 0):.2f} {l['c']}")
            sig = tuple(blk)
            if groups and groups[-1][0] == sig:
                groups[-1][1].append(ym)
            else:
                groups.append((sig, [ym], hdrs, []))
            if extras: groups[-1][3].append(f"{ym}: " + '; '.join(extras))
        for sig, yms, hdrs, ex in groups:
            out.append(f"[{yms[0]}..{yms[-1]} n={len(yms)}] " + ' | '.join(hdrs))
            out.extend(sig)
            if ex: out.append('   extras ' + ' || '.join(ex))
    open(OUT + 'p2/compare.txt', 'w', encoding='utf-8').write('\n'.join(out))
    print(len(out))

main()
