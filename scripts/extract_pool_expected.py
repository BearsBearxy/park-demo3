# -*- coding: utf-8 -*-
"""extract_pool_expected.py — S3-B1 刀3:池核算引擎种子与期望值 fixture(POOL-ENGINE-SPEC §5)。

程序化解析两册 2024-02 水电费 Excel(公式 + 缓存值各读一遍),产出:
  1. demo3/scripts/pool-expected-2024-02.json      — 期望值 fixture(51 池 + dorm 2 + 损耗全列 + 合计锚点)
  2. .../db/migration/V65__pool_seed.sql           — 幂等种子(rule/绑定/links/cfg 月行,按名 join)

铁律:期望值一律取自 Excel 单元格(公式或缓存值),脚本内不出现任何手抄期望数字;
     仅结构识别常数(148918.01/80000/12487.04 = 审计实证的 base_key 映射)例外。
自校验:抽取的池定义代回公式复算(Decimal HALF_UP)与 Excel 缓存值比对,不合即退出非 0。
"""
import json
import os
import re
import sys
from decimal import Decimal, ROUND_HALF_UP

import openpyxl

BASE = r"C:\financial_dashboard\2025全年发生额、预算对比\2024年\2024年3月费用数据\2024年3月费用数据"
P1_XLSX = os.path.join(BASE, "一期", "一期2024年2月水电费.xlsx")
P2_XLSX = os.path.join(BASE, "二期", "二期2024年2月水电费.xlsx")
OUT_DIR = os.path.dirname(os.path.abspath(__file__))
JSON_OUT = os.path.join(OUT_DIR, "pool-expected-2024-02.json")
# ⚠ V65 已应用冻结(Flyway checksum),本脚本不再直写迁移;全新库口径=V65(旧名)+V67(改名/挂栋)。
# SQL 仍生成到 scratch 供人工比对,不进 migration 目录。
SQL_OUT = os.path.join(OUT_DIR, "pool-seed-generated.sql.txt")
YM = "2024-02"

# 结构识别常数(审计实证的面积基数 → 价目簿 base_key 映射,非期望值)
BASE_KEY_BY_AREA = {"148918.01": ("p2", "area_base"),
                    "80000": ("p1", "lamp_area_base"),
                    "12487.04": ("p1", "elevator_area_base")}
DORM_AREA_BASE_KEY = "lamp_area_base"   # dorm 15510 已在 tenant_price_cfg dorm 行

approx_notes = []   # 浮点半值进位型 ≈ 匹配(W65 型),报告用
errors = []


def D(v):
    return Decimal(str(v))


def rnd(v, scale):
    """Excel ROUND = half away from zero。"""
    q = Decimal(1).scaleb(-scale)
    d = D(v)
    return (d.copy_abs().quantize(q, rounding=ROUND_HALF_UP)).copy_sign(d)


def check(tag, computed, cached, tol=Decimal("0.011")):
    """复算 vs 缓存值:全等通过;|差|<=tol 记 ≈(浮点半值进位);否则记错误。"""
    c = D(cached)
    if computed == c:
        return
    if (computed - c).copy_abs() <= tol:
        approx_notes.append(f"{tag}: 复算 {computed} vs 缓存 {c}(浮点半值进位,差 {computed - c})")
        return
    errors.append(f"{tag}: 复算 {computed} != 缓存 {c}")


def fnum(x):
    return float(D(x)) if x is not None else None


def load(path):
    wf = openpyxl.load_workbook(path, data_only=False)
    wv = openpyxl.load_workbook(path, data_only=True)
    return wf, wv


def fee_key_of(zone, name):
    if "楼梯间" in name:
        return "share_elec_floor"
    if any(k in name for k in ("货梯", "客梯", "电梯")):
        return "share_elec_elevator"
    if any(k in name for k in ("路灯", "装饰灯", "广告字")):
        return "share_elec_light"
    return "share_elec_fire" if zone == "p2" else "share_elec_floor"


