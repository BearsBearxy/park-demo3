# -*- coding: utf-8 -*-
"""verify_tariff_rule_202402.py — 用户计价规则(2026-07-28 拍板)的历史复刻验证。

【被验证的规则·用户原话】
  "不用电表分合同,缴费单出到租户,但是一个租户要有每个电表的明细=用电*计费规则,
   电表①电表②就是这个租户的第几个电表,宿舍表格的就算按照宿舍的电费计价方式,
   厂房的就用厂房的计价方式,电表没有尖峰平谷就按照商业电价,有的话就按照尖峰平谷价格"

【解读成两棵判定树,同时验证】
  A. 字面树(rule-as-stated):
     ① 表在「宿舍电」册     → 居民价 0.63586875 + 管理费 0.16
     ② 否则 有尖峰平谷四段  → 四时段价(尖按峰价,比率0) + 管理费 0.16
     ③ 否则                 → 商业价 0.79416875 + 维护费 0.32
  B. 修正树(rule-as-corrected,交换 ①② 优先级 + 收窄"宿舍"定义):
     ① 有尖峰平谷四段读数   → 四时段价 + 0.16
     ② 否则 是宿舍房间表(以房号为 VLOOKUP 键的宿舍段明细) → 居民价 + 0.16
     ③ 否则                 → 商业价 + 0.32
  水:字面树 宿舍册→3.85 无管网,否则 3.95+0.5;修正树 宿舍房间→3.85 无管网,否则 3.95+0.5。
  两树都不含户级例外(包干 1.0/商铺 1.5/维护 0.10/0.15/水 4.45…),例外单列清单。

【方法】逐 sheet 解析《一期/二期 2024年2月水电费.xlsx》缴费通知单的每条明细行
(表标识/场地段/时段/读数/倍率/实际用量/单价/金额),按两棵树各自独立算出应用价,
与 Excel 实际单价逐格比对(Decimal 全等,不设容差)。
价目一律读自 Excel 单元格(一期「创显承担电费」K3:O9),脚本内不硬编码任何价格。

用法: python verify_tariff_rule_202402.py [--miss-detail]
退出码恒为 0(审计报告,非门禁)。
"""
import io
import os
import re
import sys
import warnings
from collections import defaultdict
from decimal import Decimal

warnings.filterwarnings("ignore")
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
import openpyxl  # noqa: E402

BASE = r"C:\financial_dashboard\2025全年发生额、预算对比\2024年\2024年3月费用数据\2024年3月费用数据"
BOOKS = [("一期", os.path.join(BASE, "一期", "一期2024年2月水电费.xlsx"), "一期园区电", "一期园区水"),
         ("二期", os.path.join(BASE, "二期", "二期2024年2月水电费.xlsx"), "二期园区电", "二期园区水")]
YM = "2024-02"
NOTICE_MARK = "缴费通知单"
# 2023-05 残留模板 + 2023-09 废弃口径(P1/P2-UTILITY-FEE-STRUCTURE 已定性)
SKIP_SHEETS = {"厂房电", "厂房水", "火炬园（按总表差推算）"}
SEG_ALIAS = [("尖峰", "尖峰"), ("尖", "尖峰"), ("峰", "峰"), ("平", "平"), ("谷", "谷")]
TOU_SEGS = ("峰", "尖峰", "平", "谷")

# 已定稿的户级例外档案(仅用于归因,不参与命中判定)——源 P1/P2-UTILITY-FEE-STRUCTURE
KNOWN_EXCEPTION = {
    "禹晨": "A座孵化器包干 1.0 元/度含维护 + 公共分摊固定月费",
    "粤海华创": "A座孵化器包干 1.0 元/度含维护",
    "联塑精铟": "A座孵化器包干 1.0 元/度含维护",
    "章肖艳": "宿舍区首层商铺包干 1.5 元/度",
    "李李商铺": "宿舍区首层商铺包干 1.5 元/度",
    "林锐辉": "G座 1000kVA 专变户,维护费 0.1/度",
    "永龙": "光伏户,管理费 0.15",
    "星州": "管理费 0.15",
    "朱漫钳": "管理费 0.10、水 4.45",
    "南一": "水 4.45",
    "可莱恩": "B201 容量费 23 元/kVA(全册唯一非 22.6)",
    "公交车站": "佛广公汽,只收水 4.45 合并价",
    "陈书谨": "钢构户特殊单价",
}


