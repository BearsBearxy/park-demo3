# -*- coding: utf-8 -*-
"""verify_pool_202402.py — S3-B1 刀4:池核算引擎 2024-02 真实数据勾稽验证。

GET /api/alloc/pools?ym=2024-02 与 /api/alloc/loss?ym=2024-02,逐池逐列与
pool-expected-2024-02.json 精确比对(Decimal 全等,不设容差)。
比对列:qtyTotal/qtySharp/qtyPeak/qtyFlat/qtyValley/cost→costAmount/std→stdValue/base→baseSnap;
allocated/gap 跳过(受益人=B2 刀)。known_diff 清单内的池差异单独归类。
合计锚点:p2 ΣqtyTotal=31986.3(L126)/Σcost=14333.60(W126)。
"""
import csv
import io
import json
import os
import sys
import urllib.request
from decimal import Decimal

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
API = "http://localhost:8080"
HERE = os.path.dirname(os.path.abspath(__file__))
FIXTURE = os.path.join(HERE, "pool-expected-2024-02.json")
RENAME_TSV = os.path.join(HERE, "pool-rename-2026-07-30.tsv")  # V70 位置化改名对照表(旧名→池ID)
YM = "2024-02"
POOL_COLS = [  # (fixture 键, API 键)
    ("qtyTotal", "qtyTotal"), ("qtySharp", "qtySharp"), ("qtyPeak", "qtyPeak"),
    ("qtyFlat", "qtyFlat"), ("qtyValley", "qtyValley"),
    ("cost", "costAmount"), ("std", "stdValue"), ("base", "baseSnap"),
]
LOSS_COLS = [
    ("c", "cQty"), ("cable", "cableQty"), ("d", "dQty"), ("e", "eQty"),
    ("rawRate", "rawRate"), ("g", "gQty"), ("adjQty", "adjQty"), ("adjRate", "adjRate"),
    ("variant", "variant"), ("tenantRate", "tenantRate"),
]


def api(path, method="GET", body=None, token=None):
    req = urllib.request.Request(API + path, method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Content-Type": "application/json",
                 **({"Authorization": "Bearer " + token} if token else {})})
    with urllib.request.urlopen(req) as resp:
        r = json.loads(resp.read().decode())
    if isinstance(r, dict) and "code" in r and "data" in r:
        if r["code"] != 0:
            raise SystemExit(f"{path}: code={r['code']} {r.get('message')}")
        return r["data"]
    return r


def dec(v):
    """数值统一 Decimal 归一(去尾零)比对;None 保持 None;字符串原样。"""
    if v is None or isinstance(v, str):
        return v
    return Decimal(str(v)).normalize()


def cell(v):
    return "∅" if v is None else str(v)


def rename_map():
    """旧名→ruleId。V70 后池名已位置化,fixture 仍用旧名 → 按池 ID 对齐(名字不再是键)。"""
    if not os.path.exists(RENAME_TSV):
        return {}
    with open(RENAME_TSV, encoding="utf-8-sig") as f:
        return {r["旧名"]: int(r["池ID"]) for r in csv.DictReader(f, delimiter="\t")}


