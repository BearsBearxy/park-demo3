# -*- coding: utf-8 -*-
"""derive_pool_location.py — 池位置推导与改名迁移(任务B,2026-07-30 拍板池模型)。

把 90 个 alloc_rule 从「账册手写名」(28+ 个池名嵌租户名)迁成「楼栋+楼层+侧向+费项」四级定位:
  - 楼栋: 绑定表 meter.building_id 众数(与 rule.building_id 不一致要报告)
  - 楼层/侧向: 解析 meter.spot(四楼西侧→四楼/西侧;负一层→负一层/None;总电表→整栋 floor=None;
                              天面→floor='天面',V72 起照实写,整栋语义由 floorNum('天面')=null 兜)
    侧向兜底: spot 无侧向时看 meter.name/tenant_name 的 东侧/西侧,全体一致才取
  - 费项名: meter.tenant_name(share 表的用途字段)→meter.name→rule.name 归一成短名
  - 园区级(base_key=area_base/lamp_area_base 或 park_loss_pool 或 充电桩) → buildingId=None,
    池名前缀取 zone(一期园区/二期园区/宿舍区);广告字灯例外(物理在车间,只是折入园区池)
  - 无绑定表 + 无账册依据的池 → 置信度=低,只进对照表不进 SQL(不硬猜)

输出(只写文件,不改库):
  scripts/pool-rename-2026-07-30.tsv                            对照表
  backend/src/main/resources/db/migration/V70__pool_rename.sql   幂等迁移(依赖 V69 的
                                                                 floor_label/side/fee_name
                                                                 与 alloc_rule_member.acct_month)

用法: python scripts/derive_pool_location.py            生成两个文件 + 摘要
      python scripts/derive_pool_location.py --selftest 解析器与冲突消歧自检
"""
import io
import os
import re
import sys
from collections import Counter, defaultdict

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
HERE = os.path.dirname(os.path.abspath(__file__))
TSV = os.path.join(HERE, "pool-rename-2026-07-30.tsv")
SQL = os.path.join(HERE, "..", "backend", "src", "main", "resources",
                   "db", "migration", "V70__pool_rename.sql")
DB = dict(host="127.0.0.1", port=13306, user="root", password="root",
          database="park_demo3", charset="utf8mb4")
ZONE_PREFIX = {"p1": "一期园区", "p2": "二期园区", "dorm": "宿舍区"}
AREA_BASES = ("area_base", "lamp_area_base")  # 园区/期级面积基数(148918.01/80000/15510)

# ── 费项归一:关键词按序命中,取第一条 ────────────────────────────────────────
FEE_RULES = [
    ("消防水稳压泵", "消防水稳压泵"), ("生活水泵", "消防设施"), ("消防控制室", "消防设施"),
    ("广告字", "广告字灯"), ("装饰灯", "广告字灯"),  # 『广告字灯（消防分表）』须先于『消防』命中
    ("消防控制箱", "消防"), ("楼梯间", "楼梯间"), ("走廊灯", "走廊灯"), ("走廊", "走廊灯"),
    ("应急灯", "应急灯"), ("消防灯", "应急灯"), ("消防", "消防"),
    ("电梯+低压电房照明", "电梯+低压电房照明"), ("低压电房", "电梯+低压电房照明"),
    ("货梯", "货梯"), ("客梯", "客梯"), ("电梯", "电梯"),
    ("绿化水泵", "绿化水泵"), ("绿化水", "绿化水"), ("路灯", "路灯"),
    ("车库", "车库照明"), ("大堂", "大堂"), ("生活加压泵", "生活加压泵"),
    ("充电桩", "充电桩、保安亭"), ("空调外机", "空调外机"), ("公共用电", "公共用电"),
]
# 走 fee_key/rule 特判(账册语义,推不出来)
FEE_BY_RULE = {
    12: ("电梯加价档", "中", "广联/氙明/威玛斯按全层价+100元的标准行(旧名含租户名);费项名待人工确认"),
    17: ("广告字灯（火炬园）", "中", "五车间电梯分表,度数从平段冲减后单独向火炬园收取;与池15同栋须区分"),
    23: ("净电", "中", "招商中心总表-子表-670度自用,整栋净额"),
    24: ("公共电（园区损耗池）", "中", "一期园区公共5表Σ/6 平摊进 A-F 座损耗率"),
}
# 账册依据的定位补录(DB 无绑定表或 spot 缺失)
LOC_OVERRIDE = {
    61: ("一楼", "东侧", "中", "账册一期行63:范围『宇劲/邱彩云D101、叶子涛D103』→首层;侧向取旧名『东侧』"),
    91: (None, None, "中", "无电表,手输84吨×4.45÷15510㎡ → 宿舍区级"),
}
NO_METER_MANUAL = {  # 无绑定表且账册未给楼层/侧向 → 低,不进 SQL
    41: "账册一期 B 座首层户对户池(行33/34 之一),侧向无依据",
    42: "账册一期 B 座首层户对户池(行33/34 之一),侧向无依据",
    51: "账册一期 C 座首层户对户池(行46),侧向无依据",
}

