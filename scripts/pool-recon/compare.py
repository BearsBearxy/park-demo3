# -*- coding: utf-8 -*-
"""compare.py — 期望值(expected.json,源册)对引擎结果(engine.json,临时库) → report.md + diff.csv。

    python scripts/pool-recon/compare.py 2024-02

比对面(每一面都先对上键,对不上的单列「池对不上」):
  池      用量 / 分段用量(二期) / 应分摊 / 标准 / 基数 / 加度
  已分摊  一期按 AF 公式圈出的 AE 组(一组可跨几个池),二期按块 X;引擎侧是「摊出」= Σ户级试算额
  逐户    电费总表(一期,居民块=宿舍不在范围)/ 本月用电·用水数据统计(二期)的 消防/电梯/路灯/线路损耗/绿化水 各列
  损耗    单元的 C / D / E / G(一期)/ 调整度数(二期)/ 加点 / 收取租户损耗率
「可能原因」列只是按差在哪一列给的归类提示(测量,不是结论),通用规则 vs 按月事实要跨月看同一格才定。
"""
import csv
import datetime
import json
import os
import re
import sys
from collections import defaultdict
from decimal import Decimal, ROUND_HALF_UP

import pymysql

HERE = os.path.dirname(os.path.abspath(__file__))
DB = dict(host="127.0.0.1", port=13306, user="root", password="root", database="park_demo3_recon", charset="utf8mb4")
EPS = Decimal("0.00005")

# 原册池标签逐月改名的已知对应(按月生效;来源:系统侧勘察 poolKeyMapping)
KEY_ALIASES = {
    "2023-08": {("p1", "大为东侧公共电"): "高建军C公共",      # 同一位置,2023-09 起改名
                # 六车间电梯池 2023-09 月中换表(旧表「六车间电梯」→ 新表「六车间电梯2」);库里只建了一块表「六车间电梯2」,
                # 8 月读数 467.86→516.63×40 就记在它名下(与源册 r112 同数),所以 8 月按同一池比
                ("p2", "六车间电梯"): "六车间电梯2"},
}
FEE_CAT = {"share_elec_floor": "fire", "share_elec_fire": "fire", "share_elec_elevator": "elevator",
           "share_elec_light": "light", "share_elec_loss": "loss", "share_green_water": "green"}
CAT_CN = {"fire": "消防/楼层公共", "elevator": "电梯", "light": "路灯", "loss": "线路损耗", "green": "绿化水"}
POOL_COLS = [("qty", "qtyTotal", "用量"), ("qtySharp", "qtySharp", "尖段"), ("qtyPeak", "qtyPeak", "峰段"),
             ("qtyFlat", "qtyFlat", "平段"), ("qtyValley", "qtyValley", "谷段"),
             ("cost", "costAmount", "应分摊"), ("std", "stdValue", "标准"), ("base", "baseSnap", "基数"),
             ("extraQty", "extraQty", "加度")]
HINT = {"用量": "读数/表绑定/倍率", "尖段": "读数/尖价比率", "峰段": "读数", "平段": "读数/冲减", "谷段": "读数",
        "应分摊": "单价/取整时机(用量相同时)", "标准": "加度/取整位/折入/基数", "基数": "按月事实:面积基数或层份",
        "加度": "按月事实:加度", "已分摊": "受益人名单/份额/实收口径", "逐户": "名单/面积/层份/户表手工系数",
        "损耗": "加点/调整度数/公式变体"}


def D(v):
    if v is None or v == "":
        return None
    return v if isinstance(v, Decimal) else Decimal(str(v))


def same(a, b):
    a, b = D(a) or Decimal(0), D(b) or Decimal(0)     # 空 ≡ 0(空格与 0 在账上同义)
    return abs(a - b) < EPS


def fmt(v):
    d = D(v)
    return "" if d is None else format(d.normalize(), "f")


def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f, parse_float=Decimal)


def r2(v):
    return v.quantize(Decimal("0.01"), ROUND_HALF_UP)


def p2_cost(r, ratio, exp, extra_flat=Decimal(0)):
    """二期池按源册段单价与给定尖价比率复算应分摊(引擎分段用量;extra_flat 加回平段度数)。"""
    pr = {k: D(v) for k, v in exp["prices"]["p2Seg"].items()}
    q = {k: D(r.get(k)) or 0 for k in ("qtySharp", "qtyPeak", "qtyFlat", "qtyValley")}
    return r2(q["qtySharp"] * (ratio * pr["sharp"] + (1 - ratio) * pr["peak"]) + q["qtyPeak"] * pr["peak"]
              + (q["qtyFlat"] + extra_flat) * pr["flat"] + q["qtyValley"] * pr["valley"])


