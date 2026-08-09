# -*- coding: utf-8 -*-
"""derive_bt_unit_bind.py — 计费行⇄单元绑定推导(2026-08-09,跨楼层公摊修缮的前置数据工程)。

背景:area 池取面积只按楼栋分桶(AllocService.areaByBuildingTenant),跨层租户被多收
(2024-02 实测:陈相钊+27.49/宏玥+21.11/优唯特+11.09/双成+1.28)。楼层级面积只存在于
contract_billing_term.location 自由文本 → 本脚本把每行计费行解析绑定到 unit(房间),
之后引擎才有条件按楼层取面积。

规则(不设静默兜底,不硬猜):
  - 楼栋: location 文本里的楼栋别名优先(文本是物理真相,双成宿舍行/翔海E座行皆文本≠合同栋);
          文本无楼栋 → 房号在全库唯一命中则绑(flag=room_unique),否则回退合同楼栋(flag=bld_from_contract)
  - 宿舍4位房号: 首位=栋号(2xxx=二栋/3xxx=三栋/4xxx=四栋),与文本栋冲突时房号+合同栋两票胜一票;
          **定栋后剥掉首位**——房册宿舍栋一律登记3位号(27/1/110),『2110』即『110』,不新建重复房
  - 楼层: 显式楼层词(首层/二楼/贰楼/第三层/3-4层…)优先;房号推层兜底(3位取百位);
          显式与房号冲突时:『整层』在场则显式层归整层段;否则楼层置空交房册仲裁
          (房册有此房→按房册层绑+flag;房册无→manual,不带着争议新建)
  - 房号: 逐个绑 unit,精确匹配(building_id, unit_no);『501-504单元』先展开;缺房 → 生成
          INSERT(area=0);疑似同房异名(301 vs A301、201 vs 截断号21)→ manual 不新建
  - 整层: 「N楼整层/G座1-4层」绑『{N}F整层』unit(V58 已有先例),缺则建
  - 绑不动的(『主』/消防通道/保障房整栋…) → todo 清单人工兜底

输出(只写文件,不改库):
  scripts/bt-unit-bind-plan.tsv                     全量对照表(含 flags)
  scripts/bt-unit-bind-todo.tsv                     manual 桶清单
  backend/scripts/fixes/bt-unit-bind-20260809.sql   幂等 SQL(硬断言+新 unit+绑定行)
  (billing_term_unit 表结构在 V91__billing_term_unit.sql,不在本产物内)

用法: python scripts/derive_bt_unit_bind.py            生成三个文件 + 摘要
      python scripts/derive_bt_unit_bind.py --selftest 解析器自检
"""
import io
import os
import re
import sys
from collections import defaultdict

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
HERE = os.path.dirname(os.path.abspath(__file__))
PLAN = os.path.join(HERE, "bt-unit-bind-plan.tsv")
TODO = os.path.join(HERE, "bt-unit-bind-todo.tsv")
SQL = os.path.join(HERE, "..", "backend", "scripts", "fixes", "bt-unit-bind-20260809.sql")
DB = dict(host="127.0.0.1", port=13306, user="root", password="root",
          database="park_demo3", charset="utf8mb4")