def D(v):
    return None if v is None else Decimal(str(v))


def num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)


# ────────────────────────────── 价目(读自 Excel) ──────────────────────────────
def load_prices(sv):
    """一期「创显承担电费」K3:O9 = 2024年2月代理购电电价表(全园共享的月度价)。"""
    assert sv["K3"].value == "商业用电" and sv["K9"].value == "居民用电", "价目表结构变了"
    return {"commercial": D(sv["L3"].value), "commercial_mgmt": D(sv["M3"].value),
            "峰": D(sv["L5"].value), "尖峰_nominal": D(sv["L6"].value),
            "平": D(sv["L7"].value), "谷": D(sv["L8"].value),
            "resident": D(sv["L9"].value), "tou_mgmt": D(sv["M5"].value),
            "resident_mgmt": D(sv["M9"].value)}


def load_register(sv):
    """园区电册 A 列表标识 → 是否有尖峰平谷读数(列 J..M 上月 / O..R 本月,列号=VLOOKUP 索引)。"""
    reg = {}
    for r in range(1, sv.max_row + 1):
        tag = sv.cell(r, 1).value
        if isinstance(tag, str) and tag.strip():
            reg[tag.strip()] = any(num(sv.cell(r, c).value) for c in (10, 11, 12, 13, 15, 16, 17, 18))
    return reg


def load_registers(wbv, park_sheet):
    """园区电 + 宿舍电 合并。宿舍册无分时列,分时表是「一个时段一行表标识」
    (彭健宜峰/彭健宜尖/…) → 以兄弟行是否凑齐 ≥2 个时段判定该表是否分时。"""
    reg = load_register(wbv[park_sheet])
    sv = wbv["宿舍电"]
    tags = [str(sv.cell(r, 1).value).strip() for r in range(1, sv.max_row + 1)
            if isinstance(sv.cell(r, 1).value, str) and str(sv.cell(r, 1).value).strip()]
    base_segs = defaultdict(set)
    for t in tags:
        for raw, norm in SEG_ALIAS:
            if t.endswith(raw):
                base_segs[t[: -len(raw)]].add(norm)
                break
    for t in tags:
        has = False
        for raw, norm in SEG_ALIAS:
            if t.endswith(raw):
                has = len(base_segs[t[: -len(raw)]]) >= 2
                break
        reg.setdefault(t, has)
    return reg


# ────────────────────────────── 通知单解析 ──────────────────────────────
SRC_RE = re.compile(r"(宿舍电|宿舍水|一期园区电|一期园区水|二期园区电|二期园区水)")


def header_of(sv, r, maxc):
    cells = {}
    for c in range(1, maxc + 1):
        v = sv.cell(r, c).value
        if isinstance(v, str) and v.strip():
            cells.setdefault(v.strip(), c)
    # 宿舍段分间块优先判定:它同时含「项目」和「上月行至」,但键是房号不是表标识
    if "宿舍" in cells and "租赁面积（㎡）" in cells:
        return ("dorm", cells)
    if "项目" in cells and ("上月行至" in cells or "上月抄表行至" in cells):
        return ("notice", cells)
    return None


def split_meter_label(item):
    """'电表1：峰' → ('电表1','峰');'峰' → ('','峰')"""
    s = str(item or "").replace("\n", "").strip()
    for sep in ("：", ":"):
        if sep in s:
            a, b = s.split(sep, 1)
            return a.strip(), b.strip()
    return "", s


PAREN_RE = re.compile(r"[（(][^）)]*[）)]")