# ══════════════ 二期「公共电数据」20 池 + 广联 ref ══════════════
def parse_p2(rules, links, fixture):
    wf, wv = load(P2_XLSX)
    sf, sv = wf["公共电数据"], wv["公共电数据"]

    heads = [r for r in range(4, 125) if sv.cell(r, 9).value == "总" and sf.cell(r, 1).value]
    blocks = []          # (head, end_exclusive)
    for i, h in enumerate(heads):
        end = heads[i + 1] if i + 1 < len(heads) else 126
        blocks.append((h, end))
    head_name = {}       # 任意行 → 所属块头表标识(A列,meter.name join 键)
    head_pool = {}       # 任意行 → 所属块池名(B列车间+D列公摊类别,对照原册排布,V67 定名)
    def pool_name_of(h):
        a, d = sv.cell(h, 2).value, sv.cell(h, 4).value
        return f"{a}{d}".strip() if (a and d) else sf.cell(h, 1).value
    for h, end in blocks:
        pn = pool_name_of(h)
        for r in range(h, end):
            head_name[r] = sf.cell(h, 1).value
            head_pool[r] = pn

    for h, end in blocks:
        name = sf.cell(h, 1).value             # A 列表标识(绑表用)
        pool_name = pool_name_of(h)            # 池名(展示/规则/fixture 键)
        area_b = sv.cell(h, 2).value           # B 列物理位置(车间)
        seg = {}                               # label -> row
        for r in range(h, end):
            lab = sv.cell(r, 9).value
            lf = sf.cell(r, 12).value
            if lab == "总":
                seg["total"] = r
            elif lab == "尖峰":
                seg["sharp1"] = r
            elif lab == "峰":
                seg["peak"] = r
            elif lab == "平":
                seg["flat"] = r
            elif lab == "谷":
                seg["valley"] = r
            elif lab is None and isinstance(lf, str) and re.search(r"二期园区电!AB\d+", lf):
                seg["sharp2"] = r      # 隐藏尖行(比率折出;火炬园块引 AB15 断链,其余引 AB4)
        # 剔除分表(sign=-1):块内 L 公式引用块外行
        negs = []
        for r in range(h, end):
            lf = sf.cell(r, 12).value
            if not isinstance(lf, str):
                continue
            for m in re.finditer(r"-L(\d+)", lf):
                t = int(m.group(1))
                if not (h <= t < end):
                    nm = head_name.get(t)
                    if nm and nm not in negs:
                        negs.append(nm)

        t_val = sv.cell(h, 20).value
        s_val = sv.cell(h, 19).value or ""
        v_f = sf.cell(h, 22).value
        v_v = sv.cell(h, 22).value
        w_v = sv.cell(h, 23).value
        factor = sv.cell(h, 8).value

        # 分摊语义
        method, coefficient, base_key, std_kind, scale = "area", None, None, None, 2
        if "不分摊" in str(s_val):
            method = "none"
        elif t_val is not None and str(t_val) in BASE_KEY_BY_AREA:
            method, base_key = "area", BASE_KEY_BY_AREA[str(t_val)][1]
        elif t_val is not None:
            method = "floor"
            coefficient = D(t_val)
        if isinstance(v_f, str):
            m = re.search(r"ROUND\(.*?,\s*(\d)\s*\)", v_f)
            if m:
                scale = int(m.group(1))
            if re.search(r"ROUND\(L\d+/T\d+", v_f):
                std_kind = "qty_over_base"
            if re.search(r"/T\d+/4\*3", v_f):        # 四车间电梯 3/4 折 → 等效系数 T*4/3
                coefficient = D(t_val) * 4 / 3
            for fm in re.finditer(r"\+V(\d+)", v_f):
                links.append({"src": ("p2", head_pool[int(fm.group(1))]),
                              "dst": ("p2", pool_name), "type": "fold_price"})

        Lv = {k: sv.cell(r, 12).value for k, r in seg.items()}
        Uv = {k: sv.cell(r, 21).value for k, r in seg.items()}
        exp = {
            "zone": "p2", "name": pool_name,
            "qtyTotal": fnum(Lv.get("total")),
            "qtySharp": fnum(D(Lv.get("sharp1") or 0) + D(Lv.get("sharp2") or 0)),
            "qtyPeak": fnum(Lv.get("peak")), "qtyFlat": fnum(Lv.get("flat")),
            "qtyValley": fnum(Lv.get("valley")),
            "cost": fnum(w_v), "std": fnum(v_v) if method != "none" else None,
            "base": fnum(coefficient) if coefficient is not None else (fnum(t_val) if base_key else None),
        }
        fixture["pools"].append(exp)

        # ── 自校验:W = ROUND(Σ段L×段U,2);V 按语义复算 ──
        unrounded = sum((D(Lv.get(k) or 0) * D(Uv.get(k) or 0)
                         for k in ("sharp1", "sharp2", "peak", "flat", "valley")), Decimal(0))
        if w_v is not None:
            check(f"p2 {pool_name} W", rnd(unrounded, 2), w_v)
        if v_v is not None and method != "none":
            fold = sum((D(sv.cell(int(fm.group(1)), 22).value)
                        for fm in re.finditer(r"\+V(\d+)", v_f or "")), Decimal(0))
            if std_kind == "qty_over_base":
                comp = rnd(D(Lv["total"]) / D(t_val), scale)
            elif base_key:
                comp = rnd(unrounded / D(t_val), scale) + fold
            else:
                comp = rnd(unrounded / coefficient, scale) + fold
            check(f"p2 {pool_name} V", comp, v_v)

        rules.append({
            "zone": "p2", "name": pool_name,
            "building": f"二期 {area_b}" if (area_b and area_b != "园区") else None,   # 原册B列=物理车间分带,园区级=NULL
            "method": method, "coefficient": coefficient, "base_key": base_key,
            "std_kind": std_kind, "round_scale": scale,
            "fee_key": fee_key_of("p2", pool_name),
            "note": None,
            "meters": [("elec", "p2", name, 1, factor)] + [("elec", "p2", n, -1, None) for n in negs],
            "cfg": ({"coefficient": coefficient} if coefficient is not None else {}),
        })

        # 广联分摊 ref 行(块内 U='广联分摊' 的独立 V 行)
        for r in range(h, end):
            if sv.cell(r, 21).value == "广联分摊":
                gf = sf.cell(r, 22).value
                gv = sv.cell(r, 22).value
                gm = re.search(r"/T(\d+)/4\+V(\d+)", gf)
                gsc = int(re.search(r"ROUND\(.*?,\s*(\d)\s*\)", gf).group(1))
                gadd = re.search(r"\)\s*\+\s*(\d+(?:\.\d+)?)\s*$", gf)
                std_add = D(gadd.group(1)) if gadd else Decimal(0)
                gcoef = D(sv.cell(int(gm.group(1)), 20).value) * 4      # 层价/4 → 等效系数 T*4
                src_name = head_pool[int(gm.group(2))]
                gname = "广联分摊"
                links.append({"src": ("p2", src_name), "dst": ("p2", gname), "type": "fold_price"})
                rules.append({
                    "zone": "p2", "name": gname, "building": f"二期 {area_b}",
                    "method": "ref", "coefficient": gcoef, "base_key": None,
                    "std_kind": None, "round_scale": gsc,
                    "fee_key": "share_elec_elevator", "note": "广联/氙明/威玛斯按全层价+100元(V64)",
                    "meters": [("elec", "p2", name, 1, factor)],
                    "cfg": {"coefficient": gcoef, "std_add": std_add},
                })
                fixture["pools"].append({
                    "zone": "p2", "name": gname, "qtyTotal": None, "qtySharp": None,
                    "qtyPeak": None, "qtyFlat": None, "qtyValley": None,
                    "cost": None, "std": fnum(gv), "base": fnum(gcoef)})
                comp = rnd(unrounded / D(t_val) / 4 + D(v_v), 2) + std_add
                check("p2 广联分摊 V64", comp, gv)

    # 合计锚点 L126/W126
    fixture["totals"]["p2"] = {"qtyTotal": fnum(sv.cell(126, 12).value),
                               "cost": fnum(sv.cell(126, 23).value),
                               "allocated": fnum(sv.cell(126, 24).value),
                               "gap": fnum(sv.cell(126, 25).value)}
    return wf, wv