# ── 受益人首批:账册「分摊规则」段逐池名单。weight=None 表示整份/层内按面积二拆 ──
# 车间池走 by_building 自动带出(已与账册 X 列行数逐栋核对:15/5/9/6/10/11 全等)
MEMBERS_DOC = {
    28: (["成吉", "合源创盈", "宏玥", "暨南中院", "羊城科技"], "高",
         "账册A2西侧公共 AA15=1734.73=五户面积和,已逐户核实"),
    29: (["仁恒", "采妍", "林春艳", "双成", "林观平", "刘亚辉（耐特研磨）", "建奕"], "中",
         "账册A3西侧公共 范围列7户;AA16=2293.34 只含前6户面积(建奕超基数收取)"),
    32: (["精锐佳", "重瞳", "炳记运输", "林观平"], "低",
         "账册A4东侧公共 名单4户,但 zh 表实收6户(精锐佳/炳记/帷幄/幸悦/重瞳/林观平445)三者不一致"),
    33: (["粤海华创", "优唯特", "金准智能", "布司曼", "MWILLAMA"], "低",
         "账册A4西侧 名单5户面积和575.59≠AA20=734.02;zh 实收8户(另含黄路生/沈振/周应佳)"),
    34: (["粤海华创", "优唯特", "金准智能", "布司曼", "MWILLAMA"], "低",
         "同 A4 西侧走廊灯(双表同池,行20/21 共基数)"),
    37: (["新材料协会", "次生代", "宏玥", "碳紫", "高建军"], "中",
         "账册A6东侧 AA24=1417.26=五户面积和已核实;zh 另对林观平620(95.43㎡)收取"),
    38: (["新材料协会", "次生代", "宏玥", "碳紫", "高建军"], "中",
         "同 A6 东侧走廊灯(双表同池,行24/25 共基数)"),
    8:  (["嘉荣", "艾派斯"], "高", "账册三车间电梯 S40『三车间企业(嘉荣、艾派斯)』T40=4层仅两户承担"),
    12: (["广联", "氙明", "威玛斯"], "高", "账册V64 三户引全层价+100元"),
    49: ([("杨文正", 0.5), ("张彦", 0.5), ("可莱恩", 1), ("雷莱", 1), ("碧沃丰", 1)], "高",
         "账册B座楼梯间 分摊系数4=首层两户各0.5份+2F/3F/4F各1份"),
    50: (["可莱恩", "雷莱", "碧沃丰"], "高", "账册B座货梯 系数3=2F/3F/4F各一整份(首层不摊)"),
    69: (["汤周杰", "金纳", "飞度"], "高", "账册D座货梯 2F/3F各摊两梯,4F飞度只收东梯"),
    70: (["汤周杰", "金纳", "一元兰欣"], "高", "账册D座货梯 4F一元兰欣只收西梯"),
    77: ([("信成洋", 0.5), ("碳紫", 1), ("天玛", 1), ("张文意", 1), ("翔海", 1)], "中",
         "账册E座楼梯间 信成洋半份;翔海走 zh 下段专表并入户内用量"),
    78: (["张文意", "翔海"], "中", "账册E座东侧货梯 张文意整份;翔海走专表"),
    79: (["天玛", "翔海"], "中", "账册E座西侧货梯 天玛整份;翔海走专表"),
    87: (["思汗", "桑尼号", "曾绍良"], "中",
         "账册F座楼梯间 4户各整份,第4户『张执盛』租户档缺失(F401 现为博浩)待补"),
    84: (["桑尼号"], "中", "账册 zh F79『已合计三楼的公摊』:F201+F301 东西四表同归桑尼号"),
    17: (["火炬创新创业园"], "中", "账册X89『收取火炬园，五车间电梯表冲减』,P70=670.06度单独向火炬园收"),
}
MEMBERS_NONE = {  # 按账册本就无受益人(纯折入/挂亏),不算待人工
    23: "无受益人:总表净额经 fold_qty 折入一期园区公摊池,不直接向租户收",
    19: "无受益人:S101『不分摊』,成本全额挂亏(Y101=-1717.05)",
    15: "无受益人:单价档0.005叠进园区消防设施V46,不直接向户收",
    21: "无受益人:同上(六车间广告字→V46)",
}
MEMBERS_MANUAL = {  # 账册范围存在但拆不出确定名单 → 报告待人工勾
    40: "A座四梯合并÷12487.04『A座计费面积』,与在租面积17424.19不符;孵化器户走固定额,需人工勾全A座在租户",
    53: "账册C2消防 范围列9户(顺心鸿…优硕达),AA=1503.10 只含8户面积,doc 未逐户列名",
    54: "同 C2 走廊(双表同池)",
    58: "C座楼梯间4份:1F高建军+杨道扬/卢志华/诺玲(两套面积基数2562/2322)+2F九户+3F各半+4F可莱恩半份",
    59: "C座东侧货梯:2楼各户按面积+3F陈相钊整份",
    60: "C座西侧货梯:2楼各户按面积+3F邹同稳整份+4F可莱恩C402整份",
    68: "D座楼梯间实收5份>分母4;『宇劲』『邱彩云』租户档缺失(D101 现为胡广清)",
    88: "F座东侧货梯:思汗/桑尼号/曾绍良/张执盛组合收取,doc 未拆到户",
    89: "F座西侧货梯(+200度全在西梯):同上未拆到户",
    30: "中大4楼公共『已停用』,受益人存疑",
    56: "账册行54『道磁C401空租,AE54=0手输』,租户档无『道磁』",
    61: "账册行63 受益人=宇劲/邱彩云D101/叶子涛D103,前两者租户档缺失(D101 现为胡广清)",
    85: "账册行91-92 受益人=张执盛,租户档缺失(F401 现为博浩);zh F82 是唯一引 AD 列而非 AC 列的下游公式",
    86: "同池85(F401 西侧表)",
    31: "4楼空调外机电『已停用』,zh G17 曾按 AC18×7 用作双成空调风机费",
}
WORKSHOP_MEMBER_RULES = {2: 30, 3: 30, 5: 31, 6: 31, 7: 32, 10: 33, 11: 33,
                         14: 34, 16: 34, 20: 35, 22: 35}