# ── 楼栋别名(按序命中,先长后短;文本优先于合同楼栋) ──────────────────────────
BLD_ALIASES = [
    (r"[AＡ]座|[AＡ]栋|解化器", 13),          # 解化器=孵化器笔误,只随A座出现
    (r"[BＢ]座", 20), (r"[CＣ]座", 21), (r"[DＤ]座", 22),
    (r"[EＥ]座", 23), (r"[FＦ]座", 24), (r"[GＧ]座", 25),
    (r"一车间|1车间|8号楼|8栋", 30),
    (r"二车间|2车间|9号楼|9栋", 31),
    (r"三车间|3车间|10号楼|10栋", 32),
    (r"四车间|4车间|11号楼|11栋", 33),
    (r"五车间|5车间|12号楼|12栋|12座|二期五号楼", 34),
    (r"六车间|6车间|13号楼|13栋|13座|二期六号楼", 35),
    (r"钢构", 38),
    (r"保障房", 39), (r"饭堂", 40),
    # 宿舍族(放在车间/座后面;新俊楼=宿舍一栋,N号楼=宿舍N栋)
    (r"新俊楼|宿舍楼一座|宿舍一座|宿舍一栋", 26),
    (r"二号楼|宿舍2号楼|宿舍区2号楼|宿舍二栋|宿金区", 27),
    (r"三号楼|宿舍3号楼|宿舍区3号楼|宿舍三栋", 28),
    (r"四号楼|宿舍楼四座|宿舍四座|宿舍四栋|宿舍区4栋|4栋", 29),
]
DORM_BLDS = (26, 27, 28, 29)
DORM_BY_DIGIT = {"2": 27, "3": 28, "4": 29}   # 宿舍4位房号首位=栋号

# 有账册/档案依据的疑难绑定(复核轮质疑但证据支持,保留自动结论并在 plan 里亮出依据)
CURATED_NOTE = {
    "A座孵化器二楼219号室": "账册A2西侧公共池(POOL-FORMULA-AUDIT行188)含暨南中院134.58㎡,证实A座二楼;C座219系另一房",
    "E座3-4层": "area-shared-rent-review行15:库对翔海即记E座3-4层4708㎡,G座另有对上的9416,合同栋FK系旧值",
}

FLOOR_CN = {"首": 1, "一": 1, "壹": 1, "二": 2, "贰": 2, "三": 3, "叁": 3,
            "四": 4, "肆": 4, "五": 5, "伍": 5, "六": 6, "陆": 6, "七": 7, "柒": 7}
RE_FLOOR_CN = re.compile(r"第?([首一壹二贰三叁四肆五伍六陆七柒])[层楼]")
RE_FLOOR_NUM = re.compile(r"(?<![\dA-Za-z])(\d)[层楼](?!室)")
RE_FLOOR_SPAN = re.compile(r"(?<![\dA-Za-z])(\d)\s*[-~]\s*(\d)\s*层")
RE_ROOM = re.compile(r"([A-ZＡ-Ｚa-z]?\d{2,4})(?:号?[室楼]|单元)?(?=[、,，/\s]|公摊|展厅|$)")
RE_ROOM_RANGE = re.compile(r"(\d{3})\s*[-~]\s*(\d{3})(?=号?室|单元)")
NON_SPATIAL = ("整栋", "使用费", "手续费", "通道", "绿化带")


def norm(s):
    return re.sub(r"\s+", "", (s or "").replace("　", "").replace("（", "(").replace("）", ")"))


def digits_of(u):
    return re.sub(r"^[A-ZＡ-Ｚa-z]", "", u)


def expand_ranges(text):
    """『501-504单元』→『501、502、503、504单元』(同百位、跨度<20 才展开)"""
    def rep(m):
        a, b = int(m.group(1)), int(m.group(2))
        if a < b and b - a < 20 and m.group(1)[0] == m.group(2)[0]:
            return "、".join(str(x) for x in range(a, b + 1))
        return m.group(0)
    return RE_ROOM_RANGE.sub(rep, text)


def parse_building(text):
    hits = []
    for pat, bid in BLD_ALIASES:
        m = re.search(pat, text)
        if m:
            hits.append((m.start(), bid))
    if not hits:
        return None
    hits.sort()
    return hits[0][1]


def strip_building_words(text):
    t = text
    for pat, _ in BLD_ALIASES:
        t = re.sub(pat, "", t)
    t = re.sub(r"一期|二期|三期|宿舍区|宿舍楼|宿舍|孵化器|\(.*?\)", "", t)
    return t


def room_floor(room):
    """房号推层:3位取百位(4位号在定栋时已剥首位)。推不出返回 None"""
    d = digits_of(room)
    if d.isdigit() and len(d) == 3 and d[0] != "0":
        return int(d[0])
    return None