def seg_of(label):
    """'峰'/'尖'/'峰（新电表）'/'电表1：谷' → 规范时段名;非时段返回 None。"""
    s = PAREN_RE.sub("", str(label or "")).strip()
    for raw, norm in SEG_ALIAS:
        if s == raw or s.endswith(raw):
            return norm
    return None


def norm_tag(tag, seg):
    """彭健宜峰/彭健宜尖 → 彭健宜(同一块表的分时段行各自建了表标识);其余原样。"""
    if tag and seg:
        for raw, _ in SEG_ALIAS:
            if tag.endswith(raw):
                return tag[: -len(raw)]
    return tag


def tagset(sv):
    return {str(sv.cell(r, 1).value).strip() for r in range(1, sv.max_row + 1)
            if isinstance(sv.cell(r, 1).value, str) and str(sv.cell(r, 1).value).strip()}


def parse_book(phase, wbf, wbv, park_e, park_w):
    """park_e/park_w = 该期园区电/水抄表册 sheet 名(用于读数无公式时回退认表)。"""
    tagsets = [("宿舍电", tagset(wbv["宿舍电"])), (park_e, tagset(wbv[park_e])),
               ("宿舍水", tagset(wbv["宿舍水"])), (park_w, tagset(wbv[park_w]))]
    rows, notice_sheets = [], []
    for name in wbv.sheetnames:
        if name in SKIP_SHEETS:
            continue
        sv, sf = wbv[name], wbf[name]
        if NOTICE_MARK not in str(sv["B1"].value or ""):
            continue
        notice_sheets.append(name)
        maxc = min(sv.max_column, 16)
        ctx, group, notice_no, last_group_key, title = None, "", 0, None, str(sv["B1"].value or "")
        for r in range(1, sv.max_row + 1):
            b = sv.cell(r, 2).value
            if isinstance(b, str) and NOTICE_MARK in b:
                notice_no += 1
                group = ""
                title = b
            h = header_of(sv, r, maxc)
            if h:
                ctx = h
                continue
            if ctx is None:
                continue
            kind, cm = ctx
            if kind == "notice":
                cp = cm["项目"]
                cprev = cm.get("上月行至") or cm.get("上月抄表行至")
                labels = [sv.cell(r, c).value for c in range(cp, cprev)]
                labels = [str(x).replace("\n", "").strip() for x in labels
                          if isinstance(x, str) and str(x).strip()]
                if not labels:
                    continue
                if len(labels) > 1:
                    group = labels[0]
                item = labels[-1]
                price = sv.cell(r, cm["单价"]).value if "单价" in cm else None
                if not num(price):
                    continue
                qty = sv.cell(r, cm["实际用量"]).value if "实际用量" in cm else None
                amt = sv.cell(r, cm["金额"]).value if "金额" in cm else None
                note = sv.cell(r, cm["备注"]).value if "备注" in cm else None
                ratio = sv.cell(r, cm["按尖峰电价收取比率"]).value if "按尖峰电价收取比率" in cm else None
                tag = sv.cell(r, 1).value
                tag = tag.strip() if isinstance(tag, str) else None
                fprev = sf.cell(r, cprev).value
                m = SRC_RE.search(str(fprev)) if fprev else None
                src = m.group(1) if m else None
                ccur = cm.get("本月行至")
                has_reading = num(sv.cell(r, cprev).value) and ccur and num(sv.cell(r, ccur).value)
                if src is None and tag and has_reading:   # 上月读数被硬编码(无公式)时按抄表册反查
                    for sname, ts in tagsets:
                        if tag in ts:
                            src = sname
                            break
                mprefix, lab = split_meter_label(item)
                seg = seg_of(lab)
                shadow = (item == "" or lab == "") and isinstance(note, str) and "尖峰电价" in note
                # 双票结构:维护费单把同样的表行按 0.16/0.5 再列一遍;
                # 只认以「…维护费」开头的段标签(禹晨「电费、用电维护费」是合一单,不算)
                is_maint = ("维护费" in title
                            or str(group or "").startswith(("用电维护费", "水电维护费", "用水维护费")))
                # 管理费/维护费的单列行
                if lab in ("电力管理费", "用电管理费", "水管网维护费"):
                    k = "water_mgmt" if lab == "水管网维护费" else "mgmt"
                    rows.append(dict(phase=phase, sheet=name, notice=notice_no, row=r, tag=tag, group=group,
                                     kind=k, seg=lab, price=D(price), qty=D(qty) if num(qty) else None,
                                     amount=D(amt) if num(amt) else None, src=src, dorm_room=False,
                                     gkey=last_group_key, note=note, ratio=None))
                    continue
                if src is None and not shadow:
                    continue
                is_elec = src in ("宿舍电", "一期园区电", "二期园区电") or shadow
                is_water = src in ("宿舍水", "一期园区水", "二期园区水")
                if not (is_elec or is_water):
                    continue
                if is_elec:
                    if shadow:
                        gkey, segn = last_group_key, "尖峰_nominal"
                    else:
                        gkey = (phase, name, norm_tag(tag, seg), mprefix)
                        last_group_key = gkey
                        segn = seg or lab
                    rows.append(dict(phase=phase, sheet=name, notice=notice_no, row=r, tag=tag, group=group,
                                     kind="mgmt" if is_maint else "elec", seg=segn, price=D(price),
                                     qty=D(qty) if num(qty) else None, amount=D(amt) if num(amt) else None,
                                     src=src or (last_group_key and "…"), dorm_room=False, gkey=gkey,
                                     note=note, ratio=D(ratio) if num(ratio) else None))
                else:
                    rows.append(dict(phase=phase, sheet=name, notice=notice_no, row=r, tag=tag, group=group,
                                     kind="water_mgmt" if is_maint else "water", seg=lab, price=D(price),
                                     qty=D(qty) if num(qty) else None, amount=D(amt) if num(amt) else None,
                                     src=src, dorm_room=False, gkey=None, note=note, ratio=None))
            else:  # 宿舍段分间块(VLOOKUP 键=房号,不是表标识)
                room = sv.cell(r, cm["宿舍"]).value
                # 部分宿舍水块表头漏写「项目」(如二期·张文峰 R33),退化为「租赁面积」右邻列
                citem = cm.get("项目") or cm["租赁面积（㎡）"] + 1
                item = sv.cell(r, citem).value
                if room is None or not isinstance(item, str) or item.strip() not in ("电表", "水表"):
                    continue
                item = item.strip()
                pcol = cm.get("基准电价") or cm.get("单价")
                price = sv.cell(r, pcol).value if pcol else None
                if not num(price):
                    continue
                qty = sv.cell(r, cm["实际用量"]).value if "实际用量" in cm else None
                amt = sv.cell(r, cm["金额"]).value if "金额" in cm else None
                mgmt = sv.cell(r, cm["电力管理费"]).value if "电力管理费" in cm else None
                wmgmt = sv.cell(r, cm["用水维护费"]).value if "用水维护费" in cm else None
                tag = f"宿舍{room}"
                gkey = (phase, name, tag, "")
                base = dict(phase=phase, sheet=name, notice=notice_no, row=r, tag=tag, group="宿舍段",
                            dorm_room=True, note=None, ratio=None, qty=D(qty) if num(qty) else None)
                if item == "电表":
                    rows.append(dict(base, kind="elec", seg="电表", price=D(price),
                                     amount=D(amt) if num(amt) else None, src="宿舍电", gkey=gkey))
                    if "电力管理费" in cm:      # 旧模板(工程队宿舍)无此列 → 不造行
                        rows.append(dict(base, kind="mgmt", seg="电力管理费(宿舍内嵌列)",
                                         price=D(mgmt) if num(mgmt) else None, amount=None,
                                         src="宿舍电", gkey=gkey))
                else:
                    rows.append(dict(base, kind="water", seg="水表", price=D(price),
                                     amount=D(amt) if num(amt) else None, src="宿舍水", gkey=None))
                    if "用水维护费" in cm:
                        rows.append(dict(base, kind="water_mgmt", seg="用水维护费(宿舍内嵌列)",
                                         price=D(wmgmt) if num(wmgmt) else Decimal(0), amount=None,
                                         src="宿舍水", gkey=None))
    return rows, notice_sheets


