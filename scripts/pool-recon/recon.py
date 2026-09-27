# -*- coding: utf-8 -*-
"""recon.py — 一期/二期公共电核算对账:源册 xlsx ↔ 池核算引擎,逐月可反复跑。

    python scripts/pool-recon/recon.py mkdb                  # 从开发库 mysqldump 重建临时库 park_demo3_recon(约 4 分钟)
    python scripts/pool-recon/recon.py run 2024-02           # 抽期望值 → 补电价 → 跑引擎 → 出报告
    python scripts/pool-recon/recon.py run 2023-11 --import  # 同上,另先把该月抄表读数导进临时库
    python scripts/pool-recon/recon.py compare 2024-02       # 只重出报告(expected.json / engine.json 已在)
    python scripts/pool-recon/recon.py readings 2024-05      # 只有抄表页的月份:导读数 → generate → 核读数与池用量(不比金额)
    python scripts/pool-recon/book_report.py                 # 各月汇成 docs/research/pool-book-recon-2026-09-25.md

产物都在 scripts/pool-recon/out/<月>/:
  expected.json   源册期望值(extract.py;自检不过就停)       engine.json    引擎结果(PoolReconRunner)
  readings-*.json 前端解析出的导入请求体(--import)            import-result.json  importRows 返回的 errors/notices
  prices-filled.json 本次补进临时库的当月电价(没有就不写)       report.md / diff.csv  比对报告
out/recon-db.json 记着临时库是什么时候从哪灌的。

只写临时库:mkdb 对开发库只做 mysqldump(--single-transaction 读);runner 里有库名硬闸(库名不含 recon 就拒跑)。
导入会写 meter_assign 的当月段并影响其后各月,历史月请按时间顺序导;导乱了就 mkdb 重来。
"""
import argparse
import datetime
import json
import os
import subprocess
import sys
import tempfile
from decimal import Decimal

import pymysql

import compare
import extract

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
OUT = os.path.join(HERE, "out")
MYSQL_BIN = r"C:\Program Files\MySQL\MySQL Workbench 8.0 CE"
HOST, PORT, USER, PWD = "127.0.0.1", 13306, "root", "root"
DEV_DB, RECON_DB = "park_demo3", "park_demo3_recon"
MVNW = os.path.join(REPO, "backend", "mvnw.cmd")
POM = os.path.join(REPO, "backend", "pom.xml")
FRONTEND = os.path.join(REPO, "frontend")
VITE_NODE = os.path.join(FRONTEND, "node_modules", ".bin", "vite-node.cmd")
assert RECON_DB != DEV_DB and "recon" in RECON_DB


def db():
    return pymysql.connect(host=HOST, port=PORT, user=USER, password=PWD, database=RECON_DB, charset="utf8mb4")


def mysql_args(tool):
    return [os.path.join(MYSQL_BIN, tool), f"-h{HOST}", f"-P{PORT}", f"-u{USER}", f"-p{PWD}",
            "--default-character-set=utf8mb4"]


def counts(cur, schema):
    cur.execute(f"SELECT ym, COUNT(*) FROM `{schema}`.meter_reading GROUP BY ym ORDER BY ym")
    readings = dict(cur.fetchall())
    cur.execute("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=%s", (schema,))
    return {"tables": cur.fetchone()[0], "meterReadingByYm": readings}


