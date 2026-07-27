# -*- coding: utf-8 -*-
"""楼栋重分类(BUILDING-RECLASS):按标的段 location 文本解析 楼栋/楼层/单元,重挂全部合同。
跑法(仓库根): python demo3/backend/scripts/building-reclass/reclass.py plan|apply|verify
  plan   导出 DB→解析→写 demo3/building-reclass-plan.tsv + apply.generated.sql(不写库)
  apply  备份提示后执行 apply.generated.sql(单事务)
  verify 锚点核对:零悬空/单元唯一/占用抽查
规则(用户拍板 2026-07-26):
  宿舍 4 位房号=栋+楼层单元(2115→宿舍二栋 115,1楼);厂房/办公 首位=楼层(411→4楼);
  一期 A-G 座;二期 一至六车间=8-13 栋(五号楼/六号楼亦按车间序);宿舍一至四栋;
  新俊楼→宿舍一栋(别名,标注);保障房/饭堂/二期钢构车间=新栋;三期不动;
  垃圾行(车位/放行条/维修费/"主")忽略,无可解析行时现挂细粒度栋则保持,粗栋进 MANUAL。
"""
import re, subprocess, sys, io, os
from collections import defaultdict

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
HERE = os.path.dirname(os.path.abspath(__file__))
DEMO3 = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
PLAN_TSV = os.path.join(DEMO3, 'building-reclass-plan.tsv')
APPLY_SQL = os.path.join(HERE, 'apply.generated.sql')

def db(sql, flags='--batch'):
    inner = f'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" --default-character-set=utf8mb4 {flags} park_demo3'
    p = subprocess.run(['docker', 'exec', '-i', 'demo3-mysql', 'sh', '-c', inner],
                       input=sql.encode('utf-8'), capture_output=True)
    if p.returncode != 0:
        raise RuntimeError(p.stderr.decode('utf-8', 'replace'))
    return p.stdout.decode('utf-8', 'replace')