# ══════════════ 一期「公共电分摊明细」 ══════════════
def parse_p1(rules, links, fixture):
    wf, wv = load(P1_XLSX)
    sf, sv = wf["公共电分摊明细"], wv["公共电分摊明细"]
    pf, pv = wf["一期园区电"], wv["一期园区电"]

    park_names = {}      # 一期园区电 行号 → A 名;名字集合用于幽灵表检测
    for r in range(1, 260):
        a = pv.cell(r, 1).value
        if isinstance(a, str) and a.strip():
            park_names[r] = a.strip()
    park_name_set = set(park_names.values())

    ab_price = None      # 创显承担电费!O3 缓存(单价链单点)

    def row_meter(r):
        return sv.cell(r, 1).value

    # ── 园区公共池(r5-r9)+ 招商净电子池(r8) ──
    park_rows = [r for r in range(5, 10) if r != 8]
    park_meters = [("elec", "p1", row_meter(r), 1, sv.cell(r, 8).value) for r in park_rows]
    x50f = pf.cell(50, 24).value                     # '=S49+S50-SUM(S44:S48)'
    rng = re.search(r"SUM\(S(\d+):S(\d+)\)", x50f)
    minus = list(range(int(rng.group(1)), int(rng.group(2)) + 1))
    plus = [int(m) for m in re.findall(r"S(\d+)", re.sub(r"SUM\([^)]*\)", "", x50f))]
    zs_extra = D(sv.cell(8, 14).value)               # N8 = -670
    zs_name = "招商中心净电"                          # A8='招商中心电1' 与表名撞名,改用审计名(报告注明)
    zs_meters = ([("elec", "p1", park_names[r], 1, pv.cell(r, 8).value) for r in plus]
                 + [("elec", "p1", park_names[r], -1, pv.cell(r, 8).value) for r in minus])
    rules.append({"zone": "p1", "name": zs_name, "building": None, "method": "direct",
                  "coefficient": None, "base_key": None, "std_kind": None, "round_scale": 2,
                  "fee_key": "share_elec_floor",
                  "note": "招商中心两块80倍总表-5子表-670度自用(S8=X50-670),经fold_qty入园区公摊池",
                  "meters": zs_meters, "cfg": {"extra_qty": zs_extra}})
    rules.append({"zone": "p1", "name": "园区公共电", "building": None, "method": "loss",
                  "coefficient": None, "base_key": None, "std_kind": None, "round_scale": 2,
                  "fee_key": "park_loss_pool",
                  "note": "一期园区公共5表(车库照明×2/A1大堂/生活泵/招商净电),Σ/6平摊A-F座损耗率",
                  "meters": park_meters, "cfg": {}})
    links.append({"src": ("p1", zs_name), "dst": ("p1", "园区公共电"), "type": "fold_qty"})

    park_qty = sum((D(sv.cell(r, 19).value) for r in range(5, 10)), Decimal(0))
    park_cost = sum((D(sv.cell(r, 30).value) for r in range(5, 10)), Decimal(0))
    fixture["pools"].append({"zone": "p1", "name": zs_name,
                             "qtyTotal": fnum(sv.cell(8, 19).value),
                             "cost": fnum(sv.cell(8, 30).value), "std": fnum(sv.cell(8, 29).value),
                             "base": None})
    fixture["pools"].append({"zone": "p1", "name": "园区公共电", "qtyTotal": fnum(park_qty),
                             "cost": fnum(park_cost), "std": None, "base": None})
    # 自校验:X50 净额 + N8
    x50 = sum((D(pv.cell(r, 19).value) for r in plus), Decimal(0)) \
        - sum((D(pv.cell(r, 19).value) for r in minus), Decimal(0))
    check("p1 招商净电 S8", x50 + zs_extra, sv.cell(8, 19).value)

    manual_readings = fixture["manual_readings"]

    for r in range(5, 97):
        acf = sf.cell(r, 29).value
        if not (isinstance(acf, str) and acf.startswith("=")):
            continue
        bcell = sv.cell(r, 2).value or ""
        if "合计" in str(bcell):
            continue
        if r in range(5, 10):
            continue                                  # 园区公共池已单独成规则
        name = row_meter(r)
        ab = sv.cell(r, 28).value
        ab_price = ab_price or ab
        m = re.match(r"=ROUND\((.+),\s*(\d)\s*\)\s*$", acf)
        expr, scale = m.group(1), int(m.group(2))
        num = expr.split("/AA")[0].split("*AB")[0]
        srows = [int(x) for x in re.findall(r"S(\d+)", num)]
        extra = sum((D(x) for x in re.findall(r"(?<![A-Z0-9.])(\d+(?:\.\d+)?)", re.sub(r"[SAB]+\d+", "", num))),
                    Decimal(0))
        aa = sv.cell(r, 27).value if "/AA" in expr else None

        if aa is None:
            method, coefficient, base_key = "direct", None, None
        elif D(aa) in (Decimal(3), Decimal(4)):
            method, coefficient, base_key = "floor", D(aa), None
        elif str(aa) in BASE_KEY_BY_AREA:
            method, coefficient, base_key = "area", None, BASE_KEY_BY_AREA[str(aa)][1]
        else:
            method, coefficient, base_key = "area", D(aa), None

        meters, phantom = [], []
        for sr in srows:
            mn = row_meter(sr)
            if mn in park_name_set:
                meters.append(("elec", "p1", mn, 1, sv.cell(sr, 8).value))
            else:
                phantom.append(mn)
        if phantom:
            fixture["phantom_meters"].extend(
                {"rule": name, "meter": p, "reason": "一期园区电无此表(VLOOKUP miss,S=0)"} for p in phantom)

        # 手输行至(C2消防/C2走廊):I=外部工作簿断链缓存,N=手输数值
        i_f, n_f = sf.cell(r, 9).value, sf.cell(r, 14).value
        if isinstance(i_f, str) and "[2]" in i_f and not isinstance(n_f, str):
            manual_readings.append({"zone": "p1", "meter": name,
                                    "prev": fnum(sv.cell(r, 9).value), "curr": fnum(n_f),
                                    "note": "外链断裂靠缓存,验证刀须先补录 2024-02 读数"})

        qty = sum((D(sv.cell(sr, 19).value or 0) for sr in srows), Decimal(0))
        cost = Decimal(0)
        missing_ad = []
        for sr in srows:
            adv = sv.cell(sr, 30).value
            adf = sf.cell(sr, 30).value
            if isinstance(adf, str):
                cost += D(adv)
                check(f"p1 r{sr} AD", rnd(D(sv.cell(sr, 19).value) * D(ab), 2), adv)
            else:
                missing_ad.append(sr)
        if missing_ad:
            for sr in missing_ad:
                add = rnd(D(sv.cell(sr, 19).value) * D(ab), 2)
                fixture["known_diff"].append(
                    {"pool": name, "issue": f"r{sr} Excel 漏 AD 行,引擎 cost 会多 ROUND({sv.cell(sr, 19).value}×{ab},2)={add}",
                     "engineExtra": fnum(add)})
        acv = sv.cell(r, 29).value
        fixture["pools"].append({"zone": "p1", "name": name, "qtyTotal": fnum(qty),
                                 "cost": fnum(cost), "std": fnum(acv),
                                 "base": fnum(aa) if aa is not None else None})
        # 自校验 AC
        if aa is None:
            comp = rnd(qty * D(ab), scale)
        else:
            comp = rnd((qty + extra) / D(aa) * D(ab), scale)
        check(f"p1 {name} AC(r{r})", comp, acv)

        bmap = re.match(r"([A-G]座)", str(bcell))
        rules.append({"zone": "p1", "name": name,
                      "building": f"一期 {bmap.group(1)}" if bmap else None,
                      "method": method, "coefficient": coefficient, "base_key": base_key,
                      "std_kind": None, "round_scale": scale,
                      "fee_key": fee_key_of("p1", name), "note": sv.cell(r, 33).value,
                      "meters": meters,
                      "cfg": ({} if coefficient is None else {"coefficient": coefficient})
                      | ({} if extra == 0 else {"extra_qty": extra})})
    return wf, wv, ab_price