def mkdb():
    fd, dump = tempfile.mkstemp(suffix=".sql", prefix="park_demo3_")
    os.close(fd)
    try:
        print(f"mysqldump {DEV_DB}(只读快照)…")
        with open(dump, "wb") as f:
            subprocess.run(mysql_args("mysqldump.exe") + ["--single-transaction", "--routines", "--triggers", DEV_DB],
                           stdout=f, check=True)
        con = pymysql.connect(host=HOST, port=PORT, user=USER, password=PWD, charset="utf8mb4")
        cur = con.cursor()
        cur.execute(f"DROP DATABASE IF EXISTS `{RECON_DB}`")
        cur.execute(f"CREATE DATABASE `{RECON_DB}` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci")
        print(f"灌入 {RECON_DB}(约 4 分钟)…")
        with open(dump, "rb") as f:
            subprocess.run(mysql_args("mysql.exe") + [RECON_DB], stdin=f, check=True)
        src, dst = counts(cur, DEV_DB), counts(cur, RECON_DB)
        con.close()
    finally:
        os.remove(dump)
    if src != dst:
        raise SystemExit(f"临时库与开发库不一致:{dst} vs {src}")
    info = {"builtAt": datetime.datetime.now().isoformat(timespec="seconds"),
            "from": f"{DEV_DB}@{HOST}:{PORT}", "to": RECON_DB, **dst}
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, "recon-db.json"), "w", encoding="utf-8") as f:
        json.dump(info, f, ensure_ascii=False, indent=1)
    print(f"OK {RECON_DB}: {dst['tables']} 张表,读数 {dst['meterReadingByYm']}")


def readings_status(ym):
    con = db()
    cur = con.cursor()
    cur.execute("""SELECT m.zone, m.kind, COUNT(*) FROM meter_reading r JOIN meter m ON m.id=r.meter_id
                   WHERE r.ym=%s AND m.zone IN ('p1','p2') GROUP BY m.zone, m.kind""", (ym,))
    st = {f"{z}/{k}": n for z, k, n in cur.fetchall()}
    con.close()
    return st


def parse_readings(ym, books, out_dir):
    """前端同一套解析(vite-node 跑 parse-readings.ts)→ 导入请求体(去掉 UI 用的 __preview)。
    books = {标签: 源册相对路径};一册里一期/二期段落都会解析出来,所以同一册只给一次。"""
    con = db()
    cur = con.cursor()
    cur.execute("SELECT id, company_name, aliases FROM tenant")
    tenants = [{"id": i, "companyName": n, "aliases": a} for i, n, a in cur.fetchall()]
    cur.execute("SELECT id, name FROM building")
    buildings = [{"id": i, "name": n} for i, n in cur.fetchall()]
    con.close()
    master = os.path.join(out_dir, "master.json")
    with open(master, "w", encoding="utf-8") as f:
        json.dump({"tenants": tenants, "buildings": buildings}, f, ensure_ascii=False)
    env = dict(os.environ, NODE_OPTIONS="--max-old-space-size=8192")
    files = []
    for zone, rel in books.items():
        xlsx = os.path.join(extract.SRC, rel)
        dst = os.path.join(out_dir, f"readings-{zone}.json")
        if os.path.exists(dst):
            os.remove(dst)
        r = subprocess.run([VITE_NODE, os.path.join(HERE, "parse-readings.ts"), xlsx, master, ym, dst],
                           cwd=FRONTEND, env=env, capture_output=True, text=True, encoding="utf-8")
        print(f"  解析 {os.path.basename(xlsx)}: {r.stdout.strip().splitlines()[-1] if r.stdout.strip() else ''}")
        if r.returncode != 0 or not os.path.exists(dst):
            raise SystemExit(f"解析失败 {xlsx}\n{r.stderr[-2000:]}")
        with open(dst, encoding="utf-8") as f:
            body = json.load(f)
        if not body["rows"]:
            raise SystemExit(f"解析出 0 行:{xlsx}")
        files.append(dst)
    return files