CN = {'一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9,
      '贰':2,'叁':3,'首':1,'1':1,'2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9}
CJ2CN = {1:'一',2:'二',3:'三',4:'四',5:'五',6:'六'}
GARBAGE = re.compile(r'车位|放行条|维修费|手续费|^主$|^费用')
FLOOR_W = r'[一二三四五六七八九首贰叁\d]'

def norm(s):
    s = s.replace('\\n','').replace('\n','').replace(' ','').replace('　','')
    s = s.replace('（','(').replace('）',')').replace('宿金区','宿舍区').replace('解化器','孵化器')
    return s

def floors_of(text):
    """'首层、二层、三层、四层' / '3-4层' / '二楼' → [1,2,3,4]"""
    out = []
    for m in re.finditer(rf'({FLOOR_W})(?:-({FLOOR_W}))?[楼层]', text):
        a = CN.get(m.group(1)); b = CN.get(m.group(2)) if m.group(2) else None
        if a is None: continue
        out.extend(range(a, (b or a) + 1))
    return sorted(set(out))

def expand_rooms(text):
    """房号 token 列表:A102/K306/616/2115/501-504 展开;'8号'等栋号须先被剥离。"""
    toks = []
    for m in re.finditer(r'([A-Za-z]?)(\d{2,4})(?:-(\d{2,4}))?(?=室|单元|号室|号|楼|、|，|,|；|;|$|展厅)', text):
        pre, a, b = m.group(1), m.group(2), m.group(3)
        if b and len(a) == len(b) and int(b) >= int(a) and int(b) - int(a) <= 12:
            toks.extend(f'{pre}{n}' for n in range(int(a), int(b) + 1))
        else:
            toks.append(f'{pre}{a}')
    return toks

def room_floor(tok, dorm):
    d = re.sub(r'^[A-Za-z]+', '', tok)
    if dorm and len(d) == 4:   # 栋+楼层+单元
        return int(d[1]), d[1:], int(d[0])   # floor, unit_no(3位), 栋
    if len(d) >= 3:
        return int(d[0]), tok, None
    return None, tok, None   # 2位号无楼层线索

def parse_segment(seg, ctx_bld):
    """一个 ；分段 → (building, [(floor, unit_no, flag)], new_ctx) 或 (None,[],ctx)"""
    flags = []
    bld = None
    s = seg
    dorm = False

    if '三期' in s: return ('SKIP3', [], ctx_bld)
    if GARBAGE.search(s): return (None, [], ctx_bld)
    if s == '饭堂': return ('饭堂', [(1, '饭堂', 'special')], ctx_bld)
    m = re.match(r'^空地([一二])$', s)
    if m: return ('一期 空地', [(1, s, 'special')], ctx_bld)

    # ── 宿舍族 ──
    if re.search(r'宿舍|保障房|新俊楼', s) or (ctx_bld and ('宿舍' in ctx_bld or ctx_bld == '保障房')):
        dorm = True
        if '保障房' in s: bld = '保障房'
        elif '新俊楼' in s: bld = '一期 宿舍一栋'; flags.append('新俊楼→一栋别名')
        if re.search(r'3/4栋', s): return ('AMBIG', [], ctx_bld)
        m = re.search(r'([一二三四1-4])(?:号楼|号|座|栋)', s)
        if m and not bld: bld = f'一期 宿舍{CJ2CN[CN[m.group(1)]]}栋'
        body = re.sub(r'宿舍区|宿舍楼|宿舍|保障房|新俊楼|([一二三四1-4])(号楼|号|座|栋)|[:：]', '', s)
        body = re.sub(rf'{FLOOR_W}[楼层]', '', body, count=0)  # 楼层词由房号数字判定
        rooms = expand_rooms(body)
        units = []
        for t in rooms:
            fl, uno, dong = room_floor(t, dorm=True)
            if dong:   # 4 位房号自带栋
                dbld = f'一期 宿舍{CJ2CN[CN[str(dong)]]}栋' if 1 <= dong <= 4 else None
                if dbld and bld and dbld != bld and '保障房' not in (bld or ''):
                    flags.append(f'房号栋{dong}≠文本{bld},按房号')
                if dbld and (bld is None or '保障房' not in bld): bld = dbld if bld is None or '宿舍' in bld else bld
                if '保障房' in (bld or ''): uno = t  # 保障房无栋位,房号原样
            if fl is None: flags.append(f'{t}无楼层'); fl = 1
            units.append((fl, uno, ','.join(flags) or ''))
        if not units: return (None, [], ctx_bld)
        if not bld:
            if ctx_bld and ('宿舍' in ctx_bld or ctx_bld in ('散租宿舍', '保障房')):
                bld = ctx_bld; units = [(f, u, (fg + ',' if fg else '') + '栋取现挂') for f, u, fg in units]
            else:
                return ('NODONG', [], ctx_bld)
        return (bld, units, bld)

    # ── 二期 ──
    if '钢构车间' in s:
        bld = '二期 钢构车间'
        body = re.sub(r'二期|钢构车间', '', s)
    else:
        m = (re.search(r'(?:二期)?\s*(8|9|10|11|12|13)\s*(?:号楼|号|栋|座)', s)
             or re.search(r'[(（]?([一二三四五六1-6])车间[)）]?', s)
             or re.search(r'车间([一二三四五六])', s)
             or (('二期' in s) and re.search(r'([一二三四五六1-6])号楼', s)))
        if m:
            n = CN.get(m.group(1)) if not m.group(1).isdigit() or int(m.group(1)) <= 6 else int(m.group(1)) - 7
            if isinstance(n, int) and n > 6: n = n - 7
            bld = f'二期 {CJ2CN[n]}车间'
            body = re.sub(r'二期|(8|9|10|11|12|13)(号楼|号|栋|座)|[(（][一二三四五六1-6]车间[)）]|[(（]车间[一二三四五六][)）]|([一二三四五六1-6])号楼|西边', '', s)
            if '西边' in s: flags.append('西边')
        else:
            body = None
    if bld and body is not None:
        if '天面' in body:
            return (bld, [(1, '天面', 'special')], bld)
        return (bld, floor_units(body, flags), bld)

    # ── 一期 A-G 座 ──
    m = re.search(r'(?:一期)?([A-G])座', s)
    if m:
        bld = f'一期 {m.group(1)}座'
        body = re.sub(r'一期|[A-G]座|孵化器', '', s)
        if '天面' in body:
            return (bld, [(1, '天面空地' if '空地' in body else '天面', 'special')], bld)
        return (bld, floor_units(body, flags), bld)

    return (None, [], ctx_bld)

def floor_units(body, flags):
    """非宿舍段:房号→(首位=楼层);无房号→N楼整层。"""
    rooms = expand_rooms(body)
    units = []
    fls = floors_of(body)
    if rooms:
        for t in rooms:
            fl, uno, _ = room_floor(t, dorm=False)
            if fl is None:
                fl = fls[0] if fls else 1; flags.append(f'{t}楼层取上下文')
            units.append((fl, uno, ','.join(flags)))
        return units
    if fls:  # 整层/纯楼层
        tag = '' if '整层' in body else '按整层记'
        return [(f, f'{f}F整层', ','.join(flags + ([tag] if tag else []))) for f in fls]
    return []

COARSE = {'一期 B-G座', '一期 宿舍区', '二期 一至四车间', '二期 五、六车间', '三期'}

def build_plan():
    raw = db("""SELECT c.id, c.contract_no, t.company_name, COALESCE(b.name,''), COALESCE(b.phase,0),
  COALESCE(c.unit_id,0), c.status, COALESCE(l.location,''), COALESCE(l.area,0)
FROM contract c JOIN tenant t ON t.id=c.tenant_id
LEFT JOIN building b ON b.id=c.building_id
LEFT JOIN (SELECT contract_id, location, MAX(COALESCE(area,0)) area
           FROM contract_billing_term GROUP BY contract_id, location) l ON l.contract_id=c.id
ORDER BY c.id, l.area DESC;""")
    rows = [r.split('\t') for r in raw.splitlines()[1:] if r]
    by_contract = defaultdict(list)
    meta = {}
    for r in rows:
        cid = int(r[0])
        meta[cid] = dict(no=r[1], tenant=r[2], bld=r[3], phase=int(r[4]), unit_id=int(r[5]), status=r[6])
        if r[7]: by_contract[cid].append((r[7], float(r[8])))
        else: by_contract.setdefault(cid, [])

    plan, manual = [], []
    units_new = set()          # (building, floor, unit_no)
    for cid, m in meta.items():
        if m['phase'] == 3:
            plan.append((cid, m, 'skip-phase3', '', 0, '', '三期不动')); continue
        locs = sorted(by_contract[cid], key=lambda x: -x[1])
        got, primary, notes = [], None, []
        skip3 = False
        for loc, area in locs:
            ctx = None
            for seg in re.split(r'[;；]', norm(loc)):
                if not seg: continue
                bld, units, ctx = parse_segment(seg, ctx or (m['bld'] if m['bld'] else None))
                if bld == 'SKIP3': skip3 = True; continue
                if bld in ('AMBIG', 'NODONG'):
                    manual.append((cid, m, 'ambiguous' if bld == 'AMBIG' else 'dorm-no-dong', loc)); continue
                if not bld or not units: continue
                for fl, uno, fg in units:
                    got.append((bld, fl, uno, fg))
                    if primary is None: primary = (bld, fl, uno)
        if skip3 and not got:
            plan.append((cid, m, 'skip-phase3', '', 0, '', '标的段=三期')); continue
        if not got:
            if any(x[0] == cid for x in [(mm[0],) for mm in manual]): continue
            if m['bld'] and m['bld'] not in COARSE:
                plan.append((cid, m, 'keep', m['bld'], 0, '', '无可解析位置,现挂细粒度栋保持'))
            else:
                manual.append((cid, m, 'no-location-coarse-building', ''))
            continue
        for bld, fl, uno, fg in got:
            units_new.add((bld, fl, uno))
        pb, pf, pu = primary
        note = ';'.join(sorted({f for _, _, _, f in got if f})) or ''
        # 附加单元(V58 contract_unit):除主单元外的全部去重单元
        extras = sorted({(b, u) for b, _, u, _ in got if (b, u) != (pb, pu)})
        plan.append((cid, m, 'assign', pb, pf, pu, note, extras))
    return plan, manual, units_new, meta

def write_outputs(plan, manual, units_new):
    new_blds = sorted({b for b, _, _ in units_new} - set(EXISTING_BLDS))
    with open(PLAN_TSV, 'w', encoding='utf-8') as f:
        f.write('contract_id\tcontract_no\ttenant\told_building\taction\tnew_building\tfloor\tunit\textra_units\tnote\n')
        for cid, m, act, bld, fl, uno, note, *rest in sorted(plan, key=lambda x: x[0]):
            ex = ';'.join(f'{b}:{u}' for b, u in (rest[0] if rest else []))
            f.write(f"{cid}\t{m['no']}\t{m['tenant']}\t{m['bld']}\t{act}\t{bld}\t{fl or ''}\t{uno}\t{ex}\t{note}\n")
        f.write('--- MANUAL ---\n')
        for cid, m, reason, loc in manual:
            f.write(f"{cid}\t{m['no']}\t{m['tenant']}\t{m['bld']}\tMANUAL\t{reason}\t\t\t{loc}\n")

    L = ['-- 楼栋重分类 apply(generated by reclass.py;单事务)', 'START TRANSACTION;']
    for b in new_blds:
        phase = 2 if '二期' in b else 4
        L.append(f"INSERT INTO building (name, phase, floor_count, total_area, rentable_area, status, per_floor)"
                 f" SELECT '{b}', {phase}, 1, 0, 0, 1, 0 WHERE NOT EXISTS (SELECT 1 FROM building WHERE name='{b}');")
    for b, fl, uno in sorted(units_new):
        L.append(f"INSERT INTO unit (building_id, floor, unit_no, area)"
                 f" SELECT b.id, {fl}, '{uno}', 0 FROM building b WHERE b.name='{b}'"
                 f" AND NOT EXISTS (SELECT 1 FROM unit u WHERE u.building_id=b.id AND u.unit_no='{uno}');")
    L.append("UPDATE unit u JOIN building b ON b.id=u.building_id SET u.floor="
             "CASE WHEN u.floor>=1 THEN u.floor ELSE 1 END;")
    null_ids = [str(cid) for cid, m, act, *_ in plan if act == 'keep']
    for cid, m, act, bld, fl, uno, note, *rest in plan:
        if act != 'assign': continue
        L.append(f"UPDATE contract c JOIN building b ON b.name='{bld}' "
                 f"LEFT JOIN unit u ON u.building_id=b.id AND u.unit_no='{uno}' "
                 f"SET c.building_id=b.id, c.unit_id=u.id WHERE c.id={cid};")
        # V58 附加单元关联(除主单元外全部);NOT EXISTS 幂等
        for eb, eu in (rest[0] if rest else []):
            L.append(f"INSERT INTO contract_unit (contract_id, unit_id) "
                     f"SELECT {cid}, u.id FROM unit u JOIN building b ON b.id=u.building_id "
                     f"WHERE b.name='{eb}' AND u.unit_no='{eu}' "
                     f"AND NOT EXISTS (SELECT 1 FROM contract_unit x WHERE x.contract_id={cid} AND x.unit_id=u.id);")
    # keep/MANUAL 户的占位单元指针置空(楼栋重建时自动编号的假房号,不如空诚实);三期不动
    if null_ids:
        L.append(f"UPDATE contract SET unit_id=NULL WHERE id IN ({','.join(null_ids)});")
    L.append("UPDATE contract c JOIN building b ON b.id=c.building_id "
             "SET c.unit_id=NULL WHERE b.phase<>3 AND c.unit_id IS NOT NULL AND c.id IN (%MANUAL_IDS%);")
    L.append("UPDATE building b SET b.floor_count=GREATEST(b.floor_count, COALESCE((SELECT MAX(u.floor) FROM unit u WHERE u.building_id=b.id),1));")
    # 占位单元清理是 2026-07-26 首跑的一次性动作,已执行;重跑不得再删(真单元可能空置未被引用)
    L.append('COMMIT;')
    with open(APPLY_SQL, 'w', encoding='utf-8') as f:
        f.write('\n'.join(L) + '\n')
    return new_blds

EXISTING_BLDS = []

def main():
    mode = sys.argv[-1]
    global EXISTING_BLDS
    EXISTING_BLDS = [r.split('\t')[0] for r in db('SELECT name FROM building;').splitlines()[1:]]
    if mode == 'plan':
        plan, manual, units_new, meta = build_plan()
        new_blds = write_outputs(plan, manual, units_new)
        # 部分可解析的合同(assign+MANUAL 并存,如 A座+无栋宿舍房号)保留主单元,置空名单须排除
        assigned = {cid for cid, _, act, *_ in plan if act == 'assign'}
        manual_ids = ','.join(str(cid) for cid, *_ in manual if cid not in assigned) or '0'
        with open(APPLY_SQL, encoding='utf-8') as f: sqltext = f.read()
        with open(APPLY_SQL, 'w', encoding='utf-8') as f:
            f.write(sqltext.replace('%MANUAL_IDS%', manual_ids))
        acts = defaultdict(int)
        for _, _, act, *_ in plan: acts[act] += 1
        print(f"plan 写出: {PLAN_TSV}")
        print(f"actions: {dict(acts)}  MANUAL: {len(manual)}  新单元: {len(units_new)}  新栋: {new_blds}")
    elif mode == 'apply':
        with open(APPLY_SQL, encoding='utf-8') as f: sql = f.read()
        print(db(sql, flags=''))
        print('apply 完成')
    elif mode == 'verify':
        print(db("""SELECT '①悬空合同(应0)' k, COUNT(*) v FROM contract c LEFT JOIN building b ON b.id=c.building_id WHERE b.id IS NULL
UNION ALL SELECT '②悬空单元指针(应0)', COUNT(*) FROM contract c WHERE c.unit_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM unit u WHERE u.id=c.unit_id)
UNION ALL SELECT '③单元重号(应0)', COUNT(*) FROM (SELECT building_id, unit_no FROM unit GROUP BY building_id, unit_no HAVING COUNT(*)>1) x
UNION ALL SELECT '④粗栋残留合同(B-G座/宿舍区/一至四/五六车间)', COUNT(*) FROM contract c JOIN building b ON b.id=c.building_id WHERE b.name IN ('一期 B-G座','一期 宿舍区','二期 一至四车间','二期 五、六车间')
UNION ALL SELECT '⑤单元总数', COUNT(*) FROM unit;"""))
    else:
        print('usage: reclass.py plan|apply|verify')

if __name__ == '__main__':
    main()