# ══════════════ 宿舍 2 池 ══════════════
def parse_dorm(rules, fixture, wf1, wv1):
    ef, ev = wf1["宿舍电"], wv1["宿舍电"]
    wfw, wvw = wf1["宿舍水"], wv1["宿舍水"]

    # 路灯池:K339 = M336+M338+M337+M58+M200
    kf = ef.cell(339, 11).value
    rows = [int(x) for x in re.findall(r"M(\d+)", kf)]
    names = [ev.cell(r, 1).value for r in rows]
    factors = [ev.cell(r, 10).value for r in rows]
    price = D(ev.cell(339, 12).value)                     # [4]创显承担电费!N3 缓存 1.13156875
    m339f = ef.cell(339, 13).value                        # '=ROUND(K339*L339/15510,2)'
    base = D(re.search(r"/(\d+(?:\.\d+)?)", m339f).group(1))
    qty = D(ev.cell(339, 11).value)
    std = ev.cell(339, 13).value
    lamp_name = ev.cell(339, 1).value                     # '宿舍路灯公摊'
    rules.append({"zone": "dorm", "name": lamp_name, "building": None, "method": "area",
                  "coefficient": None, "base_key": DORM_AREA_BASE_KEY, "std_kind": None,
                  "round_scale": 2, "fee_key": "share_elec_light",
                  "note": "5块表(路灯总表/三四栋/一二栋路边灯/一四栋宿舍电梯),化石价1.13156875复刻",
                  "meters": [("elec", "dorm", n, 1, f) for n, f in zip(names, factors)],
                  "cfg": {"price_override": price}})
    fixture["pools"].append({"zone": "dorm", "name": lamp_name, "qtyTotal": fnum(qty),
                             "cost": None, "std": fnum(std), "base": fnum(base)})
    check("dorm 路灯 M339", rnd(qty * price / base, 2), std)
    check("dorm 路灯 K339", sum((D(ev.cell(r, 13).value) for r in rows), Decimal(0)), qty)

    # 绿化水池:M298 = ROUND(M297*4.45/15510,2),无表手输 84 吨
    m298f = wfw.cell(298, 13).value
    gw = re.search(r"M297\*(\d+(?:\.\d+)?)/(\d+(?:\.\d+)?)", m298f)
    gprice, gbase = D(gw.group(1)), D(gw.group(2))
    gqty = D(wvw.cell(297, 13).value)
    gstd = wvw.cell(298, 13).value
    gname = wvw.cell(298, 1).value                        # '宿舍绿化水公摊'
    rules.append({"zone": "dorm", "name": gname, "building": None, "method": "area",
                  "coefficient": None, "base_key": DORM_AREA_BASE_KEY, "std_kind": None,
                  "round_scale": 2, "fee_key": "share_green_water",
                  "note": "无表,手输84吨×4.45元/吨÷15510㎡", "meters": [],
                  "cfg": {"manual_qty": gqty, "price_override": gprice}})
    fixture["pools"].append({"zone": "dorm", "name": gname, "qtyTotal": fnum(gqty),
                             "cost": None, "std": fnum(gstd), "base": fnum(gbase)})
    check("dorm 绿化水 M298", rnd(gqty * gprice / gbase, 2), gstd)