def pool_hint(col, p, r, exp):
    """差在哪一列 + 能从两边数据直接量出来的原因(量得出才写,量不出只给归类)。"""
    e_qty, g_qty = D(p.get("qty")) or 0, D(r.get("qtyTotal")) or 0
    lines = r.get("lines") or []
    # 净额池(有 −1 绑定表)的逐表明细在 netParts,qty 带符号
    neg_names = "、".join(m["name"] for m in r.get("meters") or [] if m["sign"] == -1)
    neg_q = sum((-(D(x.get("qty")) or 0) for x in r.get("netParts") or [] if x.get("sign") == -1), Decimal(0))
    if p["zone"] == "p2" and col in ("用量", "尖段", "峰段", "平段", "谷段", "应分摊", "标准"):
        twin = [q["key"] for q in exp["pools"] if q["zone"] == "p2" and q is not p and not q.get("refOf")
                and not same(g_qty, e_qty) and same(q.get("qty"), g_qty) and D(q.get("qty"))]
        if twin:
            return f"引擎用量 {fmt(g_qty)} = 源册「{twin[0]}」行用量:换表月新旧两块表的读数进了库里同一块表,新表行导入时判重丢弃"
        pos = [ln for ln in lines if ln.get("sign") == 1]
        if len(pos) == 1 and p.get("factor") and not same(p["factor"], pos[0].get("factorSnap")):
            return (f"倍率:源册公共电数据 H{p['headRow']}={fmt(p['factor'])},库里读数倍率 {fmt(pos[0].get('factorSnap'))}"
                    f"(抄表页用量 {fmt(p.get('bookQty'))})")
    if col == "用量":
        book = [D(m.get("bookQty")) for m in p.get("meters", [])] if p["zone"] == "p1" else [D(p.get("bookQty"))]
        if p["zone"] == "p1" and any(m.get("sFormula") and "园区电!X" in m["sFormula"] for m in p.get("meters", []))                 and same(e_qty, D(p.get("extraQty")) or 0):
            return "源册 S 格取抄表页 X 列净额,该月为 0/空(未计该池);引擎按净额计"
        if p["zone"] == "p1" and p.get("meters") and all(m.get("qty") is None for m in p["meters"]):
            return "源册 S 格空(该月未计该池);引擎按读数计"
        if p["zone"] == "p1" and any(m.get("sFormula") is None and D(m.get("qty")) for m in p.get("meters", [])):
            return f"源册 S 格手输 {fmt(e_qty)}(无公式,读数未变),引擎按读数 {fmt(g_qty)}"
        if book and None not in book and same(sum(book, Decimal(0)), g_qty):
            return f"源册分摊页用量 ≠ 抄表页用量 {fmt(sum(book, Decimal(0)))},引擎取抄表页"
        if neg_q and same(e_qty - neg_q, g_qty):
            return f"引擎扣减 −1 绑定表({neg_names} {fmt(neg_q)} 度)净额,源册总量格 L 未扣"
        if p["zone"] == "p1" and not same(D(p.get("extraQty")) or 0, D(r.get("extraQty")) or 0):
            return f"加度:源册 {fmt(p.get('extraQty'))},引擎该月 extra_qty={fmt(r.get('extraQty'))}"
    if col == "应分摊" and r.get("method") == "ref" and r.get("costAmount") is None:
        return "引擎把该池当折入源(ref)不单算应分摊;源册单列 W 并计入合计(单价档折进目标池)"
    if col == "应分摊" and p.get("rowsWithoutAD"):
        return f"源册 r{'、r'.join(map(str, p['rowsWithoutAD']))} 有用量无「应分摊」公式(漏行),引擎按表计价"
    cost_differs = not same(p.get("cost"), r.get("costAmount"))
    if col == "标准" and p.get("base") is not None and not same(p.get("base"), r.get("baseSnap")):
        return "跟随基数差" + (";应分摊也有差,见应分摊行" if cost_differs else "")
    if p["zone"] == "p2" and (col == "应分摊" or (col in ("标准", "尖段", "平段") and cost_differs))             and p.get("sharpRatio") and r.get("costAmount") is not None:
        sr = p["sharpRatio"]
        ratio = D(sr["value"]) or Decimal(0)
        alt = p2_cost(r, ratio, exp)
        why = f"尖价比率:源册 {sr['cell']}={fmt(ratio)},引擎按 sharp_as_peak_ratio 算"
        if same(alt, p.get("cost")):
            return why + (f";按源册比率复算 {fmt(alt)}=源册" if col == "应分摊" else "(跟随应分摊差)")
        if neg_q and same(p2_cost(r, ratio, exp, neg_q), p.get("cost")):
            return (f"源册该月平段未扣 {neg_names} {fmt(neg_q)} 度(10 月起才扣),引擎按 −1 绑定每月扣"
                    + ("" if ratio == 0 else f";另 {why}"))
        if neg_q and abs(alt - D(p.get("cost"))) < 5 and ratio != 0:
            return why + f";残差 {fmt(alt - D(p.get('cost')))}:源册尖峰行 L=ROUND(…−隐藏行)−L 把 {neg_names} 的尖段扣减又加回"
    if col in ("应分摊", "标准") and not same(e_qty, g_qty):
        return "跟随用量差"
    if col == "标准":
        if p.get("base") is not None and not same(p.get("base"), r.get("baseSnap")):
            return "跟随基数差"
        add = re.search(r"\)\s*\+\s*(\d+(?:\.\d+)?)\s*$", p.get("vFormula") or "")
        if add and same((D(p.get("std")) or 0) - (D(r.get("stdValue")) or 0), D(add.group(1))):
            return f"源册 V{p['headRow']} 公式末端手工 +{add.group(1)} 元,引擎该月没配 std_add"
        if p.get("roundScale") is not None and r.get("roundScale") is not None and p["roundScale"] != r["roundScale"]:
            return f"取整位:源册 ROUND {p['roundScale']} 位,引擎 {r['roundScale']} 位"
        if p["zone"] == "p1" and not same(D(p.get("extraQty")) or 0, D(r.get("extraQty")) or 0):
            return f"跟随加度差(源册 {fmt(p.get('extraQty'))},引擎 {fmt(r.get('extraQty'))})"
        if abs((D(p.get("std")) or 0) - (D(r.get("stdValue")) or 0)) <= Decimal("0.01"):
            return "取整尾差(≤0.01)"
    if col == "基数":
        cell = f"公共电分摊明细 AA{p['headRow']}" if p["zone"] == "p1" else f"公共电数据 T{p['headRow']}"
        return f"按月事实:{'面积基数' if p['zone'] == 'p1' and (D(p.get('base')) or 0) > 50 else '层份/份数'}(源册 {cell})"
    if col == "加度":
        return f"按月事实:加度(源册 {fmt(p.get('extraQty'))},引擎该月 {fmt(r.get('extraQty'))})"
    return HINT[col]


def p1_alloc_hint(m, eng_alloc, block_gap):
    """一期已分摊组(AE 实收 vs 引擎摊出)差额的可量原因;量不出就给口径说明 + 块合计差。"""
    pools, rules, ae = m["pools"], m["rules"], m["ae"]
    if not D(ae):
        return f"源册该组 AE 空/0(不单独收,份额在户表并入同块其他组);块合计差 {fmt(block_gap)}"
    if eng_alloc == 0:
        if any(r["method"] == "manual" for r in rules):
            return f"源册 AE 手输固定额 {fmt(ae)}(无表行),引擎 manual 池没有金额"
        if all(not r.get("members") for r in rules):
            return f"引擎该池受益人为空(配置缺),摊出 0;块合计差 {fmt(block_gap)}"
        if all(all(x.get("inForce") != "yes" for x in r["members"]) for r in rules):
            return "引擎受益人都不在租(合同起止/名册),摊出 0"
    notes = []
    for p, r in zip(pools, rules):
        if p.get("base") is not None and not same(p["base"], r.get("baseSnap")):
            notes.append(f"基数 AA{p['headRow']} 源册 {fmt(p['base'])}/引擎 {fmt(r.get('baseSnap'))}")
        if not same(D(p.get("extraQty")) or 0, D(r.get("extraQty")) or 0):
            notes.append(f"加度 源册 {fmt(p.get('extraQty'))}/引擎 {fmt(r.get('extraQty'))}")
        if not same(p.get("cost"), r.get("costAmount")):
            notes.append(f"应分摊差 {fmt((D(r.get('costAmount')) or 0) - (D(p.get('cost')) or 0))}")
    if notes:
        return "跟随池差:" + ";".join(notes)
    if abs(block_gap) < 1:
        return "块内互抵:源册 AE 按户拉回,含同层楼梯间/货梯份额;块合计相等"
    if any(r["method"] == "area" and (D(r.get("baseSnap")) or 0) >= 10000 for r in rules):
        return (f"在租名单/面积:引擎 {fmt(rules[0].get('stdValue'))}×在册面积,源册 AE 从电费总表按户拉回;"
                f"块合计差 {fmt(block_gap)}")
    return f"名单/份额:源册 AE=户表实收(含同层他池份额),引擎按受益人配置摊出;块合计差 {fmt(block_gap)}"