# 账册归属切割:方凯鑫(五车间6F)的消防已分摊记在六车间(X71 剔 S44、X107 加 S44)
WORKSHOP_FIX = {14: ("-", "方凯鑫"), 20: ("+", "方凯鑫")}
PARK_AUTO = "园区/期级池,受益人=该期(宿舍区)在租租户自动带出(拍板#5),不落库"

FLOOR_RE = re.compile(r"(负?[一二三四五六七八九十0-9]+(?:楼|层))")
SIDE_RE = re.compile(r"([东西南北]侧)")


def parse_spot(spot):
    """spot → (floor, side)。天面/无楼层token → floor=None(整栋)。"""
    if not spot:
        return None, None
    f = FLOOR_RE.search(spot)
    s = SIDE_RE.search(spot)
    return (f.group(1) if f else None), (s.group(1) if s else None)


def mode(values):
    """非空值众数;返回 (值, 是否存在分歧)。"""
    vs = [v for v in values if v]
    if not vs:
        return None, False
    c = Counter(vs)
    return c.most_common(1)[0][0], len(c) > 1


def fee_of(text):
    for kw, short in FEE_RULES:
        if kw in text:
            return short
    return None


def gen_name(zone, bname, floor, side, fee):
    head = bname or ZONE_PREFIX[zone]
    mid = (floor or "") + (side or "")
    return "·".join(p for p in (head, mid, fee) if p)


