# -*- coding: utf-8 -*-
"""apply_0220.py — 0.22.0 临时库验证用的一次性配置(M2 / M9 / S2 / S10),只写 park_demo3_recon。

    python scripts/pool-recon/apply_0220.py --m9 keep-links   # M9 不给 08/09 折入链分版本(G1 两池 08/09 仍是折入源)
    python scripts/pool-recon/apply_0220.py --m9 source       # M9 照源册公式:08/09 入向折入链为空组 + std_add 0.01

先跑 keep-links 再跑 source 是单向的(source 只在 keep-links 之上加行);反过来要手工删行。
行形状照服务写出的:alloc_cfg + param_change_log 同 ParamService.write;绑定表/折入链/版本表同 AllocService.saveChildren
(+ logRuleChange 的 rule:{id} 行);读数同 MeterService.updateReading(source='manual' + data_change_log meter-reading)。
重复跑幂等:值相同不写、不记日志。
"""
import argparse
import sys
from decimal import Decimal

import pymysql

from recon import HOST, PORT, USER, PWD, RECON_DB

ACTOR = "recon-0220"
assert "recon" in RECON_DB


def cfg(cur, scope, key, month, mode, value, note):
    """ParamService.write 的 SQL 形:同 (scope,key,month,mode) 有行就改值,没有就插;值相同不写。"""
    value = Decimal(value)
    cur.execute("SELECT id, cfg_value FROM alloc_cfg WHERE scope=%s AND cfg_key=%s AND acct_month=%s AND mode=%s",
                (scope, key, month, mode))
    row = cur.fetchone()
    if row and Decimal(row[1]) == value:
        return f"= {scope} {key} {month}/{mode} {value}"
    if row:
        cur.execute("UPDATE alloc_cfg SET cfg_value=%s, note=%s WHERE id=%s", (value, note, row[0]))
    else:
        cur.execute("INSERT INTO alloc_cfg (scope, cfg_key, cfg_value, acct_month, mode, note) VALUES (%s,%s,%s,%s,%s,%s)",
                    (scope, key, value, month, mode, note))
    cur.execute("""INSERT INTO param_change_log (actor, tbl, scope, cfg_key, acct_month, mode, old_value, new_value, note, action)
                   VALUES (%s,'alloc',%s,%s,%s,%s,%s,%s,%s,'set')""",
                (ACTOR, scope, key, month, mode, None if not row else row[1], value, note))
    return f"+ {scope} {key} {month}/{mode} {value}"


def rule_log(cur, rule_id, month, note):
    cur.execute("SELECT name FROM alloc_rule WHERE id=%s", (rule_id,))
    name = cur.fetchone()[0]
    cur.execute("""INSERT INTO param_change_log (actor, tbl, scope, cfg_key, acct_month, mode, note, action)
                   VALUES (%s,'alloc',%s,'',%s,'from',%s,'set')""", (ACTOR, f"rule:{rule_id}", month, f"{name} {note}"))


def version(cur, rule_id, part, month):
    cur.execute("INSERT IGNORE INTO alloc_rule_version (rule_id, part, acct_month) VALUES (%s,%s,%s)", (rule_id, part, month))
    return cur.rowcount


def s2(cur):
    cur.execute("SELECT meter_id, ym, prev_total, curr_total FROM meter_reading WHERE id=12920")
    mid, ym, prev, curr = cur.fetchone()
    assert (mid, ym, prev) == (293, "2023-09", Decimal("88.47")), (mid, ym, prev)
    if curr == Decimal("122.43"):
        return "= S2 已是 122.43"
    cur.execute("UPDATE meter_reading SET curr_total=122.43, source='manual' WHERE id=12920")
    cur.execute("INSERT INTO data_change_log (ym, source, changed_at) VALUES ('2023-09','meter-reading',NOW())")
    return f"+ S2 meter_reading 12920 curr_total {curr} → 122.43"


def m2(cur):
    """#16 '' 组 = {59:+1};2023-10 组 = {59:+1, 58:−1}(= 先改初始版去掉 58,再在 2023-10 勾「只改本月起」加回)。"""
    cur.execute("SELECT id, meter_id, sign, acct_month FROM alloc_rule_meter WHERE rule_id=16 ORDER BY id")
    rows = cur.fetchall()
    want = {(59, 1, ""), (59, 1, "2023-10"), (58, -1, "2023-10")}
    if {(m, s, a) for _, m, s, a in rows} == want:
        return "= M2 已配"
    assert {(m, s, a) for _, m, s, a in rows} == {(59, 1, ""), (58, -1, "")}, rows
    cur.execute("DELETE FROM alloc_rule_meter WHERE rule_id=16 AND meter_id=58 AND acct_month=''")
    rule_log(cur, 16, "", "改池 · 绑定表 −火炬园广告字电(扣减)")
    cur.execute("INSERT INTO alloc_rule_meter (rule_id, meter_id, sign, acct_month) VALUES (16,59,1,'2023-10'),(16,58,-1,'2023-10')")
    version(cur, 16, "meter", "2023-10")
    rule_log(cur, 16, "2023-10", "改池(2023-10 起) · 绑定表 +火炬园广告字电(扣减)")
    return "+ M2 #16 '' = {59}, 2023-10 = {59, 58(−1)}"