def p2_alloc_hint(p, r):
    """二期已分摊(X 实收 vs 摊出):先列能量出的池差,再给 X 的口径。"""
    notes = []
    if p.get("base") is not None and not same(p["base"], r.get("baseSnap")):
        notes.append(f"层份 T{p['headRow']} 源册 {fmt(p.get('baseCell'))}/引擎 {fmt(r.get('baseSnap'))}")
    if r.get("costAmount") is not None and not same(p.get("cost"), r.get("costAmount")):
        notes.append(f"应分摊差 {fmt((D(r.get('costAmount')) or 0) - (D(p.get('cost')) or 0))}")
    k = p["key"]
    kind = ("X=户表消防列实收,含园区消防设施 V×面积份;引擎把园区消防设施池另摊" if "消防" in k and "园区" not in k
            else "X=户表电梯列实收(V×户层数,逐户手工);引擎按层份名单摊" if "电梯" in k
            else "X=户表路灯列实收(单价×面积,逐户手工);引擎 V×在册面积" if "路灯" in k
            else "X=用水统计绿化水列实收(户表单价);引擎 V×在册面积" if "绿化" in k
            else "X=户表实收;引擎按配置摊出")
    return ";".join(notes + [kind])


def loss_hint(col, e, v, bad_cols):
    """损耗单元差:按列给可量的归类。"""
    if col.startswith("加点"):
        return f"加点:源册 {fmt(e)},引擎该月 loss_adj_rate={fmt(v) or '未配'}"
    if col.startswith("调整度数"):
        return f"调整度数:源册 {fmt(e)},引擎该月 loss_adj_qty={fmt(v) or '未配'}"
    if col.startswith("分摊度数"):
        return "园区公共分摊度数/硬扣度(源册 G 列内联扣度,引擎 gQty+adjQty)"
    if col.startswith("分表 D"):
        return "分表成员不同,见分表下钻"
    if col.startswith("损耗 E"):
        return "跟随分表 D / 总表 C 差" if {"分表 D", "总表 C"} & set(bad_cols) else "损耗公式变体"
    if col.startswith("总表 C"):
        return "总表口径不同(变压器/铝缆/供电表)"
    return "跟随" + "、".join(bad_cols) + "差" if bad_cols else "收取率公式变体(加点/手输率)"


def drill_members(g, us, meters, names_of):
    """分表 D 对不上时:源册段落里每块表 vs 临时库该月的挂栋/读数;再列库里挂在这几栋、源册段落没有的表。"""
    zone = g["zone"]
    prefix = {"p1": "一期 ", "p2": "二期 "}[zone]
    bnames = {prefix + n for n in names_of(g["label"])}
    out, listed = [], set()
    gap = sum((D(u.get("d")) or 0 for u in us), Decimal(0)) - (D(g["dQty"]) or 0)   # 源册 D − 引擎 D
    explained = Decimal(0)
    for u in us:
        for m in u.get("dMembers") or []:
            if m["row"] is None:
                out.append([g["label"], m["name"], "", "", "", "段落合计里的非表项,引擎另算"])
                continue
            listed.add(m["name"])
            st = meters.get((zone, m["name"]))
            q = D(m["qty"])
            if not q and (st is None or not st[3]):
                continue                    # 两边都没用量,不影响 D
            if st is None:
                why = "库里没有这块表"
            elif st[1] not in bnames:
                why = f"库里该月挂在 {st[1] or '(未挂栋)'}"
            elif st[3] is None:
                why = "库里该月无读数"
            elif not same(q, st[3]):
                why = "用量不同(倍率/读数)"
            else:
                continue
            explained += (q or 0) - ((D(st[3]) or 0) if st and st[1] in bnames else 0)
            out.append([g["label"], f"r{m['row']} {m['name']}", fmt(q), (st[1] or "(未挂栋)") if st else "",
                        fmt(st[3]) if st else "", why])
    if out and same(explained, gap):
        return out                          # 段落成员的差已经把 D 差解释完,不再列库里多出的表
    for (z, name), (mid, b, own, use) in sorted(meters.items(), key=lambda x: x[0]):
        if z == zone and b in bnames and name not in listed and use is not None and use != 0 \
                and own in ("tenant", "share"):
            out.append([g["label"], f"#{mid} {name}", "", b, fmt(use), "库里挂在此栋、源册段落里没有(引擎若未剔除则计入 D)"])
    return out


def match_pools(ym, exp, eng):
    """→ [(expected_pool|None, engine_row|None)]"""
    rows = eng["pools"]["rows"]
    aliases = KEY_ALIASES.get(ym, {})
    used, out = set(), []
    p1_by_key = {r["bookKey"]: r for r in rows if r["zone"] == "p1" and r.get("bookKey")}
    p1_manual = [r for r in rows if r["zone"] == "p1" and r["method"] == "manual"]
    for p in exp["pools"]:
        hit = None
        if p["zone"] == "p1":
            key = aliases.get(("p1", p["key"]), p["key"])
            if key:
                hit = p1_by_key.get(key)
            if hit is None and p.get("manual") and p.get("members"):
                cands = [r for r in p1_manual if re.split(r"[·/]", r["name"])[-1] in p["members"]]
                hit = cands[0] if len(cands) == 1 else None
        else:
            key = aliases.get(("p2", p["key"]), p["key"])
            base_key = p.get("refOf") or key
            cands = [r for r in rows if r["zone"] == "p2" and any(
                m["name"] == base_key and m["sign"] == 1 for m in (r.get("meters") or []))]
            if p.get("refOf"):
                cands = [r for r in cands if r["method"] == "ref"]
            elif len(cands) > 1:
                cands = [r for r in cands if r["method"] != "ref"]
            hit = cands[0] if len(cands) == 1 else None
        if hit is not None and hit["ruleId"] in used:
            hit = None
        if hit is not None:
            used.add(hit["ruleId"])
        out.append((p, hit))
    for r in rows:
        if r["ruleId"] not in used and r["zone"] in ("p1", "p2"):
            out.append((None, r))
    return out


def tenant_index(cur):
    cur.execute("SELECT id, company_name, aliases FROM tenant")
    by_name, names = defaultdict(set), {}
    for tid, name, aliases in cur.fetchall():
        names[tid] = name
        by_name[name.strip()].add(tid)
        for a in re.split(r"[,，、/;；\s]+", aliases or ""):
            if a:
                by_name[a].add(tid)
    return by_name, names


def meter_state(cur, ym):
    """(期区, 表名) → (id, 该月挂栋名, 该月归属, 该月用量)。挂栋/归属取 meter_assign 里 from_ym ≤ ym 的最新一段。"""
    cur.execute("""SELECT m.zone, m.name, m.id, b.name, a.ownership,
                          (r.curr_total - r.prev_total) * r.factor_snap
                   FROM meter m
                   LEFT JOIN meter_assign a ON a.id = (SELECT a2.id FROM meter_assign a2 WHERE a2.meter_id = m.id
                        AND a2.from_ym <= %s ORDER BY a2.from_ym DESC, a2.id DESC LIMIT 1)
                   LEFT JOIN building b ON b.id = a.building_id
                   LEFT JOIN meter_reading r ON r.meter_id = m.id AND r.ym = %s
                   WHERE m.kind = 'elec' AND m.zone IN ('p1', 'p2')""", (ym, ym))
    return {(z, n): (i, b, o, u) for z, n, i, b, o, u in cur.fetchall()}