# ══════════════ 损耗表(一期/二期) ══════════════
def parse_loss(fixture, cfg_rows, wf1, wv1):
    lf, lv = wf1["一期园区损耗"], wv1["一期园区损耗"]
    pf1, pv1 = wf1["一期园区电"], wv1["一期园区电"]
    units = []
    sum_f = lf.cell(13, 3).value                           # '=SUM(C6:C12)' → A座不在合计=独立链路
    sum_rows = None
    mrng = re.search(r"SUM\(C(\d+):C(\d+)\)", sum_f or "")
    if mrng:
        sum_rows = range(int(mrng.group(1)), int(mrng.group(2)) + 1)
    for r in range(4, 13):
        pos = lv.cell(r, 2).value
        if pos is None or lv.cell(r, 3).value is None:
            continue
        c = D(lv.cell(r, 3).value)
        d = D(lv.cell(r, 4).value)
        i_f = lf.cell(r, 9).value
        g_f = lf.cell(r, 7).value
        if not isinstance(i_f, str):                       # G座类:无率
            units.append({"name": pos, "c": fnum(c), "cable": None, "d": fnum(d),
                          "e": fnum(d - c), "rawRate": fnum(rnd((d - c) / c, 4)) if c else None,
                          "g": None, "adjQty": None, "adjRate": None,
                          "variant": "none", "tenantRate": None})
            continue
        e = d - c
        g = D(lv.cell(r, 7).value)
        h = D(lv.cell(r, 8).value)
        i = D(lv.cell(r, 9).value)
        variant = "share_only" if i_f.startswith("=ROUND(G") else "net"
        g_adj = Decimal(0)
        gm = re.search(r"\)\s*(-\d+(?:\.\d+)?)\s*$", g_f or "")
        if gm:
            g_adj = D(gm.group(1))
        comp = (rnd(g / c, 4) + h) if variant == "share_only" else (-rnd((e - g) / c, 4) + h)
        check(f"p1 损耗 {pos} I", comp, i)
        units.append({"name": pos, "c": fnum(c), "cable": None, "d": fnum(d), "e": fnum(rnd(e, 2)),
                      "rawRate": fnum(rnd(e / c, 4)), "g": fnum(g), "adjQty": 0,
                      "adjRate": fnum(h), "variant": variant, "tenantRate": fnum(i)})
        b = f"一期 {pos}"
        cfg_rows.append(("building", b, "loss_adj_rate", h, YM, f"一期{pos} H列加点(损耗表)"))
        if g_adj != 0:
            cfg_rows.append(("building", b, "loss_g_adj", g_adj, YM, f"一期{pos} G列硬编码扣度(待调整8500度备注)"))
        if variant == "share_only":
            cfg_rows.append(("building", b, "loss_variant", Decimal(1), "", f"一期{pos} 纯公摊式(审计:变体按座配置)"))
        if sum_rows and r not in sum_rows:
            cfg_rows.append(("building", b, "loss_recon", Decimal(0), "", f"一期{pos} 独立供电链路,排除对账"))
    fixture["loss"]["p1"] = units
    # 供电侧总表(C15 = 一期园区电!S93 → 行 A 名)
    sup = re.search(r"S(\d+)", lf.cell(15, 3).value)
    p1_supply = (pv1.cell(int(sup.group(1)), 1).value, pv1.cell(int(sup.group(1)), 8).value)
    fixture["loss"]["p1_supply_meter"] = p1_supply[0]
    fixture["loss"]["p1_recon"] = {"supply": fnum(lv.cell(15, 3).value),
                                   "sumC": fnum(lv.cell(13, 3).value),
                                   "sumD": fnum(lv.cell(13, 4).value)}

    # ── 二期 ──
    wf2, wv2 = load(P2_XLSX)
    zf, zv = wf2["二期园区损耗"], wv2["二期园区损耗"]
    pf2, pv2 = wf2["二期园区电"], wv2["二期园区电"]
    units2 = []
    merged = None                                          # (成员行list, 头行C所在行)
    for r in range(4, 10):
        f_f = zf.cell(r, 6).value
        if isinstance(f_f, str) and re.match(r"=E\d+\+E\d+", f_f):
            mem = [int(x) for x in re.findall(r"E(\d+)", f_f)]
            headr = int(re.search(r"-C(\d+)", f_f).group(1))
            merged = (mem, headr, r)
    for r in range(4, 10):
        pos = zv.cell(r, 2).value
        if pos is None:
            continue
        if merged and r in merged[0] and r != merged[2]:
            continue                                       # 合并单元只出组行
        if merged and r == merged[2]:
            mem, headr, _ = merged
            names = "/".join(zv.cell(x, 2).value for x in mem)
            c = D(zv.cell(headr, 3).value)
            d = sum((D(zv.cell(x, 5).value) for x in mem), Decimal(0))
            cable = D(zv.cell(headr, 4).value or 0)
            f_val = D(zv.cell(r, 6).value)
            h = D(zv.cell(r, 8).value)
            i = D(zv.cell(r, 9).value)
            j = D(zv.cell(r, 10).value)
            check(f"p2 损耗 {names} F", d - c, f_val)
            check(f"p2 损耗 {names} J(外置式)", -rnd((f_val - h) / c, 4) + i, j)
            units2.append({"name": names, "head": zv.cell(headr, 2).value, "c": fnum(c),
                           "cable": fnum(cable), "d": fnum(d), "e": fnum(rnd(f_val, 2)),
                           "rawRate": fnum(rnd(f_val / c, 4)), "g": None, "adjQty": fnum(h),
                           "adjRate": fnum(i), "variant": "net", "tenantRate": fnum(j)})
            head_b = f"二期 {zv.cell(headr, 2).value}"
            for x in mem:
                if x != headr:
                    cfg_rows.append(("building", f"二期 {zv.cell(x, 2).value}", "loss_head",
                                     ("BID", head_b), "", f"共享{zv.cell(headr, 2).value}总表(合并计损)"))
            cfg_rows.append(("building", head_b, "loss_adj_qty", h, YM, "二期H列调整度数(合并单元)"))
            cfg_rows.append(("building", head_b, "loss_adj_rate", i, YM, "二期I列加点"))
            continue
        c = D(zv.cell(r, 3).value)
        e = D(zv.cell(r, 5).value)
        cable = zv.cell(r, 4).value
        f_val = D(zv.cell(r, 6).value)
        h = D(zv.cell(r, 8).value)
        i = D(zv.cell(r, 9).value)
        j = D(zv.cell(r, 10).value)
        check(f"p2 损耗 {pos} J", -rnd((f_val - h) / c, 4) + i, j)
        units2.append({"name": pos, "head": pos, "c": fnum(c),
                       "cable": fnum(cable) if cable is not None else None, "d": fnum(e),
                       "e": fnum(rnd(f_val, 2)), "rawRate": fnum(rnd(f_val / c, 4)), "g": None,
                       "adjQty": fnum(h), "adjRate": fnum(i), "variant": "net", "tenantRate": fnum(j)})
        b = f"二期 {pos}"
        cfg_rows.append(("building", b, "loss_adj_qty", h, YM, "二期H列调整度数"))
        cfg_rows.append(("building", b, "loss_adj_rate", i, YM, "二期I列加点"))
    fixture["loss"]["p2"] = units2
    sup2 = re.search(r"S(\d+)", zf.cell(12, 3).value)
    p2_supply = (pv2.cell(int(sup2.group(1)), 1).value, pv2.cell(int(sup2.group(1)), 8).value)
    fixture["loss"]["p2_supply_meter"] = p2_supply[0]
    fixture["loss"]["p2_recon"] = {"supply": fnum(zv.cell(12, 3).value),
                                   "sumC": fnum(zv.cell(10, 3).value),
                                   "sumD": fnum(zv.cell(10, 5).value)}
    return p1_supply, p2_supply