def worst(*levels):
    for lv in ("低", "中", "高"):
        if lv in levels:
            return lv
    return "高"


def fetch():
    import pymysql
    conn = pymysql.connect(**DB)
    cur = conn.cursor(pymysql.cursors.DictCursor)
    cur.execute("SELECT id,name FROM building")
    buildings = {r["id"]: r["name"] for r in cur.fetchall()}
    cur.execute("SELECT id,zone,name,building_id,method,fee_key,base_key,sort_no,note "
                "FROM alloc_rule ORDER BY id")
    rules = cur.fetchall()
    cur.execute("SELECT rm.rule_id,rm.sign,m.id mid,m.name m_name,m.area,m.spot,"
                "m.sub_name,m.meter_type,m.building_id m_bld,m.tenant_name "
                "FROM alloc_rule_meter rm JOIN meter m ON m.id=rm.meter_id ORDER BY rm.rule_id,m.id")
    metas = defaultdict(list)
    for r in cur.fetchall():
        metas[r["rule_id"]].append(r)
    cur.execute("SELECT id,company_name FROM tenant")
    tenants = {r["id"]: r["company_name"] for r in cur.fetchall()}
    cur.execute("SELECT building_id,tenant_id FROM contract WHERE status IN ('active','renewed')")
    by_bld = defaultdict(set)
    for r in cur.fetchall():
        by_bld[r["building_id"]].add(r["tenant_id"])
    conn.close()
    return buildings, rules, metas, tenants, by_bld


def resolve(name, tenants):
    """租户名→id:先精确,再唯一包含匹配;失败返回 None。"""
    hits = [i for i, n in tenants.items() if n == name]
    if len(hits) == 1:
        return hits[0]
    hits = [i for i, n in tenants.items() if name in n]
    return hits[0] if len(hits) == 1 else None


def derive(rule, meters, buildings):
    """→ dict(bld, floor, side, fee, conf, why, warns)"""
    pos = [m for m in meters if m["sign"] > 0] or meters
    warns = []
    bld, mix_b = mode([m["m_bld"] for m in pos])
    if mix_b:
        warns.append("绑定表跨楼栋(取众数)")
    spots = [parse_spot(m["spot"]) for m in pos]
    floor, mix_f = mode([f for f, _ in spots])
    side, mix_s = mode([s for _, s in spots])
    if mix_f:
        warns.append("绑定表 spot 楼层不一致(取众数)")
    if side is None:  # 侧向兜底:表名/用途里的东西侧,全体一致才认
        cand = {SIDE_RE.search(t).group(1) for m in pos
                for t in [(m["m_name"] or "") + (m["tenant_name"] or "")]
                if SIDE_RE.search(t)}
        side = cand.pop() if len(cand) == 1 else None
    if any((m["meter_type"] or "") == "总电表" for m in pos):
        floor = None  # 总表池=整栋
    if any("天面" in (m["spot"] or "") for m in pos):
        # V72:天面是真楼层,照实写(原册每栋都有天面段)。「跨层」语义不靠 None 表达 ——
        # AllocService.floorNum('天面')=null,受益人候选与房号解析仍走整栋分支。
        floor = "天面"
    conf = "高" if pos else "低"

    fee = conf_fee = why_fee = None
    if rule["id"] in FEE_BY_RULE:
        fee, conf_fee, why_fee = FEE_BY_RULE[rule["id"]]
    else:
        fees = {f for m in pos for f in [fee_of((m["tenant_name"] or "") + "|" +
                                                (m["m_name"] or ""))] if f}
        if len(fees) == 1:
            fee = fees.pop()
        elif len(fees) > 1:  # 多表混用途(A座四梯/楼梯间东西表)→ 归上位词
            fee = ("电梯" if fees <= {"货梯", "客梯", "电梯"}
                   else fee_of(rule["name"]) or sorted(fees)[0])
            warns.append("绑定表用途混合(%s)→取上位词" % "/".join(sorted(fees)))
        if fee is None:
            fee = fee_of(rule["name"]) or "公共用电"
            conf_fee = "中"
            warns.append("费项名取自旧池名")
    if conf_fee:
        conf = worst(conf, conf_fee)
    if why_fee:
        warns.append(why_fee)

    # 园区级:面积基数=园区/期总面积,或损耗池,或充电桩(不分摊设施);广告字灯物理在车间,不上提
    park = (rule["fee_key"] == "park_loss_pool"
            or (rule["base_key"] in AREA_BASES and not fee.startswith("广告字灯"))
            or fee.startswith("充电桩"))
    if park:
        if rule["building_id"] is not None:
            warns.append("园区级池但 rule.building_id=%s(%s)已置空"
                         % (rule["building_id"], buildings.get(rule["building_id"], "?")))
        bld, floor, side = None, None, None
    else:
        if bld is None:
            bld = rule["building_id"]
        elif rule["building_id"] not in (None, bld):
            warns.append("rule.building_id=%s 与绑定表众数=%s 不一致(取绑定表)"
                         % (rule["building_id"], bld))
    if rule["id"] in LOC_OVERRIDE:
        f2, s2, c2, why = LOC_OVERRIDE[rule["id"]]
        floor, side, conf = f2 or floor, s2 or side, c2  # 账册补录即证据,覆盖无表的低置信
        warns.append(why)
    if rule["id"] in NO_METER_MANUAL:
        conf = "低"
        warns.append(NO_METER_MANUAL[rule["id"]])
    return dict(bld=bld, floor=floor, side=side, fee=fee, conf=conf, warns=warns, park=park)