def building_zone(cur):
    cur.execute("SELECT id, name, phase FROM building")
    z = {}
    for bid, name, phase in cur.fetchall():
        z[bid] = "dorm" if "宿舍" in name else {1: "p1", 2: "p2"}.get(phase, "other")
    return z


def compare(ym):
    out_dir = os.path.join(HERE, "out", ym)
    exp = load(os.path.join(out_dir, "expected.json"))
    eng = load(os.path.join(out_dir, "engine.json"))
    con = pymysql.connect(**DB)
    cur = con.cursor()
    by_name, tnames = tenant_index(cur)
    bzone = building_zone(cur)
    cur.execute("SELECT MAX(generated_at) FROM alloc_pool_result WHERE ym=%s", (ym,))
    gen_at = cur.fetchone()[0]
    meters = meter_state(cur, ym)
    con.close()

    diffs = []          # (面, 期区, 键, 引擎池, 列, 源册, 引擎, 差, 可能原因)

    cols = exp.get("cols", {})
    sheet = {"p1": "公共电分摊明细", "p2": "公共电数据"}

    def cell(zone, what, rows, val=None):
        """源册证据单元格:公共电分摊明细!AD48+AD49=30.35。"""
        c = cols.get(zone, {}).get(what)
        if not c:
            return ""
        return f"{sheet[zone]}!" + "+".join(f"{c}{r}" for r in rows) + f"={fmt(val) if D(val) is not None else '空'}"

    def add(face, zone, key, rule, col, e, g, hint, ev=""):
        de, dg = D(e) or Decimal(0), D(g) or Decimal(0)
        diffs.append([face, zone, key, rule, col, fmt(e), fmt(g), fmt(dg - de), hint, ev])

    # ── 池 ──
    pairs = match_pools(ym, exp, eng)
    rule_of = {}
    pool_stat = {"matched": 0, "equal": 0}
    unmatched = []
    for p, r in pairs:
        if p is None:
            unmatched.append(("引擎有、源册无", r["zone"], f"#{r['ruleId']} {r['name']}", r.get("bookKey") or "",
                              r.get("costAmount")))
            continue
        label = p["key"] or f"(无表行 r{p['headRow']} {p.get('members') or ''})"
        if r is None:
            unmatched.append(("源册有、引擎无", p["zone"], label, p.get("block") or "", p.get("cost")))
            continue
        rule_of[(p["zone"], p["headRow"])] = r
        pool_stat["matched"] += 1
        rule = f"#{r['ruleId']} {r['name']}"
        bad = False
        for ek, gk, cn in POOL_COLS:
            if ek not in p or (ek.startswith("qty") and ek != "qty" and p["zone"] != "p2"):
                continue
            if ek == "extraQty" and p["zone"] != "p1":
                continue
            if ek == "base" and p.get("base") is None:
                continue                    # 源册没用基数(整额户对户),引擎 floor×1 同义
            if not same(p.get(ek), r.get(gk)):
                bad = True
                what = {"qty": "qty", "cost": "cost", "std": "std", "base": "base"}.get(ek)
                rows = p["rows"] if (p["zone"] == "p1" and ek in ("qty", "cost")) else [p["headRow"]]
                add("池", p["zone"], label, rule, cn, p.get(ek), r.get(gk), pool_hint(cn, p, r, exp),
                    cell(p["zone"], what, rows, p.get(ek)) if what else "")
        pool_stat["equal"] += not bad

    # ── 已分摊(源册 AE/X 实收 vs 引擎摊出) ──
    alloc_rows = []
    owner = {}
    for p in exp["pools"]:
        if p["zone"] == "p1":
            for rr in p["rows"]:
                owner[rr] = p
    # 同一组池可能被几行 AE 分别收(东/西楼梯间各一行 AF=AE−AD) → 按池集合并成一组
    merged = {}
    for g in exp["p1AllocGroups"]:
        pools = []
        for rr in g["rows"]:
            p = owner.get(rr)
            if p is not None and p not in pools:
                pools.append(p)
        rules = [rule_of.get(("p1", p["headRow"])) for p in pools]
        if not pools or any(x is None for x in rules):
            continue
        k = tuple(x["ruleId"] for x in rules)
        m = merged.setdefault(k, {"pools": pools, "rules": rules, "ae": None, "aeRows": []})
        m["aeRows"].append(g["aeRow"])
        if g["ae"] is not None:
            m["ae"] = (m["ae"] or Decimal(0)) + D(g["ae"])
    # 块合计:户对户池的 AE 里常夹着楼梯间/货梯份额(户表按户拉回),逐组比口径必然错位;按块合计看才可比
    blk = defaultdict(lambda: [Decimal(0), Decimal(0)])
    for m in merged.values():
        blk[m["pools"][0]["block"]][0] += m["ae"] or 0
    for p in exp["pools"]:
        r = rule_of.get(("p1", p["headRow"]))
        if p["zone"] == "p1" and r is not None:
            blk[p["block"]][1] += D(r.get("allocatedAmount")) or 0
    for m in merged.values():
        eng_alloc = sum((D(x.get("allocatedAmount")) or 0 for x in m["rules"]), Decimal(0))
        label = "+".join(p["key"] or f"r{p['headRow']} {p.get('members') or ''}" for p in m["pools"])
        alloc_rows.append(("p1", label, m["ae"], None, eng_alloc))
        if not same(m["ae"], eng_alloc):
            e, g = blk[m["pools"][0]["block"]]
            add("已分摊", "p1", label, ",".join(f"#{x['ruleId']}" for x in m["rules"]),
                "已分摊(AE 实收 vs 摊出)", m["ae"], eng_alloc, p1_alloc_hint(m, eng_alloc, g - e),
                cell("p1", "alloc", m["aeRows"], m["ae"]))
    for b, (e, g) in blk.items():
        alloc_rows.append(("p1", f"**块合计 {b}**", e, None, g))
    p2_x, p2_g = Decimal(0), Decimal(0)
    for p in exp["pools"]:
        r = rule_of.get(("p2", p["headRow"]))
        if p["zone"] == "p2":
            p2_x += D(p.get("allocated")) or 0
            p2_g += (D(r.get("allocatedAmount")) or 0) if r else 0
    alloc_rows.append(("p2", "**二期合计(含折入/加价档池)**", p2_x, None, p2_g))
    for p in exp["pools"]:
        if p["zone"] != "p2" or p.get("refOf"):
            continue
        r = rule_of.get(("p2", p["headRow"]))
        if r is None:
            continue
        rules = [r] + [rule_of[("p2", q["headRow"])] for q in exp["pools"]
                       if q.get("refOf") == p["key"] and ("p2", q["headRow"]) in rule_of]
        eng_alloc = sum((D(x.get("allocatedAmount")) or 0 for x in rules), Decimal(0))
        excel = p.get("allocated")
        alloc_rows.append(("p2", p["key"], excel, p.get("allocatedText"), eng_alloc))
        if excel is not None and not same(excel, eng_alloc):
            add("已分摊", "p2", p["key"], ",".join(f"#{x['ruleId']}" for x in rules),
                "已分摊(X 实收 vs 摊出)", excel, eng_alloc, p2_alloc_hint(p, r),
                cell("p2", "alloc", [p["headRow"]], excel))

    # ── 逐户 × 费目 ──
    rule_zone = {r["ruleId"]: r["zone"] for r in eng["pools"]["rows"]}
    eng_t = defaultdict(Decimal)            # (zone, tenantId, cat) → 金额
    dropped = defaultdict(lambda: [0, Decimal(0)])   # 不进逐户比对的户级贡献,按原因计数,报告里列出来
    for c in eng["contributions"]:
        cat = FEE_CAT.get(c["feeKey"])
        if c["ruleId"] is not None:
            zone = rule_zone.get(c["ruleId"])
        else:
            zs = {bzone.get(b) for b in (c.get("lossBuildings") or [])}
            zone = zs.pop() if len(zs) == 1 else "跨期区"
        why = (f"费项 {c['feeKey']} 不在比对费目" if cat is None
               else f"{zone} 池(宿舍不在一二期公共电范围)" if zone not in ("p1", "p2")
               else "一期绿化水(用水,不在电费总表)" if (zone == "p1" and cat == "green") else None)
        if why:
            dropped[why][0] += 1
            dropped[why][1] += D(c["amount"]) or 0
            continue
        eng_t[(zone, c["tenantId"], cat)] += D(c["amount"]) or 0
    seen_t = set()
    tenant_unmatched, tenant_stat = [], {"rows": 0, "equal": 0}
    eng_ids = {(z, i) for (z, i, _c) in eng_t}
    for t in exp["tenants"]:
        ids = by_name.get(t["name"], set())
        how = ""
        if not ids:     # 户表简称 vs 库里全称(合源 → 合源创盈):前缀唯一命中才认,并在键上标出来
            cands = {i for (z, i) in eng_ids if z == t["zone"] and tnames.get(i)
                     and (tnames[i].startswith(t["name"]) or t["name"].startswith(tnames[i]))}
            if len(cands) == 1:
                ids, how = cands, "(按名前缀认户)"
        with_eng = {i for i in ids if (t["zone"], i) in eng_ids}
        ids = with_eng or ids
        if not ids:
            tenant_unmatched.append(("源册户名在库里找不到", t["zone"], t["name"],
                                     " ".join(f"{CAT_CN[k]}={v}" for k, v in t["amounts"].items())))
            continue
        cells = []
        for cat in CAT_CN:
            e = D(t["amounts"].get(cat))
            g = sum((eng_t.get((t["zone"], i, cat), Decimal(0)) for i in ids), Decimal(0))
            for i in ids:
                seen_t.add((t["zone"], i, cat))
            if e is None and g == 0:
                continue
            cells.append((cat, e, g))
        tenant_stat["rows"] += len(cells)
        share = [(e or 0, g) for cat, e, g in cells if cat in ("fire", "elevator", "light")]
        moved = same(sum((e for e, _ in share), Decimal(0)), sum((g for _, g in share), Decimal(0)))
        idtxt = ",".join(f"#{i} {tnames.get(i, '')}" for i in sorted(ids))
        for cat, e, g in cells:
            if same(e, g):
                tenant_stat["equal"] += 1
                continue
            hint = HINT["逐户"]
            if cat in ("fire", "elevator", "light") and moved:
                hint = "费目归类不同:消防+电梯+路灯三项合计相等"
            elif abs((g or 0) - (e or 0)) <= Decimal("0.02"):
                hint = "取整尾差(≤0.02):户表一次 ROUND 多项,引擎逐池 ROUND 再加"
            add("逐户", t["zone"], t["name"] + how, idtxt, CAT_CN[cat], e, g, hint)
    for (zone, tid, cat), amt in sorted(eng_t.items(), key=lambda x: (x[0][0], str(x[0][1]), x[0][2])):
        if (zone, tid, cat) not in seen_t and amt != 0:
            tenant_unmatched.append(("引擎摊到、源册户表无此户", zone, f"#{tid} {tnames.get(tid, '?')}",
                                     f"{CAT_CN[cat]}={fmt(amt)}"))

    # ── 损耗单元 ──
    def names_of(label):
        base = label.split("(")[0]
        return [re.sub(r"^(一期|二期)\s*", "", x).strip() for x in base.split("/")]
    eng_units = eng["loss"]["units"]
    groups = defaultdict(list)
    loss_unmatched, loss_drill = [], []
    # 同名两行(2023-08/09 一期「A座」r4 是扣度前的草算行、r5 才带 G 与扣度)只比带 G 的那行,另一行记进单元对不上
    book_units = []
    for u in exp["loss"]:
        twin = [x for x in exp["loss"] if x is not u and x["zone"] == u["zone"] and x["label"] == u["label"]]
        if twin and u.get("g") is None and any(x.get("g") is not None for x in twin):
            loss_unmatched.append((f"源册同名行 r{u['row']} 未比(无 G,取带 G 的那行)", u["zone"], u["label"]))
            continue
        book_units.append(u)
    for u in book_units:
        hit = next((g for g in eng_units if g["zone"] == u["zone"] and u["label"] in names_of(g["label"])), None)
        if hit is None:
            hit = next((g for g in eng_units if g["zone"] == u["zone"]
                        and any(u["label"].startswith(n) for n in names_of(g["label"]))), None)
        if hit is None:
            loss_unmatched.append(("源册有、引擎无", u["zone"], u["label"]))
            continue
        groups[hit["label"]].append(u)
    for g in eng_units:
        us = groups.get(g["label"])
        if not us:
            loss_unmatched.append(("引擎有、源册无", g["zone"], g["label"]))
            continue
        label = g["label"] + ("" if len(us) == 1 else f"  ← 源册 {'+'.join(u['label'] for u in us)}")

        def first(k):
            return next((u.get(k) for u in us if u.get(k) is not None), None)

        def total(k):
            vals = [D(u.get(k)) for u in us if u.get(k) is not None]
            return sum(vals, Decimal(0)) if vals else None
        cols = [("总表 C", total("c"), g["cQty"]), ("分表 D", total("d"), g["dQty"]), ("损耗 E", first("e"), g["eQty"]),
                ("收取率", first("rate"), g["tenantRate"])]
        if g["zone"] == "p1":
            # 源册 G = ROUND(Σ园区公共/6,2) 再内联硬扣度(A座 −1500);引擎把硬扣度放在 adjQty
            g_eng = None if g["gQty"] is None else (D(g["gQty"]) + (D(g["adjQty"]) or 0))
            cols.insert(3, ("分摊度数 G(含扣度)", first("g"), g_eng))
            cols.insert(4, ("加点 H", first("adjRate"), g["adjRate"]))
        else:
            cols.insert(3, ("调整度数 H", first("adjQty"), g["adjQty"]))
            cols.insert(4, ("加点 I", first("adjRate"), g["adjRate"]))
        bad_cols = [cn for cn, e, v in cols if not same(e, v) and cn != "收取率"]
        for cn, e, v in cols:
            if cn == "损耗 E" and e is not None:
                e = D(e).quantize(Decimal("0.01"))
            if not same(e, v):
                add("损耗", g["zone"], label, "", cn, e, v, loss_hint(cn, e, v, bad_cols))
        if not same(total("d"), g["dQty"]):
            loss_drill.extend(drill_members(g, us, meters, names_of))

    tenant_stat["dropped"] = {k: (n, fmt(a)) for k, (n, a) in dropped.items()}
    write_outputs(ym, out_dir, exp, eng, gen_at, pool_stat, unmatched, alloc_rows, tenant_stat,
                  tenant_unmatched, loss_unmatched, loss_drill, diffs)
    return diffs, unmatched


