# -*- coding: utf-8 -*-
"""recon_loss_members_202402.py — S3-B1 终验刀·任务C:损耗分表Σ成员对齐核对。

按两册抄表 sheet(一期园区电/二期园区电)的段落合计公式还原每组成员行,
逐表与 dev meter 档案(host 13306)比对,输出三类清单:
  ①挂栋不符(dev building 与 Excel 段落不符/NULL) ②Excel 段落行 dev 缺档或缺 2024-02 读数
  ③dev 段落内多出的表(有读数但不在册Σ范围,且未被 loss_exclude/loss_supply/loss_c_meter 机制处理)
并按 dev 数据模拟各组 D(分表Σ),与 Excel 段落合计逐组比对。

段落成员=Σ公式原文(2024-02 册):
  p1  A座   S92=SUM(S7:S91)-S51-S52-S60-S77-S49-S50+X50, X50=S49+S50-SUM(S44:S48)
            → 成员=7..91 去 {44..48,51,52,60,77}(49/50 招商中心电经 X50 净入)
      B座   S112=SUM(S96:S111)(r95 四车间工地不入)
      C座   S147=SUM(S114:S146)-S131(力美C201电不入)
      D座   S168=SUM(S149:S167)   E座 S192=SUM(S170:S191)   F座 S212=SUM(S194:S211)
  p2  一车间 S26=SUM(S7:S25)          二车间 S39=SUM(S28:S38)
      三车间 S56=SUM(S41:S55)-S44-S45(铝缆)  四车间 S65=SUM(S58:S64)
      五车间 S84=SUM(S67:S83)-S73-S74(铝缆)-S68-S69(广告字消防分表)
      六车间 S101=SUM(S86:S100)-S87(广告字新表)
"""
import io
import sys
from decimal import Decimal

import openpyxl
import pymysql

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

P1_XLSX = r"C:\financial_dashboard\2025全年发生额、预算对比\2024年\2024年3月费用数据\2024年3月费用数据\一期\一期2024年2月水电费.xlsx"
P2_XLSX = r"C:\financial_dashboard\2025全年发生额、预算对比\2024年\2024年3月费用数据\2024年3月费用数据\二期\二期2024年2月水电费.xlsx"
YM = "2024-02"

# (zone, 组名, dev楼栋名, sheet, 成员行, 段落合计行)
SECTIONS = [
    ("p1", "A座", "一期 A座", "一期园区电",
     [r for r in range(7, 92) if r not in (44, 45, 46, 47, 48, 51, 52, 60, 77)], 92),
    ("p1", "B座", "一期 B座", "一期园区电", list(range(96, 112)), 112),
    ("p1", "C座", "一期 C座", "一期园区电", [r for r in range(114, 147) if r != 131], 147),
    ("p1", "D座", "一期 D座", "一期园区电", list(range(149, 168)), 168),
    ("p1", "E座", "一期 E座", "一期园区电", list(range(170, 192)), 192),
    ("p1", "F座", "一期 F座", "一期园区电", list(range(194, 212)), 212),
    ("p2", "一车间", "二期 一车间", "二期园区电", list(range(7, 26)), 26),
    ("p2", "二车间", "二期 二车间", "二期园区电", list(range(28, 39)), 39),
    ("p2", "三车间", "二期 三车间", "二期园区电",
     [r for r in range(41, 56) if r not in (44, 45)], 56),
    ("p2", "四车间", "二期 四车间", "二期园区电", list(range(58, 65)), 65),
    ("p2", "五车间", "二期 五车间", "二期园区电",
     [r for r in range(67, 84) if r not in (68, 69, 73, 74)], 84),
    ("p2", "六车间", "二期 六车间", "二期园区电",
     [r for r in range(86, 101) if r != 87], 101),
]
ROW_NAME_FIX = {("二期园区电", 51): "永龙反向有功"}   # S51 无名行=永龙反向有功电能Σ(倍率100,155.27)


def dec(v):
    if v is None:
        return None
    try:
        return Decimal(str(v))
    except Exception:
        return None   # 表头/文本格