# ────────────────────────────── 两棵判定树 ──────────────────────────────
def expected(row, tou_groups, dorm_groups, P, tree):
    """两棵树只差 ①② 的优先级;水费两树一致。tree='literal'|'fixed' → (应用价, 依据)"""
    seg, g, k = row["seg"], row["gkey"], row["kind"]
    is_tou = g in tou_groups
    dorm = (row["src"] in ("宿舍电", "宿舍水")) or (g in dorm_groups)
    if k == "elec":
        if tree == "literal" and dorm:
            return P["resident"], "①表在宿舍册→居民价"
        if is_tou:
            if seg == "尖峰_nominal":
                return P["尖峰_nominal"], "②分时→尖段名义价(比率0,量0)"
            if seg == "尖峰":
                return P["峰"], "②分时→尖段按峰价(比率0)"
            if seg in ("峰", "平", "谷"):
                return P[seg], f"②分时→{seg}价"
            return None, f"②分时组内异常时段标签:{seg}"
        if dorm:
            return P["resident"], "②表在宿舍册→居民价"
        return P["commercial"], "③无分时读数→商业价"
    if k == "mgmt":
        if g is None:
            return None, "维护费行未关联到电表组"
        if dorm:
            return P["resident_mgmt"], "宿舍→管理费 0.16"
        if is_tou:
            return P["tou_mgmt"], "分时→管理费 0.16"
        return P["commercial_mgmt"], "商业→维护费 0.32"
    wdorm = dorm if tree == "literal" else row["dorm_room"]
    if k == "water":
        return (Decimal("3.85"), "宿舍水价 3.85") if wdorm else (Decimal("3.95"), "园区水价 3.95")
    if k == "water_mgmt":
        return (Decimal("0"), "宿舍水无管网费") if wdorm else (Decimal("0.5"), "管网维护费 0.5")
    return None, "?"


