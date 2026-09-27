# -*- coding: utf-8 -*-
"""rule_check.py — 复核报告「差异按原因分类」里靠逐月数据立住的几条(只读 out/,不连库、不跑引擎)。

    python scripts/pool-recon/rule_check.py

G1  折入源池(method=ref 且有自己的表):引擎分段用量 × 源册段价(当月 AB4)= 源册 W,七个月逐月逐池
M1  二期尖价比率:按源册当月比率复算非 ref 池应分摊,逐月列相等池数与 Σ(复算−引擎)
F1  一期 F座损耗:源册分表里 EF充电车棚 的用量 = 分表 D 的差(源册−引擎)
T3  五车间电梯:引擎 netParts 里 +1 表用量 = 源册头行 L(引擎 qtyTotal 是扣完火炬园的净额)
G1 任一月不成立 → 退出码 1(判「通用规则」的前提是七个月无例外)。
"""
import os
import sys
from decimal import Decimal

import compare

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")
MONTHS = ["2023-08", "2023-09", "2023-10", "2023-11", "2023-12", "2024-01", "2024-02"]
D, same = compare.D, compare.same


def main():
    g1_fail = 0
    for ym in MONTHS:
        exp = compare.load(os.path.join(OUT, ym, "expected.json"))
        eng = compare.load(os.path.join(OUT, ym, "engine.json"))
        ref, ok, n, gap = [], 0, 0, Decimal(0)
        for p, r in compare.match_pools(ym, exp, eng):
            if not p or not r or p["zone"] != "p2" or p.get("refOf"):
                continue
            ratio = D((p.get("sharpRatio") or {}).get("value")) or Decimal(0)
            alt = compare.p2_cost(r, ratio, exp)
            if r.get("method") == "ref":
                hit = same(alt, p.get("cost"))
                g1_fail += not hit
                ref.append(f"{p['key']} 源册 {p['cost']} 复算 {alt} {'=' if hit else '≠'}")
            elif r.get("costAmount") is not None:
                n += 1
                ok += same(alt, p.get("cost"))
                gap += alt - D(r["costAmount"])
        ef = next((D(m["qty"]) for u in exp["loss"] if u["label"] == "F座"
                   for m in u.get("dMembers") or [] if m["name"] == "EF充电车棚"), None)
        f_book = next((D(u["d"]) for u in exp["loss"] if u["label"] == "F座"), None)
        f_eng = next((D(u["dQty"]) for u in eng["loss"]["units"] if u["label"] == "一期 F座"), None)
        l5 = next((p for p in exp["pools"] if p["zone"] == "p2" and p["key"] == "五车间电梯"), None)
        r5 = next((r for r in eng["pools"]["rows"] if r["ruleId"] == 16), None)
        gross = sum((D(x["qty"]) for x in (r5 or {}).get("netParts") or [] if x["sign"] == 1), Decimal(0))
        print(f"{ym}  G1 {'; '.join(ref)}")
        print(f"         M1 按源册比率复算=源册 {ok}/{n} 池,Σ(复算−引擎)={gap}")
        print(f"         F1 EF充电车棚 {ef} / F座 D 源册−引擎 {f_book - f_eng if None not in (f_book, f_eng) else '?'}")
        print(f"         T3 五车间电梯 源册 L={l5 and l5['qty']} 引擎 +1 表={gross} 净额={r5 and r5['qtyTotal']}")
    print("G1 七个月无例外" if not g1_fail else f"G1 有 {g1_fail} 格不成立")
    return 1 if g1_fail else 0


if __name__ == "__main__":
    sys.exit(main())