# ══════════════ SQL 生成 ══════════════
def esc(s):
    return str(s).replace("\\", "\\\\").replace("'", "''")


def gen_sql(rules, links, cfg_rows, p1_supply, p2_supply):
    out = []
    w = out.append
    w("-- V65__pool_seed.sql — 池核算引擎种子(POOL-ENGINE-SPEC §5,2024-02 锚点月)。")
    w("-- 由 demo3/scripts/extract_pool_expected.py 从两册 2024-02 Excel 程序化生成,勿手改;改动请改脚本重跑。")
    w("-- 幂等:规则按(zone,name)先删后插;meter/building 按名 WHERE NOT EXISTS 补档;绑定/links/cfg 按名 join。")
    w("")

    buildings = sorted({r["building"] for r in rules if r["building"]}
                       | {s for (sc, s, *_rest) in cfg_rows if sc == "building"})
    w("-- ── 楼栋补档(dev 已存在则跳过;测试容器自足) ──")
    for b in buildings:
        phase = 1 if b.startswith("一期") else 2
        w(f"INSERT INTO building (name, phase, floor_count, total_area, rentable_area, status, per_floor)"
          f" SELECT '{esc(b)}', {phase}, 4, 0, 0, 1, 4 FROM DUAL"
          f" WHERE NOT EXISTS (SELECT 1 FROM building WHERE name='{esc(b)}');")
    w("")

    meters = {}
    for r in rules:
        for (kind, zone, name, _sign, factor) in r["meters"]:
            key = (kind, zone, name)
            if key not in meters or (meters[key][0] is None and factor is not None):
                meters[key] = (factor, "share")
    for zone, (name, factor) in (("p1", p1_supply), ("p2", p2_supply)):
        meters.setdefault(("elec", zone, name), (factor, "infra"))
    w("-- ── 表档案补档(仅测试容器等空库需要;dev 由真实导入建档,按 uk(kind,zone,name) 跳过) ──")
    for (kind, zone, name), (factor, own) in sorted(meters.items()):
        f = factor if factor is not None else 1
        w(f"INSERT INTO meter (kind, zone, name, factor, ownership)"
          f" SELECT '{kind}', '{zone}', '{esc(name)}', {f}, '{own}' FROM DUAL"
          f" WHERE NOT EXISTS (SELECT 1 FROM meter WHERE kind='{kind}' AND zone='{zone}' AND name='{esc(name)}');")
    w("")
    w("-- 铝缆表挂栋(损耗表 D 列陈列需要;仅补 NULL 不覆盖人工归属)")
    w("UPDATE meter SET building_id=(SELECT id FROM building WHERE name='二期 三车间')"
      " WHERE kind='elec' AND zone='p2' AND name IN ('三至二铝缆','三至四铝缆') AND building_id IS NULL;")
    w("UPDATE meter SET building_id=(SELECT id FROM building WHERE name='二期 五车间')"
      " WHERE kind='elec' AND zone='p2' AND name IN ('五连六铝缆','五连一铝缆') AND building_id IS NULL;")
    w("")

    name_tuples = ", ".join(f"('{r['zone']}','{esc(r['name'])}')" for r in rules)
    w("-- ── 幂等清场:先清本种子同名规则的 cfg 月行/快照/规则(级联删绑定与links) ──")
    w(f"DELETE c FROM alloc_cfg c JOIN alloc_rule r ON c.scope=CONCAT('rule:',r.id) WHERE (r.zone,r.name) IN ({name_tuples});")
    w(f"DELETE pr FROM alloc_pool_result pr JOIN alloc_rule r ON pr.rule_id=r.id WHERE (r.zone,r.name) IN ({name_tuples});")
    w(f"DELETE FROM alloc_rule WHERE (zone,name) IN ({name_tuples});")
    w("")

    w("-- ── 规则(sort_no 保 Excel 原行序:p1 → p2 → dorm) ──")
    for i, r in enumerate(rules, start=1):
        bid = f"(SELECT id FROM building WHERE name='{esc(r['building'])}')" if r["building"] else "NULL"
        coef = str(r["coefficient"]) if r["coefficient"] is not None else "NULL"
        sk = f"'{r['std_kind']}'" if r["std_kind"] else "NULL"
        bk = f"'{r['base_key']}'" if r["base_key"] else "NULL"
        note = f"'{esc(r['note'])}'" if r.get("note") else "NULL"
        extra_default = r["cfg"].get("extra_qty", Decimal(0))
        w(f"INSERT INTO alloc_rule (zone, name, building_id, method, coefficient, extra_qty, fee_key,"
          f" note, sort_no, round_scale, std_kind, base_key) VALUES"
          f" ('{r['zone']}', '{esc(r['name'])}', {bid}, '{r['method']}', {coef}, {extra_default},"
          f" '{r['fee_key']}', {note}, {i}, {r['round_scale']}, {sk}, {bk});")
    w("")

    w("-- ── 表绑定(按名 join,未命中=绑定行缺失,由种子校验 IT 兜底) ──")
    for r in rules:
        for (kind, zone, name, sign, _f) in r["meters"]:
            w(f"INSERT INTO alloc_rule_meter (rule_id, meter_id, sign)"
              f" SELECT r.id, m.id, {sign} FROM alloc_rule r JOIN meter m"
              f" ON m.kind='{kind}' AND m.zone='{zone}' AND m.name='{esc(name)}'"
              f" WHERE r.zone='{r['zone']}' AND r.name='{esc(r['name'])}';")
    w("")

    w("-- ── 折入链(fold_price×2 + fold_qty×1) ──")
    for l in links:
        (sz, sn), (dz, dn) = l["src"], l["dst"]
        w(f"INSERT INTO alloc_rule_link (src_rule_id, dst_rule_id, link_type)"
          f" SELECT s.id, d.id, '{l['type']}' FROM alloc_rule s JOIN alloc_rule d"
          f" ON d.zone='{dz}' AND d.name='{esc(dn)}'"
          f" WHERE s.zone='{sz}' AND s.name='{esc(sn)}';")
    w("")

    w("-- ── rule:{id} 月度参数(2024-02:层数T/AA基数/加度/手输量/化石价/标准加元) ──")
    for r in rules:
        for k, v in r["cfg"].items():
            w(f"INSERT INTO alloc_cfg (scope, cfg_key, cfg_value, acct_month, note)"
              f" SELECT CONCAT('rule:', r.id), '{k}', {v}, '{YM}', '池月参({esc(r['name'])})'"
              f" FROM alloc_rule r WHERE r.zone='{r['zone']}' AND r.name='{esc(r['name'])}';")
    w("")

    w("-- ── building:{id} 损耗参数(月度数值=2024-02 月行;结构键 loss_head/loss_variant/loss_recon=默认行) ──")
    seen = set()
    for (sc, b, key, val, month, note) in cfg_rows:
        if sc != "building":
            continue
        sig = (b, key, month)
        if sig in seen:
            continue
        seen.add(sig)
        if isinstance(val, tuple) and val[0] == "BID":
            vexpr = f"(SELECT id FROM building WHERE name='{esc(val[1])}')"
        else:
            vexpr = str(val)
        w(f"DELETE c FROM alloc_cfg c JOIN building b ON c.scope=CONCAT('building:',b.id)"
          f" WHERE b.name='{esc(b)}' AND c.cfg_key='{key}' AND c.acct_month='{month}';")
        w(f"INSERT INTO alloc_cfg (scope, cfg_key, cfg_value, acct_month, note)"
          f" SELECT CONCAT('building:', b.id), '{key}', {vexpr}, '{month}', '{esc(note)}'"
          f" FROM building b WHERE b.name='{esc(b)}';")
    w("")

    w("-- ── 对账供电侧总表(读时派生用) ──")
    for zone, (name, _f) in (("p1", p1_supply), ("p2", p2_supply)):
        w(f"DELETE FROM alloc_cfg WHERE scope='{zone}' AND cfg_key='loss_supply_meter' AND acct_month='';")
        w(f"INSERT INTO alloc_cfg (scope, cfg_key, cfg_value, acct_month, note)"
          f" SELECT '{zone}', 'loss_supply_meter', m.id, '', '{esc(name)}(供电局对账总表)'"
          f" FROM meter m WHERE m.kind='elec' AND m.zone='{zone}' AND m.name='{esc(name)}';")
    return "\n".join(out) + "\n"