def parse_location(raw, contract_bld):
    """解析一条 location → dict(bucket, bld, bld_src, items=[(unit_no, floor)], flags, reason)
    bucket: ok | manual | no_bld | roof;  floor=None 交房册仲裁"""
    flags = []
    text = norm(raw)
    if not text or text == "主" or any(k in text for k in NON_SPATIAL):
        return dict(bucket="manual", reason="非空间位置或不可绑(" + text[:20] + ")", flags=flags)
    if "/" in text and "栋" in text.split("室")[0]:
        return dict(bucket="manual", reason="多栋歧义(如 3/4栋)", flags=flags)
    text = expand_ranges(text)

    bld = parse_building(text)
    bld_src = "text"
    rest = strip_building_words(text)

    # 楼层:span > 中文 > 数字
    floors = []
    m = RE_FLOOR_SPAN.search(rest)
    if m:
        floors += list(range(int(m.group(1)), int(m.group(2)) + 1))
        rest = RE_FLOOR_SPAN.sub("", rest)
    for m in RE_FLOOR_CN.finditer(rest):
        floors.append(FLOOR_CN[m.group(1)])
    rest2 = RE_FLOOR_CN.sub("", rest)
    for m in RE_FLOOR_NUM.finditer(rest2):
        floors.append(int(m.group(1)))
    rest2 = RE_FLOOR_NUM.sub("", rest2)

    rooms = [m.group(1).upper() for m in RE_ROOM.finditer(rest2)]

    if "天面" in text and not rooms:
        return dict(bucket="roof", bld=bld, bld_src=bld_src, flags=flags,
                    roof_key="天面空地" if "空地" in text else "天面")

    if not rooms:
        if floors and any(k in text for k in ("空地", "大堂", "电梯厅")):
            return dict(bucket="manual", reason="有楼层但为局部场地(空地/大堂类),不能当整层绑", flags=flags)
        if floors and bld is not None:
            items = [(f"{f}F整层", f) for f in sorted(set(floors))]
            return dict(bucket="ok", bld=bld, bld_src=bld_src, items=items,
                        flags=flags + ["whole_floor"])
        if floors:
            return dict(bucket="manual", reason="整层但无楼栋", flags=flags)
        return dict(bucket="manual", reason="解析不出房号/楼层", flags=flags)

    # 宿舍4位房号:首位定栋(与文本栋冲突时房号+合同栋两票胜一票),定栋后剥首位
    four = [r for r in rooms if len(digits_of(r)) == 4]
    if four:
        digit_blds = {DORM_BY_DIGIT.get(digits_of(r)[0]) for r in four}
        digit_blds.discard(None)
        if len(digit_blds) == 1:
            db_ = digit_blds.pop()
            if bld is not None and db_ != bld:
                # 复核轮裁定:文本栋与房号栋打架时,两栋往往都有剥位后的同名房(28/1/101 vs 29/1/101),
                # 房册仲裁失效且可能是笔误(4101 或为 3101),一律人工定,不按任何一方硬绑
                return dict(bucket="manual", flags=flags,
                            reason=f"宿舍栋文本({bld})与房号({db_})冲突(合同栋{contract_bld}),两栋或皆有此房,人工定")
            elif bld is None:
                bld, bld_src = db_, "room_digit"
            if bld in DORM_BY_DIGIT.values():
                rooms = [digits_of(r)[1:] if len(digits_of(r)) == 4 else r for r in rooms]

    # 楼层归属:显式层被某房号百位覆盖=一致;未覆盖的显式层→『整层』段或冲突仲裁
    explicit = sorted(set(floors))
    room_digits = {room_floor(r) for r in rooms} - {None}
    conflict = [f for f in explicit if f not in room_digits]
    whole_items = []
    if conflict and "整层" in text:
        whole_items = [(f"{f}F整层", f) for f in conflict]
        conflict = []
    if conflict and room_digits:
        flags.append(f"floor_text_conflict(显式{conflict}vs房号推层,交房册仲裁)")

    items = []
    for r in rooms:
        rf = room_floor(r)
        if rf is None:
            f = explicit[0] if len(explicit) == 1 else None
        elif conflict and rf not in explicit:
            f = None                      # 文本楼层与房号打架 → 房册仲裁
        else:
            f = rf
        items.append((r, f))
    items += whole_items
    if bld is None:
        return dict(bucket="no_bld", items=items, flags=flags)
    return dict(bucket="ok", bld=bld, bld_src=bld_src, items=items, flags=flags)