def classify(row, exp, P):
    act = row["price"]
    ex = KNOWN_EXCEPTION.get(row["sheet"])
    suffix = f" 〔已知例外:{ex}〕" if ex else ""
    tous = {P["峰"], P["平"], P["谷"], P["尖峰_nominal"]}
    if act == Decimal("1"):
        return "户级包干一口价 1.0 元/度(含维护)" + suffix
    if act == Decimal("1.5"):
        return "户级商铺包干 1.5 元/度" + suffix
    if act == Decimal("4.45"):
        return "户级水价 4.45(水+管网合并价)" + suffix
    if row["kind"] in ("mgmt",) and act in (Decimal("0.1"), Decimal("0.15")):
        return f"户级管理费例外 {act}" + suffix
    if row["kind"] == "elec" and act in (Decimal("0.1"), Decimal("0.15")):
        return f"户级电价例外 {act}(维护费单按户级费率)" + suffix
    if act == P["commercial"] and exp in tous:
        return "⑥有分时读数却按商业单一价"
    if act in tous and exp == P["commercial"]:
        return "⑦无分时读数却按分时价"
    if act == P["resident"] and exp != P["resident"]:
        return "非宿舍房间表却按居民价"
    if exp == P["resident"] and act != P["resident"]:
        return f"宿舍册表却未按居民价(实际 {act})"
    return f"其他差异(Excel {act} / 判定 {exp})" + suffix


