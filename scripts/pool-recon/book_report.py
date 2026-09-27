# -*- coding: utf-8 -*-
"""book_report.py — 把 out/<月>/ 的逐月对账结果汇成一份总报告 docs/research/pool-book-recon-2026-09-25.md。

    python scripts/pool-recon/book_report.py

报告里手写的结论写在 MARK 这一行之前,重跑只替换 MARK 之后的生成部分(逐月概览 / 逐池差异 / 已分摊 / 损耗 /
2024-05 读数核对 / 逐户附表)。另写 out/book-report.json:逐月统计 + 应分摊或已分摊差 >1 元的池清单(带源册单元格)。
先跑完各月 recon.py run(和 readings 2024-05)再跑本脚本;它只读 out/,不连库。
"""
import csv
import json
import os
import re
import sys
from collections import defaultdict
from decimal import Decimal

import compare

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
OUT = os.path.join(HERE, "out")
DOC = os.path.join(REPO, "docs", "research", "pool-book-recon-2026-09-25.md")
MARK = "<!-- 以下由 scripts/pool-recon/book_report.py 生成;结论改这条线以上,重跑只替换以下部分 -->"
ZCN = {"p1": "一期", "p2": "二期"}
D, fmt, md = compare.D, compare.fmt, compare.md_table


def load(ym, name):
    return compare.load(os.path.join(OUT, ym, name))


def diff_rows(ym):
    with open(os.path.join(OUT, ym, "diff.csv"), encoding="utf-8-sig") as f:
        return [r + [""] * (10 - len(r)) for r in list(csv.reader(f))[1:]]


def label_of(p):
    return p["key"] or f"(无表行 r{p['headRow']} {p.get('members') or ''})"


def stats(ym, exp, eng, diffs):
    """逐期区:源册池数 / 逐列全等 / 应分摊差≤1 / 应分摊差>1 / 两边缺 / 应分摊与已分摊合计。一期绿化水(用水)池不算。"""
    cost_d = defaultdict(dict)
    for d in diffs:
        if d[0] == "池":
            cost_d[(d[1], d[2])][d[4]] = D(d[7])
    st = {z: defaultdict(Decimal) for z in ("p1", "p2")}
    for p, r in compare.match_pools(ym, exp, eng):
        if r is not None and r["zone"] == "p1" and r.get("feeKey") == "share_green_water":
            continue                        # 一期绿化水是用水池,不在公共电范围(二期绿化水泵是电,照比)
        z = (p or r)["zone"]
        s = st[z]
        if p is None:
            s["missingInBook"] += 1
            continue
        s["pools"] += 1
        if r is None:
            s["missingInSystem"] += 1
            continue
        ds = cost_d.get((z, label_of(p)), {})
        s["exact" if not ds else "off" if abs(ds.get("应分摊", 0)) > 1 else "within1yuan"] += 1
    for p in exp["pools"]:
        st[p["zone"]]["bookTotal"] += D(p.get("cost")) or 0
        if p["zone"] == "p2":
            st["p2"]["bookAlloc"] += D(p.get("allocated")) or 0
    st["p1"]["bookAlloc"] = sum((D(g.get("ae")) or 0 for g in exp["p1AllocGroups"]), Decimal(0))
    for r in eng["pools"]["rows"]:
        if r["zone"] in st and not (r["zone"] == "p1" and r.get("feeKey") == "share_green_water"):
            st[r["zone"]]["engineTotal"] += D(r.get("costAmount")) or 0
            st[r["zone"]]["engineAlloc"] += D(r.get("allocatedAmount")) or 0
    return st


FROZEN = set()      # 分摊页上各月读数(上月/本月行至)一模一样的池 → 断链缓存


def find_frozen(months):
    seen, n = defaultdict(set), defaultdict(int)
    for ym in months:
        for p in load(ym, "expected.json")["pools"]:
            if p["zone"] == "p1" and p.get("meters"):
                k = ("p1", label_of(p))
                seen[k].add(tuple((m.get("prev"), m.get("curr")) for m in p["meters"]))
                n[k] += 1
    # 每个月都在、读数却一个月都没变(且确有用量)才算
    FROZEN.update(k for k, v in seen.items() if n[k] == len(months) >= 3 and len(v) == 1
                  and any(a != b for a, b in next(iter(v))))