def members_for(rule_id, bld, park, tenants, by_bld):
    """→ (rows[(tid,weight)], conf, why) 或 None(待人工/自动带出)"""
    if rule_id in MEMBERS_NONE:
        return None, None, MEMBERS_NONE[rule_id]
    if park:
        return None, None, PARK_AUTO
    if rule_id in MEMBERS_DOC:
        spec, conf, why = MEMBERS_DOC[rule_id]
        rows, miss = [], []
        for item in spec:
            nm, w = item if isinstance(item, tuple) else (item, None)
            tid = resolve(nm, tenants)
            (rows.append((tid, w)) if tid else miss.append(nm))
        if miss:
            why += " ⚠租户档未匹配:" + "/".join(miss)
            conf = worst(conf, "中")
        return rows, conf, why
    if rule_id in WORKSHOP_MEMBER_RULES:
        b = WORKSHOP_MEMBER_RULES[rule_id]
        tids = set(by_bld.get(b, ()))
        why = "该车间在租租户自动带出(合同 building_id=%d,%d 户;与账册已分摊列行数核对一致)" % (b, len(tids))
        if rule_id in WORKSHOP_FIX:
            op, nm = WORKSHOP_FIX[rule_id]
            tid = resolve(nm, tenants)
            if tid:
                tids.discard(tid) if op == "-" else tids.add(tid)
                why += ";账册归属切割:%s%s" % (op, nm)
        return [(t, None) for t in sorted(tids)], "中", why
    if rule_id in MEMBERS_MANUAL:
        return None, None, "待人工:" + MEMBERS_MANUAL[rule_id]
    return "single", None, None  # 单户池,由调用方按表用途/旧名解析


def single_member(rule, meters, tenants):
    """户对户池:受益人取 meter.tenant_name 的『公共用电/XXX』后缀,兜底旧池名。"""
    for m in meters:
        tn = m["tenant_name"] or ""
        if "/" in tn:
            nm = re.split(r"[/、]", tn)[-1].replace("停用", "").strip()
            tid = resolve(nm, tenants) if nm else None
            if tid:
                return [(tid, None)], "高", "绑定表用途字段『%s』" % tn
    for tid, nm in sorted(tenants.items(), key=lambda kv: -len(kv[1])):
        if len(nm) >= 2 and nm in rule["name"]:
            return [(tid, None)], "中", "旧池名含租户名『%s』(无表用途依据)" % nm
    return None, None, "待人工:旧名/表用途均解析不出租户(旧名=%s)" % rule["name"]