# ────────────────────────────── 主流程 ──────────────────────────────
def main():
    detail = "--miss-detail" in sys.argv
    books, all_rows, sheets_by_phase, reg = {}, [], {}, {}
    for phase, path, ereg, wreg in BOOKS:
        wbf = openpyxl.load_workbook(path, data_only=False)
        wbv = openpyxl.load_workbook(path, data_only=True)
        books[phase] = wbv
        rows, sheets = parse_book(phase, wbf, wbv, ereg, wreg)
        all_rows += rows
        sheets_by_phase[phase] = sheets
        reg[phase] = load_registers(wbv, ereg)
    P = load_prices(books["一期"]["创显承担电费"])
    p2 = books["二期"]["二期园区电"]
    xchk = {"峰": D(p2["AC10"].value), "尖峰_nominal": D(p2["AC11"].value), "平": D(p2["AC12"].value),
            "谷": D(p2["AC13"].value), "resident": D(p2["AA14"].value)}

    seg_by_group = defaultdict(set)
    for r in all_rows:
        if r["gkey"] and r["seg"] in TOU_SEGS:
            seg_by_group[r["gkey"]].add(r["seg"])
    tou_groups = {g for g, s in seg_by_group.items() if len(s) >= 2}
    dorm_groups = {r["gkey"] for r in all_rows if r["kind"] == "elec" and r["src"] == "宿舍电" and r["gkey"]}

    print(f"══════════ 计价规则复刻验证 {YM} ══════════")
    print(f"源册 一期: {BOOKS[0][1]}")
    print(f"源册 二期: {BOOKS[1][1]}")
    print(f"通知单 sheet: 一期 {len(sheets_by_phase['一期'])} 张 / 二期 {len(sheets_by_phase['二期'])} 张;"
          f" 明细行 {len(all_rows)} 条;识别为分时表的表组 {len(tou_groups)} 个")
    print("价目(读自 一期!创显承担电费 K3:O9): " + ", ".join(f"{k}={v}" for k, v in P.items()))
    print("跨册价目交叉校验(二期园区电!AA14/AC10:AC13): " +
          "; ".join(f"{k} {'✓' if P[k] == v else '✗ ' + str(v)}" for k, v in xchk.items()))
    print()

    order = [("elec", "电费明细行"), ("mgmt", "电力管理费/维护费行"),
             ("water", "水费明细行"), ("water_mgmt", "水管网维护费行")]
    results = {}
    for tree, title in (("literal", "A 字面树(宿舍册优先 → 分时 → 商业)"),
                        ("fixed", "B 修正树(分时优先 → 宿舍房间 → 商业)")):
        stats = defaultdict(lambda: [0, 0])
        misses = []
        for r in all_rows:
            exp, why = expected(r, tou_groups, dorm_groups, P, tree)
            stats[r["kind"]][0] += 1
            if exp is not None and r["price"] is not None and r["price"] == exp:
                stats[r["kind"]][1] += 1
            else:
                misses.append((dict(r), exp, why))
        results[tree] = (stats, misses)
        tot = sum(v[0] for v in stats.values())
        hit = sum(v[1] for v in stats.values())
        print(f"── 命中率 · {title} ──")
        for k, label in order:
            n, h = stats[k]
            print(f"  {label:<18} 总 {n:>4} 行,命中 {h:>4},不命中 {n - h:>3},命中率 {h / n * 100:6.2f}%"
                  if n else f"  {label:<18} 0 行")
        print(f"  {'合计':<18} 总 {tot:>4} 行,命中 {hit:>4},不命中 {tot - hit:>3},命中率 {hit / tot * 100:6.2f}%")
        print()

    print("── 不命中归因 · B 修正树 ──")
    buckets = defaultdict(list)
    for r, exp, why in results["fixed"][1]:
        buckets[classify(r, exp, P)].append((r, exp, why))
    for cause, lst in sorted(buckets.items(), key=lambda kv: -len(kv[1])):
        who = sorted({f"{x[0]['phase']}·{x[0]['sheet']}" for x in lst})
        print(f"  [{len(lst):>3} 行] {cause}")
        print(f"        涉及 {len(who)} 户: {', '.join(who)}")
        if detail:
            for r, exp, why in lst[:300]:
                print(f"          {r['phase']}·{r['sheet']}!R{r['row']} 表={r['tag']} 段={r['group']}/{r['seg']} "
                      f"Excel={r['price']} 判定={exp} ({why})")
    print()

    # ────── 边界核查 ①~⑦ ──────
    print("── 边界核查(B 修正树口径) ──")
    exp_fixed = {id(r): expected(r, tou_groups, dorm_groups, P, "fixed") for r in all_rows}

    def rate(sel):
        n = len(sel)
        h = sum(1 for r in sel if r["price"] == exp_fixed[id(r)][0])
        return f"{h}/{n}" + (f" ({h / n * 100:.1f}%)" if n else "")

    ecs = [r for r in all_rows if r["kind"] == "elec"]
    print(f"  ① 单一价电表(无分时→商业价 {P['commercial']}): "
          f"{rate([r for r in ecs if r['gkey'] not in tou_groups and not r['dorm_room']])}")
    print(f"  ② 分时电表(四时段价+0.16):        {rate([r for r in ecs if r['gkey'] in tou_groups])}")
    print(f"  ③ 宿舍房间表(居民价 {P['resident']}+0.16): {rate([r for r in ecs if r['dorm_room']])}")
    print(f"     宿舍册但非房间表(商铺/宿舍区独立户): {rate([r for r in ecs if r['src'] == '宿舍电' and not r['dorm_room']])}"
          f"  ← 字面树认定为居民价的口子")
    for grp, names in (("④商铺", ("章肖艳", "李李商铺")), ("⑤包干户", ("禹晨", "粤海华创", "联塑精铟"))):
        for nm in names:
            sel = [r for r in ecs if r["sheet"] == nm]
            print(f"  {grp} {nm}: {len(sel)} 行,Excel 实际单价 {sorted({str(r['price']) for r in sel})}")
    # 宿舍册水价的两种判据对比(3.85 无管网 vs 3.95+0.5)
    wat = [r for r in all_rows if r["kind"] == "water"]
    for crit, sel in (("判据a 表在宿舍水册", [r for r in wat if r["src"] == "宿舍水"]),
                      ("判据b 宿舍房间表(房号为键)", [r for r in wat if r["dorm_room"]])):
        dist = defaultdict(int)
        for r in sel:
            dist[str(r["price"])] += 1
        print(f"  水价·{crit}: {len(sel)} 行 → " + ", ".join(f"{k}×{v}" for k, v in sorted(dist.items())))
    others = [r for r in wat if r["src"] not in ("宿舍水",) and not r["dorm_room"]]
    dist = defaultdict(int)
    for r in others:
        dist[str(r["price"])] += 1
    print(f"  水价·园区册(非宿舍): {len(others)} 行 → " + ", ".join(f"{k}×{v}" for k, v in sorted(dist.items())))
    print("  ⑥⑦ 抄表册分时可用性 × 出账方式(逐表交叉,不依赖通知单排版):")
    cross, seen = defaultdict(list), set()
    for r in ecs:
        g = r["gkey"]
        if g is None or g in seen or r["dorm_room"]:
            continue
        seen.add(g)
        cross[(reg[r["phase"]].get(r["tag"]), g in tou_groups)].append((r["phase"], r["sheet"], r["tag"]))
    LAB = {(True, True): "有分时读数 且 按分时出账 ✓",
           (False, False): "无分时读数 且 按单一价出账 ✓",
           (True, False): "⑥ 有分时读数 却按单一价出账 ⚠",
           (False, True): "⑦ 无分时读数 却按分时出账 ⚠",
           (None, True): "抄表册查无此表标识(按分时出账)",
           (None, False): "抄表册查无此表标识(按单一价出账)"}
    for key, lst in sorted(cross.items(), key=lambda kv: str(kv[0])):
        print(f"      [{len(lst):>3} 表] {LAB[key]}")
        if key not in ((True, True), (False, False)):
            for p, s, t in sorted(lst)[:60]:
                print(f"            {p}·{s} 表={t}")
    print()
    print(f"逐行不命中清单: python {os.path.basename(__file__)} --miss-detail")


if __name__ == "__main__":
    main()