# ── 自检 ────────────────────────────────────────────────────────────────────
SELFTEST = [
    ("一期C座二楼217、218、219室", 21, dict(bld=21, items=[("217", 2), ("218", 2), ("219", 2)])),
    ("一期C座三楼302室", 21, dict(bld=21, items=[("302", 3)])),
    ("A座孵化器二楼203号室", 13, dict(bld=13, items=[("203", 2)])),
    ("A座孵化器六楼619号室", 13, dict(bld=13, items=[("619", 6)])),
    ("A座四楼418室", 13, dict(bld=13, items=[("418", 4)])),
    ("A座孵化器K306室", 13, dict(bld=13, items=[("K306", 3)])),
    ("宿舍新俊楼一座505室", 26, dict(bld=26, items=[("505", 5)])),
    ("宿舍区2号楼首层2110室", 12, dict(bld=27, items=[("110", 1)])),
    ("宿舍区3号楼首层4101室", 29, dict(bucket="manual")),   # 文本栋28 vs 房号栋29,两栋皆有101 → 人工
    ("宿舍区二号楼首层2115、2104、2105室", 27, dict(bld=27, items=[("115", 1), ("104", 1), ("105", 1)])),
    ("一期D座三楼整层", 22, dict(bld=22, items=[("3F整层", 3)])),
    ("一期D座二楼", 29, dict(bld=22, items=[("2F整层", 2)])),
    ("G座1-4层", 25, dict(bld=25, items=[("1F整层", 1), ("2F整层", 2), ("3F整层", 3), ("4F整层", 4)])),
    ("E座3-4层", 25, dict(bld=23, items=[("3F整层", 3), ("4F整层", 4)])),
    ("一期G座首层、二层、三层、四层整层", 25, dict(bld=25, items=[("1F整层", 1), ("2F整层", 2), ("3F整层", 3), ("4F整层", 4)])),
    ("二期五号楼首层101室、二楼201室、三楼301室", 34, dict(bld=34, items=[("101", 1), ("201", 2), ("301", 3)])),
    ("A座206楼", 13, dict(bld=13, items=[("206", 2)])),
    ("A座6楼623室", 13, dict(bld=13, items=[("623", 6)])),
    ("二期8号楼(1车间）6楼601单元", 30, dict(bld=30, items=[("601", 6)])),
    ("二期13栋（六车间）第三层301室", 17, dict(bld=35, items=[("301", 3)])),
    ("A座解化器六楼621室", 21, dict(bld=13, items=[("621", 6)])),
    ("B座201室公摊", 20, dict(bld=20, items=[("201", 2)])),
    ("A座501室展厅", 13, dict(bld=13, items=[("501", 5)])),
    ("宿舍楼 四座 648", 29, dict(bld=29, items=[("648", 6)])),
    ("宿舍305室", 13, dict(bucket="no_bld")),
    ("3/4栋宿舍首层103室", 12, dict(bucket="manual")),
    ("消防通道", 13, dict(bucket="manual")),
    ("主", 22, dict(bucket="manual")),
    ("A座天面空地", 13, dict(bucket="roof")),
    ("二期13座二楼", 35, dict(bld=35, items=[("2F整层", 2)])),
    # 复核轮补充:整层+房号混排、区间展开、楼层冲突交房册仲裁
    ("二期10栋5楼整层、601单元", 32, dict(bld=32, items=[("601", 6), ("5F整层", 5)])),
    ("二期9栋(车间二)101单元、102单元、5楼整层501-504单元", 31,
     dict(bld=31, items=[("101", 1), ("102", 1), ("501", 5), ("502", 5), ("503", 5), ("504", 5)])),
    ("A座孵化器\n三楼433室", 13, dict(bld=13, items=[("433", None)])),
]