def main():
    buildings, rules, metas, tenants, by_bld = fetch()
    tnames = sorted([n for n in tenants.values() if len(n) >= 2], key=len, reverse=True)
    out, name_owner, conflicts = [], {}, []
    for r in rules:
        ms = metas.get(r["id"], [])
        d = derive(r, ms, buildings)
        bname = buildings.get(d["bld"]) if d["bld"] else None
        nm = gen_name(r["zone"], bname, d["floor"], d["side"], d["fee"])
        if d["conf"] != "低":
            if nm in name_owner:  # 同名冲突:不静默覆盖,费项名后加序号并报告
                base, i = nm, 2
                while nm in name_owner:
                    nm = "%s%s" % (base, "②③④⑤"[i - 2]); i += 1
                conflicts.append((base, name_owner[base], r["id"], nm))
            name_owner[nm] = r["id"]
        has_t = [t for t in tnames if t in r["name"]]
        rows, mconf, mwhy = members_for(r["id"], d["bld"], d["park"], tenants, by_bld)
        if rows == "single":
            rows, mconf, mwhy = single_member(r, ms, tenants)
        why = ";".join([m["spot"] or m["m_name"] or "-" for m in ms][:4]) or "无绑定表"
        out.append(dict(r=r, d=d, name=nm if d["conf"] != "低" else "",
                        bname=bname or ZONE_PREFIX[r["zone"]] + "(楼栋置空)",
                        why=why, has_t=has_t, rows=rows, mconf=mconf, mwhy=mwhy))
    write_tsv(out)
    write_sql(out, conflicts)
    report(out, conflicts)


def write_tsv(out):
    with io.open(TSV, "w", encoding="utf-8-sig", newline="") as f:
        f.write("\t".join(["池ID", "旧名", "新楼栋", "新楼层", "新侧向", "新费项", "新池名",
                           "依据(绑定表spot原文)", "置信度", "含租户名", "备注",
                           "受益人置信度", "受益人依据", "受益人"]) + "\n")
        for o in out:
            r, d = o["r"], o["d"]
            f.write("\t".join([
                str(r["id"]), r["name"], o["bname"], d["floor"] or "", d["side"] or "", d["fee"],
                o["name"] or "【待人工】", o["why"], d["conf"],
                "/".join(o["has_t"]), ";".join(d["warns"]),
                o["mconf"] or "", o["mwhy"] or "",
                str(len(o["rows"])) + "户" if o["rows"] else "",
            ]) + "\n")


def write_sql(out, conflicts):
    L = ["-- V70__pool_rename.sql — 池位置化改名 + 受益人首批(任务B,scripts/derive_pool_location.py 生成)。",
         "-- 依赖 V69:alloc_rule.floor_label/side/fee_name 与 alloc_rule_member.acct_month。",
         "-- 幂等:UPDATE 按主键;INSERT 走 ON DUPLICATE KEY。低置信度池不改(见 scripts/pool-rename-2026-07-30.tsv)。",
         ""]
    if conflicts:
        L += ["-- ⚠同名冲突已加区分后缀(勿静默覆盖):"] + \
             ["--   %s ← 池%s / 池%s(后者改为 %s)" % (b, a, c, n) for b, a, c, n in conflicts] + [""]
    L.append("-- ── 定位回填 + 池名重生成 ──")
    for o in out:
        r, d = o["r"], o["d"]
        if not o["name"]:
            L.append("-- 池%-3s 待人工(%s):%s" % (r["id"], d["conf"], r["name"]))
            continue
        L.append("UPDATE alloc_rule SET building_id=%s, floor_label=%s, side=%s, fee_name=%s, "
                 "name=%s WHERE id=%d;  -- 旧名:%s"
                 % (d["bld"] if d["bld"] else "NULL", q(d["floor"]), q(d["side"]),
                    q(d["fee"]), q(o["name"]), r["id"], r["name"]))
    L += ["", "-- ── 受益人首批(acct_month=''=默认长期行) ──"]
    for o in out:
        r = o["r"]
        if not o["rows"]:
            L.append("-- 池%-3s %s → %s" % (r["id"], r["name"], o["mwhy"]))
            continue
        L.append("-- 池%-3s %s → %s(%s)" % (r["id"], r["name"], o["mwhy"], o["mconf"]))
        vals = ",".join("(%d,%d,%s,'')" % (r["id"], t, "NULL" if w is None else w)
                        for t, w in o["rows"])
        L.append("INSERT INTO alloc_rule_member (rule_id,tenant_id,weight,acct_month) VALUES %s"
                 "\n  ON DUPLICATE KEY UPDATE weight=VALUES(weight);" % vals)
    with io.open(SQL, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(L) + "\n")