def manual_rows(ym, exp):
    """导入后仍缺读数的一期池表:抄表页没这块表(C2 消防/走廊类读数来自断掉的外链),只能取「公共电分摊明细」I/N。
    这不是产品解析出来的数 —— 只补「库里已有这块表、池只绑这一块、分摊页这一行 I/N 都有数」的,用库里的表名让后端按名认表,
    补了哪些进 import-result.json 与报告。"""
    by_key = {p["key"]: p for p in exp["pools"] if p["zone"] == "p1" and p.get("key")}
    con = db()
    cur = con.cursor()
    cur.execute("""SELECT r.book_key, m.name, m.id FROM alloc_rule r
                   JOIN alloc_rule_meter rm ON rm.rule_id = r.id AND rm.sign = 1 JOIN meter m ON m.id = rm.meter_id
                   WHERE r.zone = 'p1' AND r.book_key IS NOT NULL
                     AND (SELECT COUNT(*) FROM alloc_rule_meter x WHERE x.rule_id = r.id) = 1
                     AND NOT EXISTS (SELECT 1 FROM meter_reading mr WHERE mr.meter_id = m.id AND mr.ym = %s)""", (ym,))
    rev = {v: k for (z, k), v in compare.KEY_ALIASES.get(ym, {}).items() if z == "p1"}   # 引擎键 → 该月源册键
    rows = []
    for book_key, name, _mid in cur.fetchall():
        p = by_key.get(book_key) or by_key.get(rev.get(book_key))
        ms = (p or {}).get("meters") or []
        if len(ms) == 1 and ms[0].get("prev") is not None and ms[0].get("curr") is not None:
            m = ms[0]
            rows.append({"kind": "elec", "zone": "p1", "name": name, "ym": ym,
                         "prevTotal": float(Decimal(m["prev"])), "currTotal": float(Decimal(m["curr"])),
                         "factor": float(Decimal(m["factor"])) if m.get("factor") else None,
                         "note": f"对账工具补录:抄表页无此表,取公共电分摊明细 r{m['row']} I/N"})
    con.close()
    return rows


def fill_prices(ym, exp, out_dir):
    """priceGate 要当月电价;缺的按源册单价 − 维护费补进临时库(mode=month),补了什么记进 prices-filled.json。"""
    con = db()
    cur = con.cursor()

    def resolve(key):
        cur.execute("""SELECT cfg_value FROM tenant_price_cfg WHERE scope='' AND cfg_key=%s AND
                       ((mode='month' AND acct_month=%s) OR (mode='from' AND acct_month<=%s))
                       ORDER BY mode='month' DESC, acct_month DESC LIMIT 1""", (key, ym, ym))
        row = cur.fetchone()
        return None if row is None else Decimal(str(row[0]))
    want = {}
    if exp["prices"].get("p1Unit"):
        want["elec_commercial"] = Decimal(exp["prices"]["p1Unit"]) - resolve("mgmt_fee_commercial")
    for seg, v in exp["prices"].get("p2Seg", {}).items():
        want[f"elec_{seg}"] = Decimal(v) - resolve("mgmt_fee")
    filled = []
    for key, val in want.items():
        have = resolve(key)
        if have is not None:
            if abs(have - val) > Decimal("0.000001"):
                print(f"  注意:库里 {key}@{ym}={have},源册推得 {val}(不改库,差异会体现在应分摊)")
            continue
        cur.execute("""INSERT INTO tenant_price_cfg (scope, cfg_key, acct_month, mode, cfg_value, note)
                       VALUES ('', %s, %s, 'month', %s, %s)""",
                    (key, ym, val, "对账工具补录:源册单价−维护费"))
        filled.append({"key": key, "ym": ym, "value": str(val)})
    con.commit()
    if filled:
        print(f"  补电价 {filled}")
    # 记录以库为准:本次或之前几次补进临时库的都算(重建临时库后自然清空)
    cur.execute("""SELECT cfg_key, cfg_value FROM tenant_price_cfg WHERE acct_month=%s AND note LIKE '对账工具补录%%'""", (ym,))
    in_db = [{"key": k, "ym": ym, "value": format(Decimal(str(v)).normalize(), "f")} for k, v in cur.fetchall()]
    con.close()
    path = os.path.join(out_dir, "prices-filled.json")
    if in_db:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(in_db, f, ensure_ascii=False, indent=1)
    elif os.path.exists(path):
        os.remove(path)
    return filled