def selftest():
    bad = 0
    for raw, cbld, want in SELFTEST:
        got = parse_location(raw, cbld)
        ok = all(got.get(k) == v for k, v in want.items())
        if not ok:
            bad += 1
            print(f"FAIL {raw!r}: want {want} got { {k: got.get(k) for k in want} }")
    print(f"selftest: {len(SELFTEST) - bad}/{len(SELFTEST)} pass")
    return bad == 0


# ── 主流程 ──────────────────────────────────────────────────────────────────
def main():
    import pymysql
    con = pymysql.connect(**DB)
    cur = con.cursor()
    cur.execute("SELECT id, building_id, floor, unit_no FROM unit")
    units_multi = defaultdict(list)          # (bld, unit_no) -> [(id, floor)]
    for uid, ubld, ufloor, uno in cur.fetchall():
        units_multi[(ubld, uno)].append((uid, ufloor))
    units = dict(units_multi)
    by_no = defaultdict(list)                # unit_no -> [(bld, id, floor)]
    for (ubld, uno), lst in units_multi.items():
        for uid, ufloor in lst:
            by_no[uno].append((ubld, uid, ufloor))

    def dup_suspects(bld, uno):
        """疑似同房异名:同栋下 剥字母后数字相同(301 vs A301) 或 去零截断(201 vs 21)"""
        dg = digits_of(uno)
        out = []
        for (b2, u2) in units:
            if b2 != bld or u2 == uno:
                continue
            d2 = digits_of(u2)
            if d2 == dg or (dg.isdigit() and d2 == dg.replace("0", "")) \
                    or (d2.isdigit() and dg == d2.replace("0", "")):
                out.append(u2)
        return out

    cur.execute("""SELECT bt.id, bt.contract_id, c.tenant_id, t.company_name,
                          c.building_id, bt.fee_key, bt.location, IFNULL(bt.area,0)
                   FROM contract_billing_term bt
                   JOIN contract c ON c.id=bt.contract_id
                   JOIN tenant t ON t.id=c.tenant_id ORDER BY bt.id""")
    rows = cur.fetchall()
    total = len(rows)

    new_units = {}      # (bld, floor, unit_no)
    binds = []          # (term_id, bld, unit_no, floor|None)
    plan, todo = [], []
    stats = defaultdict(int)

    for tid, cid, tenid, tname, cbld, fkey, loc, area in rows:
        p = parse_location(loc, cbld)
        flags = list(p.get("flags", []))
        bucket = p["bucket"]
        if bucket == "roof":
            hit = None
            for rk in (p.get("roof_key"), "天面空地", "天面"):
                h = units.get((p.get("bld"), rk))
                if h and len(h) == 1:
                    hit, roof_no = h, rk
                    break
            if p.get("bld") and hit:
                binds.append((tid, p["bld"], roof_no, hit[0][1]))
                plan.append((tid, cid, tname, cbld, fkey, area, loc, p["bld"], "text",
                             roof_no, hit[0][1], "match", ";".join(flags)))
                stats["ok"] += 1
            else:
                todo.append((tid, cid, tname, cbld, fkey, area, loc, "天面单元不存在,楼层语义人工定"))
                stats["manual"] += 1
            continue
        if bucket == "no_bld":
            resolved = []
            for uno, f in p["items"]:
                cands = by_no.get(uno, [])
                if "宿舍" in norm(loc):
                    cands = [c_ for c_ in cands if c_[0] in DORM_BLDS]
                if len(cands) == 1:   # uk_unit(building_id,unit_no) 唯一,同栋多命中不存在
                    resolved.append((cands[0][0], uno, cands[0][2]))
                else:
                    resolved = None
                    reason = ("无楼栋且房号零命中(需连栋带房人工定)" if not cands
                              else "无楼栋且房号多栋歧义")
                    break
            if resolved:
                for b_, uno, f_ in resolved:
                    fl = ["room_unique"] + ([f"bld_mismatch(合同{cbld})"] if cbld is not None and b_ != cbld else [])
                    binds.append((tid, b_, uno, f_))
                    plan.append((tid, cid, tname, cbld, fkey, area, loc, b_, "room_unique",
                                 uno, f_, "match", ";".join(flags + fl)))
                stats["ok"] += 1
            else:
                todo.append((tid, cid, tname, cbld, fkey, area, loc, reason))
                stats["manual"] += 1
            continue
        if bucket == "manual":
            # 兜底:场地名整体就是单元名(饭堂/空地一…)——先按文本或合同栋精确匹配,再全库唯一匹配
            if p["reason"].startswith("解析不出"):
                tnorm = norm(loc)
                bg = parse_building(tnorm) or cbld
                hit = units.get((bg, tnorm))
                cands = [c_ for c_ in by_no.get(tnorm, [])]
                if hit and len(hit) == 1:
                    binds.append((tid, bg, tnorm, hit[0][1]))
                    plan.append((tid, cid, tname, cbld, fkey, area, loc, bg, "unit_name",
                                 tnorm, hit[0][1], "match", ";".join(flags)))
                    stats["ok"] += 1
                    continue
                if len(cands) == 1:
                    b_, _, f_ = cands[0]
                    fl = ["unit_name_unique"] + ([f"bld_mismatch(合同{cbld})"] if cbld is not None and b_ != cbld else [])
                    binds.append((tid, b_, tnorm, f_))
                    plan.append((tid, cid, tname, cbld, fkey, area, loc, b_, "unit_name",
                                 tnorm, f_, "match", ";".join(flags + fl)))
                    stats["ok"] += 1
                    continue
            todo.append((tid, cid, tname, cbld, fkey, area, loc, p["reason"]))
            stats["manual"] += 1
            continue

        bld = p["bld"]
        if cbld is not None and bld != cbld:
            flags.append(f"bld_mismatch(合同{cbld})")
        if norm(loc) in CURATED_NOTE:
            flags.append("curated:" + CURATED_NOTE[norm(loc)])
        ok_row = True
        row_plan, row_binds, row_new = [], [], []
        for uno, f in p["items"]:
            hit = units.get((bld, uno))
            if hit and len(hit) == 1:
                uid, ufloor = hit[0]
                if f is not None and ufloor != f:
                    flags.append(f"floor_conflict({uno}:册{ufloor} vs 文本{f})")
                row_binds.append((tid, bld, uno, ufloor))
                row_plan.append((tid, cid, tname, cbld, fkey, area, loc, bld, p["bld_src"],
                                 uno, ufloor, "match", None))
            elif hit:
                todo.append((tid, cid, tname, cbld, fkey, area, loc, f"同栋同号多单元({uno})"))
                ok_row = False
                break
            else:
                if f is None:
                    todo.append((tid, cid, tname, cbld, fkey, area, loc,
                                 f"缺房({uno})且楼层无法仲裁(文本层与房号层打架)"))
                    ok_row = False
                    break
                sus = dup_suspects(bld, uno)
                if sus:
                    todo.append((tid, cid, tname, cbld, fkey, area, loc,
                                 f"疑似同房异名({uno}≈既有{','.join(sus)}),人工认对后指认,不自动新建"))
                    ok_row = False
                    break
                row_new.append((bld, f, uno))
                row_binds.append((tid, bld, uno, f))
                row_plan.append((tid, cid, tname, cbld, fkey, area, loc, bld, p["bld_src"],
                                 uno, f, "create", None))
        if ok_row:
            for r_ in row_plan:
                plan.append(r_[:12] + (";".join(flags),))
            binds += row_binds
            for k_ in row_new:
                new_units[k_] = True
            stats["ok"] += 1
        else:
            stats["manual"] += 1

    # ── 写 TSV ──
    def cell(v):   # location 原文可含换行/制表符,写 TSV 前转义
        return "" if v is None else str(v).replace("\t", " ").replace("\r", "").replace("\n", "⏎")

    with io.open(PLAN, "w", encoding="utf-8-sig", newline="") as fh:
        fh.write("term_id\tcontract_id\t租户\t合同栋\tfee_key\t面积\tlocation\t绑定栋\t栋来源\tunit_no\t楼层\t方式\tflags\n")
        for r in plan:
            fh.write("\t".join(cell(v) for v in r) + "\n")
    with io.open(TODO, "w", encoding="utf-8-sig", newline="") as fh:
        fh.write("term_id\tcontract_id\t租户\t合同栋\tfee_key\t面积\tlocation\t原因\n")
        for r in todo:
            fh.write("\t".join(cell(v) for v in r) + "\n")

    # ── 写 SQL(硬断言:漂移即报错中断;幂等守卫与 uk_unit(building_id,unit_no) 同键) ──
    lines = [
        "-- bt-unit-bind-20260809.sql — 计费行⇄单元绑定回填(derive_bt_unit_bind.py 生成,勿手改)",
        "-- 前置:V91__billing_term_unit.sql 已建表;执行前备份(backup-before-bt-unit-bind-20260809.sql)",
        "SET NAMES utf8mb4;",
        f"-- 硬断言:计费行总数应为 {total};不符时下一句触发『Subquery returns more than 1 row』中断,勿绕过,重跑推导脚本",
        f"SET @guard = IF((SELECT COUNT(*) FROM contract_billing_term)={total}, 1, (SELECT 1 UNION SELECT 2));",
        "START TRANSACTION;",
    ]
    for (bld, f, uno) in sorted(new_units):
        lines.append(
            f"INSERT INTO unit (building_id, floor, unit_no, area) SELECT {bld}, {f}, '{uno}', 0.00"
            f" WHERE NOT EXISTS (SELECT 1 FROM unit WHERE building_id={bld} AND unit_no='{uno}');")
    for tid, bld, uno, f in binds:
        fcond = "" if f is None else f" AND u.floor={f}"
        lines.append(
            f"INSERT INTO billing_term_unit (term_id, unit_id, source)"
            f" SELECT {tid}, u.id, 'derived' FROM unit u"
            f" WHERE u.building_id={bld} AND u.unit_no='{uno}'{fcond}"
            f" AND NOT EXISTS (SELECT 1 FROM billing_term_unit b WHERE b.term_id={tid} AND b.unit_id=u.id);")
    lines.append(f"-- 提交前二次断言:绑定总数应≥{len(binds)}(房册漂移导致的静默零插在此变成硬失败)")
    lines.append(f"SET @guard2 = IF((SELECT COUNT(*) FROM billing_term_unit)>={len(binds)}, 1, (SELECT 1 UNION SELECT 2));")
    lines.append("COMMIT;")
    lines.append(f"-- 期望绑定行数(全量重跑时):{len(binds)};新建 unit:{len(new_units)}")
    with io.open(SQL, "w", encoding="utf-8", newline="\n") as fh:
        fh.write("\n".join(lines) + "\n")

    print(f"计费行 {total} | 绑定 ok {stats['ok']} | manual {stats['manual']}"
          f" | 绑定关系 {len(binds)} 条 | 新建 unit {len(new_units)} 个")
    print(f"plan → {PLAN}\ntodo → {TODO}\nsql  → {SQL}")


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        sys.exit(0 if selftest() else 1)
    main()