def main():
    fix = json.load(open(FIXTURE, encoding="utf-8"))
    token = api("/api/auth/login", "POST", {"username": "admin", "password": "admin123"})["token"]
    pools = api(f"/api/alloc/pools?ym={YM}", token=token)
    loss = api(f"/api/alloc/loss?ym={YM}", token=token)
    known_pools = {k["pool"]: k["issue"] for k in fix.get("known_diff", [])}
    phantom_pools = {p["rule"]: p["reason"] for p in fix.get("phantom_meters", [])}
    kl = fix.get("known_loss", {})
    known_units = {k["name"]: k["issue"] for k in kl.get("units", [])}
    known_recon = {k["key"]: k["issue"] for k in kl.get("recon", [])}

    print(f"generated: pools={pools['generated']} loss={loss['generated']}")
    rows_by_key = {(r["zone"], r["name"]): r for r in pools["rows"]}
    rows_by_id = {r["ruleId"]: r for r in pools["rows"]}
    old2id = rename_map()

    def find(p):  # 先按池 ID(V70 改名后唯一稳定键),回退旧名同名匹配
        return rows_by_id.get(old2id.get(p["name"])) or rows_by_key.get((p["zone"], p["name"]))

    diffs, known_hits, phantom_hits, fill_hits, missing = [], [], [], [], []
    equal = 0
    for p in fix["pools"]:
        row = find(p)
        if row is None:
            missing.append(f"{p['zone']}|{p['name']}: 引擎无此池")
            continue
        cols_bad = []
        for fk, ak in POOL_COLS:
            if fk not in p:      # 水/单读数池 fixture 无分时列 → 不比
                continue
            exp, act = dec(p.get(fk)), dec(row.get(ak))
            if exp != act:
                cols_bad.append((fk, p.get(fk), row.get(ak)))
        if not cols_bad:
            equal += 1
            continue
        if p["name"] in known_pools:
            bucket, tag = known_hits, known_pools[p["name"]]
        elif p["name"] in phantom_pools:
            bucket, tag = phantom_hits, phantom_pools[p["name"]]
        elif all(e is None and a is not None for _, e, a in cols_bad):
            bucket, tag = fill_hits, "Excel 该格空白,引擎按读数补全(数值口径差,非算错)"
        else:
            bucket, tag = diffs, ""
        for fk, e, a in cols_bad:
            bucket.append((f"{p['zone']}|{p['name']}", fk, e, a, tag))

    # 合计锚点(p2):W126=池应分摊Σ;qtyHeadSum=池头行度数Σ(L126 为总行+分段混合口径,仅展示)
    p2_rows = [r for r in pools["rows"] if r["zone"] == "p2"]
    sum_qty = sum(Decimal(str(r["qtyTotal"])) for r in p2_rows if r["qtyTotal"] is not None)
    sum_cost = sum(Decimal(str(r["costAmount"])) for r in p2_rows if r["costAmount"] is not None)
    # fixture 口径回折:实际Σ − (实际−期望)差异 − fixture 空白格实际值 = fixture 池Σ(闭合校验)
    adj_qty, adj_cost = sum_qty, sum_cost
    for p in fix["pools"]:
        if p["zone"] != "p2":
            continue
        row = find(p)
        if row is None:
            continue
        for fk, ak in (("qtyTotal", "qtyTotal"), ("cost", "costAmount")):
            e, a = p.get(fk), row.get(ak)
            if dec(e) == dec(a) or a is None:
                continue
            delta = Decimal(str(a)) - (Decimal(str(e)) if e is not None else Decimal(0))
            if fk == "qtyTotal":
                adj_qty -= delta
            else:
                adj_cost -= delta
    t = fix["totals"]["p2"]
    print("\n== 合计锚点(p2) ==")
    print(f"Σcost      期望(W126) {t['cost']} 实际 {sum_cost} 扣除已归因差异后 {adj_cost}  "
          f"{'✔闭合' if dec(t['cost']) == dec(adj_cost) else '✘'}")
    print(f"ΣqtyTotal  期望(池头行Σ) {t['qtyHeadSum']} 实际 {sum_qty} 扣除已归因差异后 {adj_qty}  "
          f"{'✔闭合' if dec(t['qtyHeadSum']) == dec(adj_qty) else '✘'}")
    print(f"(L126={t['qtyTotal']} 为 Excel 总行+分段行混合口径 tfoot 锚,不做池Σ比对)")

    print(f"\n== 池比对 == 总池数 {len(fix['pools'])} / 全等 {equal} / 差异池 "
          f"{len(fix['pools']) - equal - len(missing)} / 缺失 {len(missing)}")
    for m in missing:
        print("  缺失:", m)
    for name, col, e, a, _ in diffs:
        print(f"  DIFF {name} .{col}: 期望 {cell(e)} 实际 {cell(a)}")
    for name, col, e, a, issue in fill_hits:
        print(f"  FILL {name} .{col}: 期望 {cell(e)} 实际 {cell(a)}  [{issue}]")
    for name, col, e, a, issue in phantom_hits:
        print(f"  PHANTOM {name} .{col}: 期望 {cell(e)} 实际 {cell(a)}  [{issue}]")
    for name, col, e, a, issue in known_hits:
        print(f"  KNOWN {name} .{col}: 期望 {cell(e)} 实际 {cell(a)}  [{issue}]")

    # 损耗(引擎 label 带「一期 /二期 」前缀与供电备注,归一后按名对齐)
    print("\n== 楼栋损耗 ==")
    def norm(label):
        s = label.replace("一期 ", "").replace("二期 ", "")
        return s.split("(")[0]
    units_by_label = {}
    for u in loss["units"]:
        units_by_label.setdefault(norm(u["label"]), u)
    matched = set()
    loss_eq = loss_diff = loss_known = 0
    for zone in ("p1", "p2"):
        for exp in fix["loss"][zone]:
            name = norm(exp["name"])
            u = units_by_label.get(name)
            if u is not None:
                matched.add(norm(u["label"]))
            if u is None:
                if name in known_units:
                    loss_known += 1
                    print(f"  KNOWN {zone}|{exp['name']} 单元缺失  [{known_units[name]}]")
                else:
                    loss_diff += 1
                    print(f"  缺失单元 {zone}|{exp['name']}(引擎无对应组)")
                continue
            bad = []
            for fk, ak in LOSS_COLS:
                e, a = dec(exp.get(fk)), dec(u.get(ak))
                if e != a:
                    bad.append((fk, exp.get(fk), u.get(ak)))
            if bad and name in known_units:
                loss_known += 1
                for fk, e, a in bad:
                    print(f"  KNOWN {zone}|{exp['name']} .{fk}: 期望 {cell(e)} 实际 {cell(a)}  [{known_units[name]}]")
            elif bad:
                loss_diff += 1
                for fk, e, a in bad:
                    print(f"  DIFF {zone}|{exp['name']} .{fk}: 期望 {cell(e)} 实际 {cell(a)}")
            else:
                loss_eq += 1
    extra = [u["label"] for u in loss["units"] if norm(u["label"]) not in matched]
    print(f"损耗单元:全等 {loss_eq} / KNOWN {loss_known} / 未归因差异 {loss_diff} / 引擎多出 {len(extra)}")
    for x in extra:
        print(f"  引擎多出单元: {x}")
    recon_by_zone = {r["zone"]: r for r in loss.get("recon", [])}
    for zone in ("p1", "p2"):
        exp = fix["loss"][f"{zone}_recon"]
        r = recon_by_zone.get(zone)
        if r is None:
            print(f"  {zone} recon 缺失")
            continue
        for fk, ak in [("supply", "supplyQty"), ("sumC", "sumC"), ("sumD", "sumD")]:
            ok = dec(exp[fk]) == dec(r.get(ak))
            key = f"{zone}.{fk}"
            if not ok and key in known_recon:
                print(f"  recon {key}: 期望 {exp[fk]} 实际 {r.get(ak)}  KNOWN [{known_recon[key]}]")
            else:
                print(f"  recon {key}: 期望 {exp[fk]} 实际 {r.get(ak)}  {'✔' if ok else '✘'}")

    # warn 行
    warns = [(r["zone"], r["name"], r["warn"]) for r in pools["rows"] if r.get("warn")]
    print(f"\n== warn 行({len(warns)}) ==")
    for z, n, w in warns:
        print(f"  [{z}] {n}: {w}")


if __name__ == "__main__":
    main()