def q(v):
    return "NULL" if v is None else "'%s'" % v.replace("'", "''")


def report(out, conflicts):
    tot = len(out)
    conf = Counter(o["d"]["conf"] for o in out)
    with_t = [o for o in out if o["has_t"]]
    mem = [o for o in out if o["rows"]]
    park = [o for o in out if not o["rows"] and o["mwhy"] == PARK_AUTO]
    none = [o for o in out if not o["rows"] and o["mwhy"] and o["mwhy"].startswith("无受益人")]
    manual = [o for o in out if not o["rows"] and o not in park and o not in none]
    need = tot - len(park) - len(none)
    print("池总数 %d | 定位置信度 高%d 中%d 低%d | 冲突 %d 处"
          % (tot, conf["高"], conf["中"], conf["低"], len(conflicts)))
    print("含租户名旧池名 %d 个" % len(with_t))
    print("受益人:落库 %d 池(%d 行) | 园区级自动带出 %d 池 | 账册本就无受益人 %d 池 | "
          "待人工 %d 池 | 覆盖率(应有受益人的 %d 池)%.0f%%"
          % (len(mem), sum(len(o["rows"]) for o in mem), len(park), len(none),
             len(manual), need, 100.0 * len(mem) / max(1, need)))
    print("\n[含租户名池 → 新池名]")
    for o in with_t:
        print("  %-3s %-22s → %s" % (o["r"]["id"], o["r"]["name"], o["name"] or "【待人工】"))
    if conflicts:
        print("\n[同名冲突]")
        for b, a, c, n in conflicts:
            print("  %s ← 池%s / 池%s → 后者改 %s" % (b, a, c, n))
    bad = [o for o in out if any(("不一致" in w or "已置空" in w) for w in o["d"]["warns"])]
    print("\n[楼栋/楼层一致性告警 %d 条]" % len(bad))
    for o in bad:
        print("  %-3s %-22s %s" % (o["r"]["id"], o["r"]["name"], ";".join(o["d"]["warns"])))
    print("\n[待人工勾选受益人]")
    for o in manual:
        print("  %-3s %-22s %s" % (o["r"]["id"], o["r"]["name"], o["mwhy"]))
    print("\n写出: %s\n      %s" % (TSV, os.path.normpath(SQL)))


def selftest():
    assert parse_spot("四楼西侧") == ("四楼", "西侧")
    assert parse_spot("负一层") == ("负一层", None)
    assert parse_spot("天面") == (None, None)          # 天面无楼层 token,由 derive() 的天面判定补成 '天面'
    assert parse_spot("天面 到-1楼") == ("1楼", None)   # 存量脏值(V72 已清);derive() 的天面判定同样覆盖成 '天面'
    assert parse_spot("二楼") == ("二楼", None)
    assert parse_spot(None) == (None, None)
    assert parse_spot("消防分表") == (None, None)
    assert mode(["东侧", "东侧", "西侧"]) == ("东侧", True)
    assert mode([None, None]) == (None, False)
    assert fee_of("公共用电/可莱恩|可莱恩A602公共电") == "公共用电"
    assert fee_of("应急灯/西侧租户|A4西侧消防灯") == "应急灯"
    assert fee_of("东侧楼梯间消防照明|B东侧楼梯间") == "楼梯间"
    assert gen_name("p1", "一期 A座", "四楼", "西侧", "走廊灯") == "一期 A座·四楼西侧·走廊灯"
    assert gen_name("p2", None, None, None, "路灯") == "二期园区·路灯"
    assert gen_name("p1", "一期 C座", None, "东侧", "货梯") == "一期 C座·东侧·货梯"
    assert worst("高", "低", "中") == "低"
    print("selftest ok")


if __name__ == "__main__":
    selftest() if "--selftest" in sys.argv else main()