def run_engine(ym, out_dir, imports):
    engine = os.path.join(out_dir, "engine.json")
    if os.path.exists(engine):
        os.remove(engine)
    cmd = (f'"{MVNW}" -q -f "{POM}" test "-Dtest=PoolReconRunner" "-Drecon.ym={ym}" "-Drecon.out={out_dir}"'
           + (f' "-Drecon.import={";".join(imports)}"' if imports else ""))
    log = os.path.join(out_dir, "runner.log")
    print(f"  引擎(PoolReconRunner,约 1 分钟)… 日志 {log}")
    with open(log, "w", encoding="utf-8", errors="replace") as f:
        subprocess.run(cmd, shell=True, stdout=f, stderr=subprocess.STDOUT, cwd=os.path.join(REPO, "backend"))
    # 判绿看产物,不看退出码
    if not os.path.exists(engine):
        with open(log, encoding="utf-8", errors="replace") as f:
            tail = f.read()[-3000:]
        raise SystemExit(f"引擎没出 engine.json,见 {log}\n{tail}")
    with open(engine, encoding="utf-8") as f:
        doc = json.load(f)
    print(f"  引擎: 池 {len(doc['pools']['rows'])} 行 / 户级贡献 {len(doc['contributions'])} 条 / 提示 "
          f"{len(doc['generate']['warnings'])} 条")


def run(ym, do_import):
    out_dir = os.path.join(OUT, ym)
    os.makedirs(out_dir, exist_ok=True)
    print(f"[{ym}] 抽期望值…")
    exp = extract.extract(ym)
    with open(os.path.join(out_dir, "expected.json"), "w", encoding="utf-8") as f:
        json.dump(exp, f, ensure_ascii=False, indent=1)
    sc = exp["selfcheck"]
    print(f"  自检 通过 {len(sc['passed'])} 项,失败 {len(sc['errors'])} 项")
    if not sc["ok"]:
        raise SystemExit("抽取自检失败,不往下跑:\n  " + "\n  ".join(sc["errors"]))
    books = {z: extract.MONTHS[ym][z] for z in ("p1", "p2")}
    imports = parse_readings(ym, books, out_dir) if do_import else []
    st = readings_status(ym)
    if not do_import and not (st.get("p1/elec") and st.get("p2/elec")):
        print(f"  注意:临时库 {ym} 读数 {st},一期/二期电有缺;要补读数加 --import")
    fill_prices(ym, exp, out_dir)
    run_engine(ym, out_dir, imports)
    if imports:
        log_path = os.path.join(out_dir, "import-result.json")
        with open(log_path, encoding="utf-8") as f:
            log = json.load(f)
        manual = manual_rows(ym, exp)
        if manual:
            dst = os.path.join(out_dir, "readings-manual.json")
            with open(dst, "w", encoding="utf-8") as f:
                json.dump({"rows": manual, "fileName": f"对账工具补录-{ym}(公共电分摊明细 I/N)"}, f, ensure_ascii=False)
            print(f"  补录 {len(manual)} 块抄表页没有的池表:{'、'.join(x['name'] for x in manual)},重跑引擎")
            run_engine(ym, out_dir, [dst])
            with open(log_path, encoding="utf-8") as f:
                log += json.load(f)
            with open(log_path, "w", encoding="utf-8") as f:
                json.dump(log, f, ensure_ascii=False, indent=1)
        print(f"  导入后读数 {readings_status(ym)}")
    diffs, unmatched = compare.compare(ym)
    print(f"  报告 → {os.path.join(out_dir, 'report.md')}(差 {len(diffs)} 条,池对不上 {len(unmatched)})")