def main():
    rules, links = [], []
    cfg_rows = []
    fixture = {"ym": YM, "pools": [], "totals": {}, "loss": {},
               "manual_readings": [], "phantom_meters": [], "known_diff": []}

    parse_p2(rules, links, fixture)
    wf1, wv1, _ab = parse_p1(rules, links, fixture)
    parse_dorm(rules, fixture, wf1, wv1)
    p1_supply, p2_supply = parse_loss(fixture, cfg_rows, wf1, wv1)

    # 结构性 known_diff(审计定稿项,位置由脚本定位)
    fixture["known_diff"].append({
        "pool": "五车间电梯+低压电房照明", "issue": "Excel 头行 L83 未剔火炬园670.06(仅平段 L87 剔);引擎平段冲减后 flat/cost/std 全等,"
        "qtyTotal 引擎净额=头值-670.06=1207.54 与册头行陈列口径差,归档不改"})
    fixture["known_diff"].append({
        "pool": "五车间广告字灯（火炬园）", "issue": "Excel W89=0(分摊5行硬置0);引擎按表读数回退平价×总量将出非0成本,待用户拍板"})
    fixture["known_diff"].append({
        "pool": "二期损耗 二/三/四车间", "issue": "Excel J5 把 I 放 ROUND 内(-ROUND((F-H)/C-I,4)),引擎统一外置式,锚点月同值"})
    fixture["known_diff"].append({
        "pool": "六车间电梯+低压电房照明", "issue": "倍率册内冲突:抄表册50 vs 公共电数据40(账单按40计,少收25%);引擎按档案50,待用户拍板"})
    # 损耗单元/对账区 known(引擎结构口径与册差,验证脚本按名/键归档)
    fixture["known_loss"] = {
        "units": [
            {"name": "G座", "issue": "引擎将 G座+G自建专变 两独立供电链合并为一组(C=419.2/D=张执盛分表Σ247.2),"
             "variant=2 仅陈列不出率;Excel 两行独立且 D=C 自引用"},
            {"name": "G座自建专变", "issue": "并入 G座 合并组陈列,单元行不再单独出(见 G座 known)"},
            {"name": "C座", "issue": "C2消防/C2走廊 双源读数:抄表册 29.89/3.16 vs 公共电分摊明细缓存 26.48/6.86,"
             "引擎单一读数源取分摊明细口径(池分摊金额锚点一致),D/E 差 +0.29"},
        ],
        "recon": [
            {"key": "p1.sumD", "issue": "G自建专变 Excel D=C 自引用计入 sumD(+172),引擎合并组按实分表Σ;"
             "另含 C座双源 +0.29 → 引擎 sumD=册值-171.71"},
        ]}

    # 计数(种子校验 IT 断言依据)
    n_bind = sum(len(r["meters"]) for r in rules)
    n_cfg_rule = sum(len(r["cfg"]) for r in rules)
    by_zone = {}
    for r in rules:
        by_zone[r["zone"]] = by_zone.get(r["zone"], 0) + 1
    fixture["counts"] = {"rules": len(rules), "rulesByZone": by_zone, "meterBindings": n_bind,
                         "links": len(links), "ruleCfgRows": n_cfg_rule}

    if errors:
        print("自校验失败(复算 != 缓存值):", file=sys.stderr)
        for e in errors:
            print("  " + e, file=sys.stderr)
        sys.exit(1)

    # 锚点门:Σ池应分摊 == W126;头行度数Σ 另存(L126=总行+分段行混合口径,原样保留为 tfoot 锚)
    tot = fixture["totals"]["p2"]
    psum = sum(D(p["qtyTotal"]) for p in fixture["pools"] if p["zone"] == "p2" and p["qtyTotal"] is not None)
    csum = sum(D(p["cost"]) for p in fixture["pools"] if p["zone"] == "p2" and p["cost"] is not None)
    tot["qtyHeadSum"] = fnum(psum)   # 引擎侧池行度数Σ(头行口径)
    if csum != D(tot["cost"]):
        print(f"合计锚点不合: 池Σ应分摊 {csum} vs W126 {tot['cost']}", file=sys.stderr)
        sys.exit(1)

    with open(JSON_OUT, "w", encoding="utf-8") as f:
        json.dump(fixture, f, ensure_ascii=False, indent=1)
    with open(SQL_OUT, "w", encoding="utf-8") as f:
        f.write(gen_sql(rules, links, cfg_rows, p1_supply, p2_supply))

    print(f"OK 规则 {len(rules)} 条 {by_zone} | 绑定 {n_bind} | links {len(links)} | rule月参 {n_cfg_rule} 行")
    print(f"池 fixture {len(fixture['pools'])} 条; 损耗 p1 {len(fixture['loss']['p1'])} 行 / p2 {len(fixture['loss']['p2'])} 行")
    print(f"手输行至 {len(fixture['manual_readings'])} 处; 幽灵表 {len(fixture['phantom_meters'])} 处; known_diff {len(fixture['known_diff'])} 条")
    if approx_notes:
        print("≈ 浮点半值进位(缓存值为准):")
        for n in approx_notes:
            print("  " + n)
    print(f"→ {JSON_OUT}\n→ {SQL_OUT}")


if __name__ == "__main__":
    main()
