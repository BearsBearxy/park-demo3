# 一期 source notices vs dev contracts, per sheet per month (read-only; outputs out/p1-compare.txt/json)
import json, collections, re, calendar
from decimal import Decimal as D
A=json.load(open('out/all.json',encoding='utf-8'))
db=json.load(open('out/db-snapshot.json',encoding='utf-8'))
T={t['id']:t for t in db['tenant']}
B={b['id']:b for b in db['building']}
auto=json.load(open('out/p1-match-auto.json',encoding='utf-8'))
MANUAL={'东佛':[393],'个人租宿舍':[],'优凯':[],'大为':[],'李思常':[],'金羽飞':[],'邱彩云':[395],
 '合源':[104],'吴跃平':[151],'建奕国际':[280],'张勇':[163],'张执盛':[162],'彭建宜':[159],'暖通':[111],
 '李富全':[113],'李李':[15],'次生代':[110],'炳记运输':[270],'私人短租宿舍':[374,397],'精锐佳':[118],
 '采妍':[120],'万众宿舍':[90],'龙为宿舍':[94],'SENAN':[160]}
def fam(ids):
    s=set(ids)
    for _ in range(2):
        for t in db['tenant']:
            if t['parent_id'] in s: s.add(t['id'])
            if t['id'] in s and t['parent_id']: s.add(t['parent_id'])
    return s
def tid_of(sheet):
    if sheet in MANUAL: return fam(MANUAL[sheet])
    c=auto[sheet]['cands']
    return fam([c[0][0]]) if c else set()
def N(x):
    try: return D(str(x))
    except Exception: return None
def cat(fee,loc):
    t=(fee or '')
    if not t: t=loc or ''
    if any(k in t for k in ['押金','保证金','手续费','水电','电费','分摊','维修','赔','滞纳','退','押']): return 'misc'
    if '空地' in t and '租' in t: return 'rent_land'
    if '租' in t: return 'rent'
    if '容量' in t or '基本电' in t: return 'capacity'
    if '电梯' in t: return 'elevator'
    if '变压器' in t: return 'transformer'
    if '土地使用税' in t: return 'land_tax'
    if '门禁' in t: return 'access'
    if '网络' in t: return 'network'
    if '基础' in t: return 'infra'
    if '管理' in t or '服务' in t or '物业' in t: return 'mgmt'
    return 'other'
KEYCAT={'rent_factory':'rent','rent_office':'rent','rent_shop':'rent','rent_dorm':'rent','rent_land':'rent_land',
 'mgmt':'mgmt','infra':'infra','elevator':'elevator','transformer':'transformer','land_tax':'land_tax','access':'access','network':'network','other':'other'}
def lm(l):
    m=l['bill_mode']; up=N(l['unit_price']); a=N(l['area']); co=N(l['coeff']) or D(1); r=l['room_count']
    if m=='per_sqm_month': return None if a is None or up is None else (a*up*co).quantize(D('0.01'))
    if m=='per_room_year': return None if up is None or r is None else (up*r/12).quantize(D('0.01'))
    if m=='per_room_month': return None if up is None or r is None else (up*r).quantize(D('0.01'))
    return N(l['amount_override'])
terms=collections.defaultdict(list)
for l in db['term']: terms[l['contract_id']].append(l)
cons=collections.defaultdict(list)
for c in db['contract']: cons[c['tenant_id']].append(c)
def active(c,ym):
    y,m=map(int,ym.split('-')); s=f'{ym}-01'; e=f'{ym}-{calendar.monthrange(y,m)[1]:02d}'
    if not c['start_date'] or not c['end_date']: return None
    return c['start_date']<=e and c['end_date']>=s and c['status'] in ('active','renewed')
ns=[n for n in A['notices'] if n['zone']=='一期' and '@' not in n['book']]
by=collections.defaultdict(list)
for n in ns: by[n['sheet']].append(n)
out=[]; J={}
TAX=[D(1),D('1.128'),D('1.03'),D('1.09'),D('1.06'),D('1.05'),D('1.13')]
for sh in sorted(by):
    ids=tid_of(sh)
    allc=[c for i in ids for c in cons[i]]
    rep={'ids':sorted(ids),'months':{}}
    months=collections.defaultdict(list)
    for n in by[sh]: months[n['ym']].append(n)
    out.append(f"## {sh} -> tenants {[(i,T[i]['company_name']) for i in sorted(ids)]}")
    for c in sorted(allc,key=lambda c:c['id']):
        out.append(f"   C{c['id']} {c['contract_no']} b={B.get(c['building_id'],{}).get('name')} {c['start_date']}~{c['end_date']} st={c['status']} {c['link_type']} p={c['parent_contract_id']} rent_area={c['rent_area']} mr={c['monthly_rent']} kva={c['kva']} lines={len(terms[c['id']])}")
    for ym in sorted(months):
        nsig=collections.defaultdict(D)
        for n in months[ym]:
            for r in n['rows']:
                k=cat(r.get('fee') or r.get('item'),r.get('location'))
                mo=N(r.get('monthly'))
                if mo is None:
                    a=N(r.get('area') or r.get('buildArea') or r.get('billArea') or r.get('innerArea')); p=N(r.get('unitPrice'))
                    mo=(a*p) if a is not None and p is not None else N(r.get('amount'))
                if mo is None: continue
                nsig[k]+=mo
        act=[c for c in allc if active(c,ym)]
        dsig=collections.defaultdict(D)
        for c in act:
            for l in terms[c['id']]:
                v=lm(l)
                if v is not None: dsig[KEYCAT[l['fee_key']]]+=v
            if c['kva'] and 'capacity' in nsig: dsig['capacity']+=N(c['kva'])*D('22.6')
        diffs=[]
        for k in sorted(set(nsig)|set(dsig)):
            if k in ('misc','other'): continue
            a,b=nsig.get(k,D(0)),dsig.get(k,D(0))
            if abs(a-b)<=D('0.05'): continue
            tag=''
            if b and a:
                r=a/b
                for t in TAX:
                    if abs(r-t)<D('0.0015'): tag=f'tax*{t}'
            diffs.append((k,str(a.quantize(D('0.01'))),str(b.quantize(D('0.01'))),tag))
        rep['months'][ym]={'notice':{k:str(v) for k,v in nsig.items()},'db':{k:str(v) for k,v in dsig.items()},'active':[c['id'] for c in act],'diffs':diffs,'tot':[n['total'] for n in months[ym]]}
        real=[x for x in diffs if not x[3]]
        flag='OK' if not real else 'DIFF'
        out.append(f"  {ym} {flag} act={[c['contract_no'] for c in act]} " + ('; '.join(f"{k}: src {a} vs db {b} {t}" for k,a,b,t in diffs)))
    J[sh]=rep
open('out/p1-compare.txt','w',encoding='utf-8').write('\n'.join(out))
json.dump(J,open('out/p1-compare.json','w',encoding='utf-8'),ensure_ascii=False,indent=0)
print(len(out))