def month_section(ym, L, out_diffs, per_month):
    exp, eng, extra = load(ym, "expected.json"), load(ym, "engine.json"), load(ym, "extra.json")
    diffs = diff_rows(ym)
    st = stats(ym, exp, eng, diffs)
    L.append(f"## {ym}\n")
    src = exp["sources"]
    L.append(f"- 源册:一期 `{src['p1']['file']}`;二期 `{src['p2']['file']}`")
    for v in exp["variants"]:
        L.append(f"- 同月其他份(不用/旁证):{v}")
    for w in exp["selfcheck"]["warnings"]:
        L.append(f"- 注意:{w}")
    L.append(f"- 抽取自检通过 {len(exp['selfcheck']['passed'])} 项,失败 {len(exp['selfcheck']['errors'])} 项")
    imp = os.path.join(OUT, ym, "import-result.json")
    if os.path.exists(imp):
        body = compare.load(imp)
        errs = [f"{e['label']}({e['reason'][:40]}…)" for x in body for e in x["result"]["errors"]]
        L.append("- 读数:开发库没有这个月的全量读数,由对账工具导入临时库(前端同一套解析 + importRows):"
                 + ";".join(f"{x['file']} {x['rows']} 行导入 {x['result']['imported']}" for x in body)
                 + (f";导入错误 {len(errs)} 条:" + "、".join(errs) if errs else ""))
    else:
        L.append("- 读数:开发库原有")
    pf = os.path.join(OUT, ym, "prices-filled.json")
    if os.path.exists(pf):
        L.append("- 电价:库里没有当月电价,按源册单价−维护费补进临时库:"
                 + ",".join(f"{x['key']}={x['value']}" for x in compare.load(pf)))
    L.append("")
    L.append("### 概览\n")
    rows = []
    for z in ("p1", "p2"):
        s = st[z]
        per_month.append({"ym": ym, "zone": z, "pools": int(s["pools"]), "exact": int(s["exact"]),
                          "within1yuan": int(s["within1yuan"]), "off": int(s["off"]),
                          "missingInSystem": int(s["missingInSystem"]), "missingInBook": int(s["missingInBook"]),
                          "bookTotal": float(s["bookTotal"]), "engineTotal": float(s["engineTotal"]),
                          "bookAlloc": float(s["bookAlloc"]), "engineAlloc": float(s["engineAlloc"])})
        rows.append([ZCN[z], int(s["pools"]), int(s["exact"]), int(s["within1yuan"]), int(s["off"]),
                     int(s["missingInSystem"]), int(s["missingInBook"]), fmt(s["bookTotal"]), fmt(s["engineTotal"]),
                     fmt(s["bookAlloc"]), fmt(s["engineAlloc"])])
    L.append(md(["期区", "源册池", "逐列全等", "应分摊差≤1元", "应分摊差>1元", "源册有引擎无", "引擎有源册无",
                 "源册应分摊Σ", "引擎应分摊Σ", "源册已分摊Σ(实收)", "引擎摊出Σ"], rows))
    ts = extra["tenantStat"]
    L.append(f"逐户×费目:比 {ts['rows']} 格,相等 {ts['equal']} 格,差 {ts['rows'] - ts['equal']} 格(见附表 {ym});"
             f"户对不上 {len(extra['tenantUnmatched'])} 户。\n")
    if extra["unmatched"]:
        L.append("### 池对不上\n")
        L.append(md(["哪边缺", "期区", "键", "块/原册键", "应分摊"], extra["unmatched"]))
    L.append("### 逐池差异\n")
    pr = [d[1:5] + d[5:8] + [d[8], d[9]] for d in diffs if d[0] == "池"]
    L.append(md(["期区", "源册键", "引擎池", "列", "源册", "引擎", "引擎−源册", "可能原因", "源册单元格"], pr)
             if pr else "逐列全等\n")
    L.append("### 已分摊差(>1 元)\n")
    ar = [[d[1], d[2], d[3], d[5], d[6], d[7], d[8], d[9]] for d in diffs
          if d[0] == "已分摊" and abs(D(d[7]) or 0) > 1]
    L.append(md(["期区", "组(源册键)", "引擎池", "源册实收", "引擎摊出", "引擎−源册", "可能原因", "源册单元格"], ar)
             if ar else "无\n")
    L.append("块合计(一期逐组 AE 含同层他池份额,块合计才可比):\n")
    L.append(md(["期区", "块", "源册实收", "引擎摊出"], extra["allocBlocks"]))
    lr = [[d[1], d[2], d[4], d[5], d[6], d[7], d[8]] for d in diffs if d[0] == "损耗"]
    L.append("### 损耗单元差\n")
    L.append(md(["期区", "单元", "列", "源册", "引擎", "引擎−源册", "可能原因"], lr) if lr else "列全等\n")
    if extra["lossUnmatched"]:
        L.append(md(["情况", "期区", "单元"], extra["lossUnmatched"]))
    if extra["lossDrill"]:
        L.append("分表 D 下钻:\n")
        L.append(md(["单元", "表", "源册用量", "库里挂栋", "库里用量", "情况"], extra["lossDrill"]))
    qty_why = {(d[1], d[2]): d[8] for d in diffs if d[0] == "池" and d[4] == "用量"}
    # 读数连续性:本月本月行至 ≠ 下月上月行至 → 该表本月读数疑录错(只在下月也跑过时能查)
    y, mo = map(int, ym.split("-"))
    nym = f"{y + mo // 12}-{mo % 12 + 1:02d}"          # 紧接的下一个月,隔月的读数本来就接不上
    nxt = [nym] if os.path.exists(os.path.join(OUT, nym, "engine.json")) else []
    breaks = {}
    if nxt:
        prev_next = {ln["meterId"]: ln.get("prevTotal") for r in load(nxt[0], "engine.json")["pools"]["rows"]
                     for ln in r.get("lines") or []}
        for r in eng["pools"]["rows"]:
            for ln in r.get("lines") or []:
                pn = prev_next.get(ln["meterId"])
                if pn is not None and ln.get("currTotal") is not None and not compare.same(pn, ln["currTotal"]):
                    breaks[f"#{r['ruleId']}"] = (f";读数不连续:本月行至 {fmt(ln['currTotal'])},{nxt[0]} 上月行至 "
                                                 f"{fmt(pn)},疑录错")
    for d in diffs:
        if (d[0] == "池" and d[4] == "应分摊" or d[0] == "已分摊") and abs(D(d[7]) or 0) > 1:
            hyp = d[8]
            if hyp == "跟随用量差" and (d[1], d[2]) in qty_why:
                hyp = "用量差:" + qty_why[(d[1], d[2])] + breaks.get(d[3].split(" ")[0], "")
                if (d[1], d[2]) in FROZEN and "分摊页用量" in hyp:
                    hyp += ";分摊页 I/N 各月同值,疑断链外部引用缓存"
            hyp = hyp if len(hyp) <= 120 else hyp[:119] + "…"
            out_diffs.append({"ym": ym, "pool": f"{ZCN[d[1]]} {d[2]}({d[3]})",
                              "field": "应分摊" if d[0] == "池" else "已分摊",
                              "book": d[5], "engine": d[6], "bookEvidence": d[9] or "(源册无此格)",
                              "hypothesis": hyp})