def placeholder_prices(ym, out_dir):
    """只核读数的月份没有源册单价;priceGate 要当月电价,抄库里最近一个月的月价占位(金额不比,报告里写明)。"""
    con = db()
    cur = con.cursor()
    filled = []
    for key in ("elec_commercial", "elec_sharp", "elec_peak", "elec_flat", "elec_valley"):
        cur.execute("SELECT 1 FROM tenant_price_cfg WHERE scope='' AND cfg_key=%s AND mode='month' AND acct_month=%s",
                    (key, ym))
        if cur.fetchone():
            continue
        cur.execute("""SELECT acct_month, cfg_value FROM tenant_price_cfg WHERE scope='' AND cfg_key=%s AND mode='month'
                       AND acct_month < %s ORDER BY acct_month DESC LIMIT 1""", (key, ym))
        src, val = cur.fetchone()
        cur.execute("""INSERT INTO tenant_price_cfg (scope, cfg_key, acct_month, mode, cfg_value, note)
                       VALUES ('', %s, %s, 'month', %s, %s)""",
                    (key, ym, val, f"对账工具补录:占位,抄 {src} 月价(只核读数用量,金额不比)"))
        filled.append({"key": key, "ym": ym, "value": format(Decimal(str(val)).normalize(), "f"), "from": src})
    con.commit()
    con.close()
    if filled:
        with open(os.path.join(out_dir, "prices-filled.json"), "w", encoding="utf-8") as f:
            json.dump(filled, f, ensure_ascii=False, indent=1)


def readings(ym):
    """只有抄表页的月份:源册逐行复算 → 前端同一套解析 + importRows 导进临时库 → 占位电价 → generate → 逐表/逐池比用量。"""
    rel = extract.READINGS_ONLY[ym]
    out_dir = os.path.join(OUT, ym)
    os.makedirs(out_dir, exist_ok=True)
    bk = extract.Book(rel)
    sheet = {"file": bk.meta(), "p1": extract.park_rows(bk, r"^一期园区电$"), "p2": extract.park_rows(bk, r"^二期园区电$")}
    g = bk.grid(r"^二期园区电$")
    sheet["p2SharpRatio"] = extract.num(g.val(4, 28)) if g.text(3, 28) == "比率" else None
    with open(os.path.join(out_dir, "sheet.json"), "w", encoding="utf-8") as f:
        json.dump(sheet, f, ensure_ascii=False, indent=1)
    print(f"[{ym}] 抄表页 一期 {len(sheet['p1'])} 行 / 二期 {len(sheet['p2'])} 行")
    imports = parse_readings(ym, {"all": rel}, out_dir)
    placeholder_prices(ym, out_dir)
    run_engine(ym, out_dir, imports)
    print(f"  导入后读数 {readings_status(ym)}")
    n = compare.readings_report(ym)
    print(f"  报告 → {os.path.join(out_dir, 'report.md')}({n})")


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("mkdb")
    r = sub.add_parser("run")
    r.add_argument("ym", choices=sorted(extract.MONTHS))
    r.add_argument("--import", dest="do_import", action="store_true", help="先把该月抄表读数导进临时库")
    c = sub.add_parser("compare")
    c.add_argument("ym")
    sub.add_parser("summary", help="跨月汇总 out/*/diff.csv → out/summary.md")
    rd = sub.add_parser("readings", help="只有抄表页的月份:核对公共表读数与用量(导入临时库,按时间顺序)")
    rd.add_argument("ym", choices=sorted(extract.READINGS_ONLY))
    a = ap.parse_args()
    if a.cmd == "mkdb":
        mkdb()
    elif a.cmd == "readings":
        readings(a.ym)
    elif a.cmd == "run":
        run(a.ym, a.do_import)
    elif a.cmd == "summary":
        months, rows = compare.summary()
        print(f"{len(months)} 个月 {months},{len(rows)} 格有差 → {os.path.join(OUT, 'summary.md')}")
    else:
        diffs, unmatched = compare.compare(a.ym)
        print(f"差 {len(diffs)} 条,池对不上 {len(unmatched)} → {os.path.join(OUT, a.ym, 'report.md')}")


if __name__ == "__main__":
    main()