def md_table(head, rows):
    esc = lambda x: str(x).replace("|", "\\|").replace("\n", " ")
    return "\n".join(["| " + " | ".join(head) + " |", "|" + "---|" * len(head)]
                     + ["| " + " | ".join(esc(x) for x in r) + " |" for r in rows]) + "\n"


def write_outputs(ym, out_dir, exp, eng, gen_at, pool_stat, unmatched, alloc_rows, tenant_stat,
                  tenant_unmatched, loss_unmatched, loss_drill, diffs):
    with open(os.path.join(out_dir, "diff.csv"), "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(["面", "期区", "键", "引擎池/户", "列", "源册", "引擎", "引擎−源册", "可能原因(提示)", "源册单元格"])
        w.writerows(diffs)
    # 给汇总报告(book_report.py)用的其余几张表,免得它再算一遍
    with open(os.path.join(out_dir, "extra.json"), "w", encoding="utf-8") as f:
        json.dump({"unmatched": [[a, b, c, d, fmt(e)] for a, b, c, d, e in unmatched],
                   "allocBlocks": [[z, k, fmt(e), fmt(g)] for z, k, e, _t, g in alloc_rows if k.startswith("**")],
                   "tenantUnmatched": [list(x) for x in tenant_unmatched],
                   "tenantStat": {"rows": tenant_stat["rows"], "equal": tenant_stat["equal"],
                                  "dropped": tenant_stat["dropped"]},
                   "lossUnmatched": [list(x) for x in loss_unmatched], "lossDrill": loss_drill,
                   "generatedAt": str(gen_at)}, f, ensure_ascii=False, indent=1)
    sc = exp["selfcheck"]
    by_face = defaultdict(int)
    for d in diffs:
        by_face[d[0]] += 1
    n_pools = sum(1 for p in exp["pools"])
    L = []
    L.append(f"# 公共电对账 {ym}(一期 / 二期)\n")
    L.append("## 口径\n")
    L.append(f"- 源册(规范份):一期 `{exp['sources']['p1']['file']}`(mtime {exp['sources']['p1']['mtime']});"
             f"二期 `{exp['sources']['p2']['file']}`(mtime {exp['sources']['p2']['mtime']})")
    for v in exp["variants"]:
        L.append(f"- 同月其他份(不用/旁证):{v}")
    built, built_at = "", ""
    info = os.path.join(HERE, "out", "recon-db.json")
    if os.path.exists(info):
        with open(info, encoding="utf-8") as f:
            meta = json.load(f)
        built, built_at = "{builtAt} 从 {from} 灌出".format(**meta), meta["builtAt"]
    L.append(f"- 引擎:临时库 `{eng['db']}`(开发库 park_demo3 的 mysqldump 副本{',' + built if built else ''};"
             f"池配置=开发库配置,不是线上 atrilink.com);本月池快照生成于 {gen_at}")
    for name, what in (("prices-filled.json", "本月电价库里没有,对账工具按源册单价−维护费补进临时库"),
                       ("import-result.json", "本月读数由对账工具导入临时库(前端同一套解析 + 后端 importRows)")):
        path = os.path.join(out_dir, name)
        if os.path.exists(path):
            with open(path, encoding="utf-8") as f:
                body = json.load(f)
            if name == "prices-filled.json":
                L.append(f"- {what}:" + ",".join(f"{x['key']}={x['value']}" for x in body))
            else:
                mtime = datetime.datetime.fromtimestamp(os.path.getmtime(path)).isoformat(timespec="seconds")
                if built_at and mtime < built_at:
                    what = f"上次导入结果({mtime},早于临时库重建 {built_at},当前库里已不含这次导入;要补读数重跑 --import)"
                L.append(f"- {what}:" + ";".join(
                    f"{x['file']} {x['rows']} 行 → 导入 {x['result']['imported']} / 跳过 {x['result']['skipped']} / "
                    f"错误 {len(x['result']['errors'])} / 提示 {len(x['result']['notices'] or [])}" for x in body)
                    + "(明细见 import-result.json)")
    L.append(f"- 抽取自检:{'通过' if sc['ok'] else '**失败**'} {len(sc['passed'])} 项"
             + (f",失败 {len(sc['errors'])} 项:" + ";".join(sc["errors"]) if sc["errors"] else ""))
    for wmsg in sc["warnings"]:
        L.append(f"- 注意:{wmsg}")
    L.append("- 「已分摊」两边不同义:源册 AE/X 是从户表拉回的**实收**,引擎是按受益人配置正向试算的**摊出**;"
             "差额说明名单/份额/户表手工系数与配置不一致,不说明谁算错。")
    L.append("- 「可能原因」列是按差在哪一列给的归类提示,不是结论;通用规则 vs 按月事实要跨月看同一格。\n")
    L.append("## 总览\n")
    L.append(md_table(["面", "条数"], [
        ["源册池(含无表行、广联行)", n_pools],
        ["对上键的池", pool_stat["matched"]],
        ["其中逐列全等", pool_stat["equal"]],
        ["池对不上(两边有一边缺)", len(unmatched)],
        ["池列差", by_face["池"]],
        ["已分摊组/块", len(alloc_rows)],
        ["已分摊差", by_face["已分摊"]],
        ["逐户×费目 比对格", tenant_stat["rows"]],
        ["其中相等", tenant_stat["equal"]],
        ["逐户差", by_face["逐户"]],
        ["户对不上", len(tenant_unmatched)],
        ["损耗列差", by_face["损耗"]],
        ["损耗单元对不上", len(loss_unmatched)],
        ["引擎 generate 提示条数", len(eng["generate"]["warnings"])],
    ]))
    L.append("## 池对不上\n")
    L.append(md_table(["哪边缺", "期区", "键", "块/原册键", "应分摊"],
                      [[a, b, c, d, fmt(e)] for a, b, c, d, e in unmatched]) if unmatched else "无\n")
    L.append("## 池列差\n")
    rows = [d[1:] for d in diffs if d[0] == "池"]
    L.append(md_table(["期区", "源册键", "引擎池", "列", "源册", "引擎", "引擎−源册", "可能原因", "源册单元格"], rows)
             if rows else "无\n")
    L.append("## 已分摊(实收 vs 摊出)\n")
    why = {(d[1], d[2]): d[8] for d in diffs if d[0] == "已分摊"}
    L.append(md_table(["期区", "组(源册键)", "源册实收", "引擎摊出", "引擎−源册", "可能原因"],
                      [[z, k, fmt(e) if e is not None else (txt or ""), fmt(g),
                        fmt((D(g) or 0) - (D(e) or 0)) if txt is None else "", why.get((z, k), "")]
                       for z, k, e, txt, g in alloc_rows]))
    L.append("## 逐户 × 费目差\n")
    rows = [d[1:9] for d in diffs if d[0] == "逐户"]
    L.append(md_table(["期区", "户(源册名)", "库里户 id", "费目", "源册", "引擎", "引擎−源册", "可能原因"], rows)
             if rows else "无\n")
    if tenant_stat["dropped"]:
        L.append("不进逐户比对的引擎户级贡献:" + ";".join(
            f"{k} {n} 条合计 {a}" for k, (n, a) in tenant_stat["dropped"].items()) + "\n")
    L.append("## 户对不上\n")
    L.append(md_table(["情况", "期区", "户", "金额"], tenant_unmatched) if tenant_unmatched else "无\n")
    L.append("## 损耗单元\n")
    rows = [[d[1], d[2], d[4], d[5], d[6], d[7], d[8]] for d in diffs if d[0] == "损耗"]
    L.append(md_table(["期区", "单元", "列", "源册", "引擎", "引擎−源册", "可能原因"], rows) if rows else "列全等\n")
    if loss_unmatched:
        L.append(md_table(["哪边缺", "期区", "单元"], loss_unmatched))
    if loss_drill:
        L.append("\n### 分表 D 对不上的下钻(源册段落成员 vs 临时库该月挂栋/读数)\n")
        L.append(md_table(["单元", "表", "源册用量", "库里挂栋", "库里用量", "情况"], loss_drill))
    L.append("\n## 引擎 generate 提示\n")
    L.extend(f"- {w}" for w in eng["generate"]["warnings"])
    L.append("\n## 怎么重跑\n")
    L.append("```\npython scripts/pool-recon/recon.py mkdb          # 重建临时库(只读开发库)\n"
             f"python scripts/pool-recon/recon.py run {ym}       # 抽期望值 → 跑引擎 → 本报告\n```\n")
    with open(os.path.join(out_dir, "report.md"), "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(L))


def summary():
    """跨月汇总:同一格(面·期区·键·列)在哪几个月有差。每个在册月都差 → 疑通用规则;只个别月差 → 疑按月事实。"""
    root = os.path.join(HERE, "out")
    months = sorted(m for m in os.listdir(root) if os.path.exists(os.path.join(root, m, "diff.csv")))
    present, cells = defaultdict(set), defaultdict(dict)
    for ym in months:
        exp = load(os.path.join(root, ym, "expected.json"))
        for p in exp["pools"]:
            present[("池", p["zone"], p["key"] or f"(无表行 r{p['headRow']} {p.get('members') or ''})")].add(ym)
        for t in exp["tenants"]:
            present[("逐户", t["zone"], t["name"])].add(ym)
        with open(os.path.join(root, ym, "diff.csv"), encoding="utf-8-sig") as f:
            for row in list(csv.reader(f))[1:]:
                face, zone, key, _rule, col, _e, _g, delta = row[:8]
                cells[(face, zone, key, col)][ym] = delta
    out = []
    for (face, zone, key, col), by_ym in cells.items():
        # 在册月:池/户按该月源册有没有这个键;损耗单元与已分摊组的键是引擎侧拼的,按全部已比月算
        seen = present.get((face, zone, key.split("(按名前缀认户)")[0])) or set(months)
        n_seen, n_diff = len(seen | set(by_ym)), len(by_ym)
        constant = len(set(by_ym.values())) == 1
        if n_seen < 2:
            tag = "只比过 1 个月,不足以归类"
        elif n_diff == n_seen:
            tag = "每个在册月都差" + (",差值恒定" if constant else ",差值逐月变") + " → 疑通用规则"
        else:
            tag = "只 " + ",".join(sorted(by_ym)) + " 差 → 疑按月事实"
        out.append([face, zone, key, col, n_seen, n_diff, " ".join(f"{m}:{d}" for m, d in sorted(by_ym.items())), tag])
    out.sort(key=lambda r: (r[0], -r[5], r[1], r[2], r[3]))
    with open(os.path.join(root, "summary.csv"), "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(["面", "期区", "键", "列", "在册月数", "有差月数", "各月差(引擎−源册)", "归类提示"])
        w.writerows(out)
    with open(os.path.join(root, "summary.md"), "w", encoding="utf-8", newline="\n") as f:
        f.write(f"# 公共电对账跨月汇总({', '.join(months)})\n\n")
        f.write("「归类提示」只按出现规律分:每个在册月都差的格疑为通用规则(改引擎),只个别月差的格疑为按月事实"
                "(名单/基数/层份/取整位/尖价比率等按月配置)。逐月报告见 out/<月>/report.md。\n\n")
        f.write(md_table(["面", "期区", "键", "列", "在册月数", "有差月数", "各月差(引擎−源册)", "归类提示"], out))
    return months, out


def readings_report(ym):
    """只核读数的月份:源册抄表页(sheet.json)↔ 导入后的临时库读数 ↔ 引擎逐池用量(engine.json)。不比金额。"""
    out_dir = os.path.join(HERE, "out", ym)
    sheet = load(os.path.join(out_dir, "sheet.json"))
    eng = load(os.path.join(out_dir, "engine.json"))
    con = pymysql.connect(**DB)
    cur = con.cursor()
    cur.execute("""SELECT m.zone, m.name, r.prev_total, r.curr_total, r.factor_snap FROM meter_reading r
                   JOIN meter m ON m.id = r.meter_id WHERE r.ym = %s AND m.kind = 'elec' AND m.zone IN ('p1','p2')""", (ym,))
    now = {(z, n): (p, c, f) for z, n, p, c, f in cur.fetchall()}     # ponytail: 同期区同名表按一块算,库里表名期区内唯一
    cur.execute("""SELECT m.zone, m.name, r.ym, r.curr_total FROM meter_reading r JOIN meter m ON m.id = r.meter_id
                   WHERE m.kind = 'elec' AND m.zone IN ('p1','p2') AND r.ym = (SELECT MAX(r2.ym) FROM meter_reading r2
                   WHERE r2.meter_id = r.meter_id AND r2.ym < %s)""", (ym,))
    last = {(z, n): (y, c) for z, n, y, c in cur.fetchall()}
    con.close()
    bound = defaultdict(list)
    pools = [r for r in eng["pools"]["rows"] if r["zone"] in ("p1", "p2")
             and not (r["zone"] == "p1" and r["feeKey"] == "share_green_water")]   # 一期绿化水是用水池
    for r in pools:
        for m in r.get("meters") or []:
            bound[(r["zone"], m["name"])].append(f"#{r['ruleId']}{'(−1)' if m['sign'] == -1 else ''}")
    rows = {(z, x["name"]): x for z in ("p1", "p2") for x in sheet[z]}

    selfbad, unread, meter_diff, backwards, missing = [], [], [], [], []
    for (z, name), x in rows.items():
        pools_txt = " ".join(bound.get((z, name), []))
        if x["curr"] is None:
            unread.append([z, f"r{x['row']}", name, x["kind"] or "", fmt(x["prev"]), fmt(x["qty"]), pools_txt])
            continue
        if not same(x["qty"], x["recalc"]):
            selfbad.append([z, f"r{x['row']}", name, fmt(x["qty"]), fmt(x["recalc"])])
        got = now.get((z, name))
        if got is None:
            missing.append([z, f"r{x['row']}", name, x["kind"] or "", fmt(x["qty"]), pools_txt])
        else:
            p, c, f = got
            q = (D(c) - D(p)) * D(f)
            for col, e, g in (("上月行至", x["prev"], p), ("本月行至", x["curr"], c), ("倍率", x["factor"], f),
                              ("用量", x["qty"], q)):
                if not same(e, g):
                    meter_diff.append([z, f"r{x['row']}", name, col, fmt(e), fmt(g), pools_txt])
        lt = last.get((z, name))
        if lt and D(x["prev"]) is not None and D(x["prev"]) < D(lt[1]):
            backwards.append([z, f"r{x['row']}", name, fmt(x["prev"]), f"{lt[0]} 本月行至 {fmt(lt[1])}", pools_txt])

    pool_rows, n_eq = [], 0
    for r in pools:
        ms = r.get("meters") or []
        if not ms:
            continue
        absent = [m["name"] for m in ms if (r["zone"], m["name"]) not in rows]
        gaps = [m["name"] for m in ms if m["name"] not in absent and rows[(r["zone"], m["name"])]["curr"] is None]
        book = sum((m["sign"] * (D(rows[(r["zone"], m["name"])]["qty"]) or 0) for m in ms
                    if m["name"] not in gaps + absent), Decimal(0))
        if gaps or absent:
            why = ";".join(x for x in ("本月行至为空:" + "、".join(gaps) if gaps else "",
                                       "抄表页没有这块表(按名):" + "、".join(absent) if absent else "") if x)
        elif same(book, r.get("qtyTotal")):
            n_eq += 1
            continue
        else:
            why = "用量不同(见逐表)"
        pool_rows.append([r["zone"], f"#{r['ruleId']} {r['name']}", " ".join(("−" if m["sign"] == -1 else "") + m["name"]
                          for m in ms), fmt(book), fmt(r.get("qtyTotal")), why])

    imp = load(os.path.join(out_dir, "import-result.json"))
    L = [f"# 公共表读数与用量核对 {ym}(一期 / 二期,只核读数,不比金额)\n", "## 口径\n",
         f"- 源册:`{sheet['file']['file']}`(mtime {sheet['file']['mtime']}),只有一期园区电 / 二期园区电等抄表页,"
         "没有公共电分摊明细 / 公共电数据 / 损耗页,所以本月不比应分摊、已分摊、逐户、损耗。",
         f"- 二期园区电 AB4 尖价比率 = {fmt(sheet.get('p2SharpRatio'))}(按月事实,供配置参考)",
         f"- 引擎:临时库 `{eng['db']}`,读数按前端同一套解析 + importRows 导入;池配置 = 开发库配置。"]
    pf = os.path.join(out_dir, "prices-filled.json")
    if os.path.exists(pf):
        body = load(pf)
        L.append("- 当月电价是占位(priceGate 要求有价才能 generate):" + ",".join(
            f"{x['key']}={x['value']}(抄 {x['from']})" for x in body) + ";引擎金额一律不看。")
    L.append("- 导入:" + ";".join(f"{x['file']} {x['rows']} 行 → 导入 {x['result']['imported']} / 跳过 "
                                   f"{x['result']['skipped']} / 错误 {len(x['result']['errors'])} / 提示 "
                                   f"{len(x['result']['notices'] or [])}" for x in imp) + "\n")
    L.append("## 总览\n")
    L.append(md_table(["项", "数"], [
        ["一期抄表页表行", len(sheet["p1"])], ["二期抄表页表行", len(sheet["p2"])],
        ["本月行至为空(未抄)", len(unread)], ["用量 ≠ ROUND((本月−上月)×倍率,2)", len(selfbad)],
        ["已抄但库里没有本月读数", len(missing)], ["已抄、库里读数与册上不同(格)", len(meter_diff)],
        ["上月行至小于库里上一次本月行至", len(backwards)],
        ["引擎电池(有绑定表,一期绿化水池不算)", sum(1 for r in pools if r.get("meters"))], ["其中用量与册上相等", n_eq],
        ["池用量有差或缺读数", len(pool_rows)]]))
    L.append("## 未抄的表(本月行至为空,册上用量 = −上月行至×倍率)\n")
    L.append(md_table(["期区", "行", "表", "表类", "上月行至", "册上用量", "绑定的池"], unread) if unread else "无\n")
    L.append("## 池用量(引擎 vs Σ 册上用量)\n")
    L.append(md_table(["期区", "池", "绑定表", "Σ册上用量", "引擎用量", "情况"], pool_rows) if pool_rows else "全等\n")
    L.append("## 逐表:库里读数 vs 册上\n")
    L.append(md_table(["期区", "行", "表", "列", "册上", "库里", "绑定的池"], meter_diff) if meter_diff else "全等\n")
    L.append("## 已抄但库里没有本月读数\n")
    L.append(md_table(["期区", "行", "表", "表类", "册上用量", "绑定的池"], missing) if missing else "无\n")
    L.append("## 上月行至倒退\n")
    L.append(md_table(["期区", "行", "表", "册上上月行至", "库里上一次", "绑定的池"], backwards) if backwards else "无\n")
    L.append("## 源册自检:用量复算不等\n")
    L.append(md_table(["期区", "行", "表", "册上用量", "复算"], selfbad) if selfbad else "全等\n")
    L.append("## 导入错误\n")
    errs = [[x["file"], e.get("rowIndex"), e.get("label"), e.get("reason")] for x in imp for e in x["result"]["errors"]]
    L.append(md_table(["文件", "行", "表", "原因"], errs) if errs else "无\n")
    L.append("\n## 引擎 generate 提示\n")
    L.extend(f"- {w}" for w in eng["generate"]["warnings"])
    L.append(f"\n## 怎么重跑\n\n```\npython scripts/pool-recon/recon.py readings {ym}   # 须在 2024-02 及之前各月之后跑\n```\n")
    with open(os.path.join(out_dir, "report.md"), "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(L))
    return f"未抄 {len(unread)} / 读数差 {len(meter_diff)} / 缺读数 {len(missing)} / 池有差 {len(pool_rows)}"


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    ym = sys.argv[1]
    diffs, unmatched = compare(ym)
    by_face = defaultdict(int)
    for d in diffs:
        by_face[d[0]] += 1
    print(f"{ym}: 池对不上 {len(unmatched)} | " + " ".join(f"{k}差 {v}" for k, v in by_face.items())
          + f" → {os.path.join(HERE, 'out', ym, 'report.md')}")


if __name__ == "__main__":
    main()