def readings_section(ym, L, per_month):
    path = os.path.join(OUT, ym, "report.md")
    with open(path, encoding="utf-8") as f:
        text = f.read()
    body = text.split("\n", 1)[1]
    body = body.split("\n## 怎么重跑")[0]
    body = re.sub(r"^## ", "### ", body, flags=re.M)
    L.append(f"## {ym}(只有抄表页:只核公共表读数与用量)\n")
    L.append(body.strip() + "\n")
    m = re.search(r"引擎电池\(有绑定表,一期绿化水池不算\) \| (\d+) \|\n\| 其中用量与册上相等 \| (\d+) \|\n\| 池用量有差或缺读数 \| (\d+)",
                  text)
    unread = re.search(r"本月行至为空\(未抄\) \| (\d+)", text)
    if m:
        per_month.append({"ym": ym, "zone": "p1+p2(只核读数)", "pools": int(m.group(1)), "exact": int(m.group(2)),
                          "within1yuan": 0, "off": 0, "missingInSystem": 0, "missingInBook": 0,
                          "bookTotal": 0.0, "engineTotal": 0.0,
                          "note": f"只比用量:{m.group(2)} 个池绑定表全抄且引擎用量=Σ册上用量;{m.group(3)} 个池有表没抄或不在抄表页;"
                                  f"抄表页本月行至为空 {unread.group(1) if unread else '?'} 行"})


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    months = sorted(m for m in os.listdir(OUT) if os.path.exists(os.path.join(OUT, m, "diff.csv")))
    reading_months = sorted(m for m in os.listdir(OUT) if os.path.exists(os.path.join(OUT, m, "sheet.json")))
    body, out_diffs, per_month = [], [], []
    find_frozen(months)
    for ym in months:
        month_section(ym, body, out_diffs, per_month)
    for ym in reading_months:
        readings_section(ym, body, per_month)
    L = [MARK, "", "# 总表(生成)\n",
         "「应分摊差≤1元」= 池的用量/标准/基数等列有差但应分摊差不超过 1 元;二期引擎应分摊Σ不含两块广告字折入源池"
         "(源册单列 W),所以二期Σ天然差这两池之和。\n",
         md(["月", "期区", "源册池", "逐列全等", "应分摊差≤1元", "应分摊差>1元", "源册有引擎无", "引擎有源册无",
             "源册应分摊Σ", "引擎应分摊Σ", "源册已分摊Σ", "引擎摊出Σ"],
            [[x["ym"], ZCN.get(x["zone"], x["zone"]), x["pools"], x["exact"], x["within1yuan"], x["off"],
              x["missingInSystem"], x["missingInBook"], fmt(D(x["bookTotal"])), fmt(D(x["engineTotal"])),
              fmt(D(x.get("bookAlloc"))), fmt(D(x.get("engineAlloc")))] for x in per_month if "bookAlloc" in x]),
         f"# 逐月明细({', '.join(months + reading_months)})\n",
         "「引擎−源册」为正 = 引擎多;「可能原因」是 compare.py 按两边数据量出来的原因,量不出时给归类;"
         "「源册单元格」是比对用的源册格(一期「公共电分摊明细」,二期「公共电数据」)。\n"] + body
    L.append("# 附表:逐户 × 费目差\n")
    L.append("一期比「电费总表」,二期比「本月用电/用水数据统计」的 消防/电梯/路灯/线路损耗/绿化水 各列;"
             "逐户差多半跟随上面的池差与名单差,这里只列不解释。\n")
    for ym in months:
        tr = [[d[1], d[2], d[3], d[4], d[5], d[6], d[7], d[8]] for d in diff_rows(ym) if d[0] == "逐户"]
        L.append(f"## 附表 {ym}(逐户差 {len(tr)} 格)\n")
        L.append(md(["期区", "户(源册名)", "库里户", "费目", "源册", "引擎", "引擎−源册", "提示"], tr) if tr else "无\n")
    head = ""
    if os.path.exists(DOC):
        with open(DOC, encoding="utf-8") as f:
            head = f.read().split(MARK)[0]
    os.makedirs(os.path.dirname(DOC), exist_ok=True)
    with open(DOC, "w", encoding="utf-8", newline="\n") as f:
        f.write(head + "\n".join(L))
    with open(os.path.join(OUT, "book-report.json"), "w", encoding="utf-8") as f:
        json.dump({"perMonth": per_month, "diffs": out_diffs}, f, ensure_ascii=False, indent=1)
    print(f"{DOC}:{len(months)} 个月 + 读数月 {reading_months},应分摊/已分摊差>1元 {len(out_diffs)} 条")


if __name__ == "__main__":
    main()