def m9_links_source(cur):
    """#9 ← #21、#13 ← #15:08/09 入向链为空组(2023-08 登记版本无行),2023-10 起组 = {src fold_price};'' 组原样。"""
    out = []
    for dst, src in ((9, 21), (13, 15)):
        cur.execute("SELECT src_rule_id, link_type, acct_month FROM alloc_rule_link WHERE dst_rule_id=%s", (dst,))
        have = set(cur.fetchall())
        assert (src, "fold_price", "") in have, have
        if version(cur, dst, "link", "2023-08"):
            cur.execute("SELECT name FROM alloc_rule WHERE id=%s", (src,))
            rule_log(cur, dst, "2023-08", f"改池(2023-08 起) · 折入 −{cur.fetchone()[0]}(折入单价)")
            out.append(f"+ #{dst} link 2023-08 空组")
        if (src, "fold_price", "2023-10") not in have:
            cur.execute("INSERT INTO alloc_rule_link (src_rule_id, dst_rule_id, link_type, acct_month) VALUES (%s,%s,'fold_price','2023-10')",
                        (src, dst))
            version(cur, dst, "link", "2023-10")
            cur.execute("SELECT name FROM alloc_rule WHERE id=%s", (src,))
            rule_log(cur, dst, "2023-10", f"改池(2023-10 起) · 折入 +{cur.fetchone()[0]}(折入单价)")
            out.append(f"+ #{dst} link 2023-10 = {{{src}}}")
    return out


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--m9", choices=["keep-links", "source"], required=True)
    a = ap.parse_args()
    con = pymysql.connect(host=HOST, port=PORT, user=USER, password=PWD, database=RECON_DB, charset="utf8mb4")
    cur = con.cursor()
    cur.execute("SELECT DATABASE()")
    assert cur.fetchone()[0] == RECON_DB
    log = [s2(cur), m2(cur)]
    b = "对账 0.22.0:"
    # S10 二期损耗(二期园区损耗!J4/J5/H4);loss_adj_qty 正 = 多收(同 building:30 2024-02 +300 那行)
    log += [
        cfg(cur, "building:30", "loss_rate_manual", "2023-11", "month", "0.0146", b + "源册 2023-11 二期园区损耗!J4=0.0146"),
        cfg(cur, "building:30", "loss_rate_manual", "2023-12", "month", "0.0112", b + "源册 2023-12 二期园区损耗!J4=0.0112"),
        cfg(cur, "building:30", "loss_rate_manual", "2024-01", "month", "0.0178", b + "源册 2024-01 二期园区损耗!J4=0.0178"),
        cfg(cur, "building:32", "loss_rate_manual", "2023-12", "month", "0.0230", b + "源册 2023-12 二期园区损耗!J5=0.023(二三四车间)"),
        cfg(cur, "building:30", "loss_adj_qty", "2023-11", "month", "-1000", b + "源册 2023-11 H4=-1000,J4 用 (F4-H4):少收 1000"),
        cfg(cur, "building:30", "loss_adj_qty", "2023-12", "month", "1000", b + "源册 2023-12 H4=-1000,J4 用 (F4+H4):多收 1000"),
        cfg(cur, "building:30", "loss_adj_qty", "2024-01", "month", "500", b + "源册 2024-01 H4=-500,J4 用 (F4+H4):多收 500"),
    ]
    # M9 取整位(公共电数据 V 列 ROUND 位数);rule:9 七个月都是 2 = 无行
    log += [
        cfg(cur, "rule:13", "round_scale", "2023-08", "from", "2", b + "源册 V64/V65 2023-08~12 ROUND(…,2)"),
        cfg(cur, "rule:13", "round_scale", "2024-01", "from", "3", b + "源册 V65 2024-01 起 ROUND(…,3)"),
        cfg(cur, "rule:15", "round_scale", "2023-08", "from", "2", b + "源册 V76 2023-08/09 ROUND(L76/T76,2)"),
        cfg(cur, "rule:15", "round_scale", "2023-10", "from", "3", b + "源册 V76/V77 2023-10 起 ROUND(…,3)"),
        cfg(cur, "rule:21", "round_scale", "2023-08", "from", "2", b + "源册 V106 2023-08/09 ROUND(L106/T106,2)"),
        cfg(cur, "rule:21", "round_scale", "2023-10", "from", "3", b + "源册 V112/V113 2023-10 起 ROUND(…,3)"),
        # 09 月 V106=ROUND(676.38/148918.01,2)=0.00,而 V46 手输 +0.01:保留折入链时要补这 0.01(两种配法都要)
        cfg(cur, "rule:9", "std_add", "2023-09", "month", "0.01", b + "源册 2023-09 公共电数据!V46 末尾 +0.01"),
    ]
    if a.m9 == "source":
        log += m9_links_source(cur)
        log += [
            cfg(cur, "rule:9", "std_add", "2023-08", "month", "0.01", b + "源册 2023-08 公共电数据!V46 末尾 +0.01"),
            cfg(cur, "rule:13", "std_add", "2023-08", "month", "0.01", b + "源册 2023-08 公共电数据!V64 末尾 +0.01"),
            cfg(cur, "rule:13", "std_add", "2023-09", "month", "0.01", b + "源册 2023-09 公共电数据!V64 末尾 +0.01"),
        ]
    con.commit()
    con.close()
    print("\n".join(log))


if __name__ == "__main__":
    main()