def main():
    con = pymysql.connect(host="127.0.0.1", port=13306, user="root", password="root",
                          database="park_demo3", charset="utf8mb4")
    cur = con.cursor()
    cur.execute("SELECT id,name FROM building")
    bld = {n: i for i, n in cur.fetchall()}
    cur.execute("""SELECT m.id,m.zone,m.building_id,m.ownership,m.name,
                          r.prev_total,r.curr_total,r.factor_snap
                   FROM meter m LEFT JOIN meter_reading r ON r.meter_id=m.id AND r.ym=%s
                   WHERE m.kind='elec' AND m.zone IN ('p1','p2')""", (YM,))
    dev = {}
    for mid, zone, bid, own, name, pt, ct, fs in cur.fetchall():
        usage = (dec(ct) - dec(pt)) * dec(fs) if pt is not None and ct is not None else None
        dev[(zone, name)] = dict(id=mid, building_id=bid, ownership=own, usage=usage)
    cur.execute("SELECT scope FROM alloc_cfg WHERE cfg_key='loss_exclude' AND cfg_value<>0")
    excluded_ids = {int(s.split(":")[1]) for s, in cur.fetchall() if s.startswith("meter:")}
    cur.execute("SELECT scope,cfg_value FROM alloc_cfg WHERE cfg_key='loss_supply_meter'")
    supply_ids = {int(v) for _, v in cur.fetchall()}
    con.close()

    sheets = {}
    for path, sn in ((P1_XLSX, "一期园区电"), (P2_XLSX, "二期园区电")):
        ws = openpyxl.load_workbook(path, data_only=True, read_only=True)[sn]
        rows = {}
        for i, row in enumerate(ws.iter_rows(min_row=1, max_row=230, max_col=19), 1):
            vals = [c.value for c in row]
            rows[i] = dict(name=vals[0], usage=dec(vals[18]) if len(vals) > 18 else None)
        sheets[sn] = rows

    misplace, missing, extra, usage_diff = [], [], [], []
    print(f"== 损耗分表Σ成员对齐({YM}) ==")
    for zone, gname, bname, sn, members, sumrow in SECTIONS:
        bid = bld[bname]
        rows = sheets[sn]
        excel_sum = rows[sumrow]["usage"]
        member_names = set()
        dev_sum = Decimal(0)
        for r in members:
            name = ROW_NAME_FIX.get((sn, r)) or rows[r]["name"]
            if name is None:
                continue
            name = str(name).strip()
            member_names.add(name)
            ex_usage = rows[r]["usage"] or Decimal(0)
            d = dev.get((zone, name))
            if d is None:
                missing.append(f"{gname}|{name}(S{r},{ex_usage}度): dev 无此档")
                continue
            if d["usage"] is None:
                if ex_usage != 0:
                    missing.append(f"{gname}|{name}(S{r},{ex_usage}度): dev 有档无 {YM} 读数")
                continue
            if d["building_id"] != bid:
                misplace.append(f"{gname}|{name}(S{r}): dev 挂栋 {d['building_id']} ≠ {bname}({bid})")
                continue
            if d["usage"] != ex_usage:
                usage_diff.append(f"{gname}|{name}(S{r}): dev 用量 {d['usage']} ≠ 册 {ex_usage}")
            dev_sum += d["usage"]
        # dev 段落内多出的表(有读数、计入 D、不在册Σ成员;剔除机制已覆盖的不算)
        for (z, name), d in dev.items():
            if (z == zone and d["building_id"] == bid and d["usage"] is not None
                    and name not in member_names and d["ownership"] in ("tenant", "share")
                    and d["id"] not in excluded_ids and d["id"] not in supply_ids):
                extra.append(f"{gname}|{name}: dev 段落多出(用量 {d['usage']})")
                dev_sum += d["usage"]
        flag = "✔" if dev_sum == excel_sum else f"✘ 差 {dev_sum - excel_sum}"
        print(f"  {zone}|{gname}: Excel D={excel_sum}  dev模拟D={dev_sum}  {flag}")

    for title, items in (("①挂栋不符", misplace), ("②缺档/缺读数", missing),
                         ("③dev 多出", extra), ("④同名用量不符(双源)", usage_diff)):
        print(f"\n== {title}({len(items)}) ==")
        for it in items:
            print("  " + it)


if __name__ == "__main__":
    main()
