package com.park.demo3.arch;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.TreeSet;
import java.util.stream.Stream;

import static java.util.Map.entry;
import static org.junit.jupiter.api.Assertions.assertTrue;

// selectList(null) 存量门禁(不起 Spring,只静态扫 service 包源码)。
//
// 为什么单盯这一句:它是无条件全表查,返回行数只涨不跌,连"按年月收敛"的机会都不给。
// API-CONTRACT-SPEC §3 的容量红线是「单接口 > 5000 行必须改造」,而 meter_reading /
// alloc_result / monthly_ledger 三张逐月累积表就是先撞线的那几张 —— 今天全表查 1135 行没事,
// 明年同一句就是两万行,且不会有任何人为此报警。所以在源码层把增量掐死。
//
// LEGACY 是**存量快照,不是许可证**:
//   · 清掉一处 → 把数字改小;某文件清干净 → 连这一行一起删掉。
//   · 新增的一律不许进这张表 —— 新代码写 selectList(wrapper) / selectBatchIds,没有例外。
// 断言是「全等」不是「不超过」:清理了也红一次,逼着人回来改这张表。否则数字只会烂成
// 一张没人信的假账,门禁跟着失效。
class QueryHygieneTest {

    static final String SERVICE_DIR = "src/main/java/com/park/demo3/service";
    static final String NEEDLE = "selectList(null)";

    // 2026-08-18 实测存量,共 98 处。数字含义 = 该文件里的代码命中数(注释里提到这句话不计)。
    static final Map<String, Integer> LEGACY = Map.ofEntries(
        entry("AllocService.java", 27),          // 池核算引擎内部,改它要配「重生成 + 逐户对账到分」的回归
        entry("AnalysisService.java", 3),
        entry("BillNoticeService.java", 10),
        entry("BillsService.java", 3),
        entry("BuildingService.java", 11),
        entry("ContractService.java", 8),
        entry("CpMeterService.java", 3),
        entry("ElecCostService.java", 4),
        entry("ElecService.java", 1),
        entry("LedgerService.java", 1),
        entry("MeterBindingService.java", 6),
        entry("MeterService.java", 1),
        entry("ParamService.java", 5),
        entry("PriceCfgService.java", 1),
        entry("PvMeterService.java", 2),
        entry("PvService.java", 1),
        entry("ReconService.java", 2),
        entry("ReportService.java", 1),
        entry("S10Service.java", 1),
        entry("SalaryService.java", 1),
        entry("TenantService.java", 6));

    // ── 有界配置表:与 LEGACY 是**两回事**,不要往上面那张表里塞 ──
    //
    // 本门禁防的是「返回行数只涨不跌」(见类注释):meter_reading / alloc_result / monthly_ledger
    // 这类逐月累积表,今天 1135 行,明年同一句就是两万行。
    //
    // auth_role / auth_role_perm / auth_user_role 不是那种表:它们的行数由**人数与角色数**封顶,
    // 不随时间累积。全量装内存正是 UserPermissionCache 的设计(RBAC-SPEC §5.5:每请求零 DB 查询,
    // 权限改完立刻生效),按 id 收敛反而要 N+1 次查询。
    //
    // 边界写在这里好让人质疑:auth_role_perm ≤ 角色数 × 13,auth_user_role ≤ 账号数 × 角色数。
    // 园区场景下账号是几十个量级。**哪天这个前提不成立了(比如接了几千个租户自助账号),
    // 这一段就该推翻重做,而不是把数字调大。**
    //
    // 语义与 LEGACY 完全一致:全等断言,清理了也要回来改数字。
    // tenant / management_company 同属有界维度表:租户档案由园区单元数封顶(现存 ~350 户,
    // 不随月份累积——逐月涨的是台账/读数行,不是档案行);公司表个位数。
    // softIndex 语义上必须全量(含退租户,账面名唯一解析),按 id 收敛做不到。
    static final Map<String, Integer> BOUNDED = Map.ofEntries(
        entry("SystemService.java", 4),    // 2026-08-22 P1:角色列表 2 处 + 账号列表 2 处
        entry("LedgerService.java", 3),    // 2026-08-23 V105 软引用:save 懒载/renameRow/importRows 的 tenants 全量 softIndex
        entry("S10Service.java", 3),       // 2026-08-23 V105 软引用:save/renameRow/importRows 同上
        entry("BookService.java", 1));     // 2026-08-23 账册种子:seedMissing 启动一次全量 companies(个位数)

    @Test
    void noNewFullTableSelects() throws IOException {
        Map<String, Integer> actual = scan();

        // 扫描面不为空(照 echartsRegistry.spec.ts 的做法):包改名/测试工作目录变了会让本门禁静默失效
        assertTrue(actual.size() >= 15, "只扫到 " + actual.size() + " 个文件," + SERVICE_DIR + " 路径还对吗?本门禁已失效");

        TreeSet<String> files = new TreeSet<>(actual.keySet());
        files.addAll(LEGACY.keySet());
        files.addAll(BOUNDED.keySet());

        List<String> drift = new ArrayList<>();
        for (String f : files) {
            int was = LEGACY.getOrDefault(f, 0) + BOUNDED.getOrDefault(f, 0);
            int now = actual.getOrDefault(f, 0);
            if (now > was) {
                drift.add(f + ": " + was + " → " + now + " ——【新增 " + (now - was)
                    + " 处全表查,不许】改用 selectList(wrapper) 按 ym/年份/id 集合收敛"
                    + (BOUNDED.containsKey(f) ? ";若确属有界配置表(见 BOUNDED 注释的边界),改那张表的数字并说明理由" : ""));
            } else if (now < was) {
                drift.add(f + ": " + was + " → " + now + " ——【已清理 " + (was - now)
                    + " 处,请把 LEGACY 改成 " + now + (now == 0 ? " 或直接删掉这一行】" : "】"));
            }
        }
        assertTrue(drift.isEmpty(), "service 层 selectList(null) 存量与 LEGACY 快照不符:\n  "
            + String.join("\n  ", drift)
            + "\n口径见 docs/design/API-CONTRACT-SPEC.md §3:单接口返回 > 5000 行必须改造,"
            + "逐月累积表(meter_reading / alloc_result / monthly_ledger)先撞线。");
    }

    /** 文件名 → 代码里的 selectList(null) 命中数(0 的不入表) */
    static Map<String, Integer> scan() throws IOException {
        Map<String, Integer> out = new TreeMap<>();
        try (Stream<Path> s = Files.walk(Path.of(SERVICE_DIR))) {
            for (Path p : s.filter(x -> x.toString().endsWith(".java")).toList()) {
                int n = count(p);
                if (n > 0) out.put(p.getFileName().toString(), n);
            }
        }
        return out;
    }

    static int count(Path p) throws IOException {
        int n = 0;
        for (String line : Files.readAllLines(p)) {
            String t = line.strip();
            // 注释里提到这句话不算数(AllocService 就有一处注释在讲"同一句 units.selectList(null)")
            if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) continue;
            // 去空格再找:selectList( null ) 这种写法照样算,不给绕过的缝
            String flat = t.replace(" ", "");
            for (int i = flat.indexOf(NEEDLE); i >= 0; i = flat.indexOf(NEEDLE, i + NEEDLE.length())) n++;
        }
        return n;
    }
}
