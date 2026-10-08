package com.park.demo3.security;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;

import java.util.*;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 逐屏读写放行表(RBAC-SPEC §15.10,不起容器)。夹具是逐屏的「这屏会调哪些接口」(具体路径,不用模板),
 * 从 §15.5 的「依据」列按屏倒过来写 —— 和 PermissionRegistry 是两份独立的来源,对不上就是一边错了。
 *
 * 三条:
 *  ① 只给 <屏>:view,这屏的每个读路径都放行(v1 的病根:只给一屏查看的角色,那一屏有接口 403 就整屏加载失败);
 *  ② 只给这屏的编辑或某个专有动作,它的每个写路径都放行;
 *  ③ **一条路径放行的恰好是夹具里调它的那几屏 / 那几项**,多一个就是越权(兄弟屏拒),少一个就是①②会红。
 * 新加一屏 / 一项而夹具没跟上 → 覆盖那两条红。
 */
public class ScreenAccessMatrixTest {

    private static final Map<String, String> MACRO = Map.of(
        "CHAIN", "/api/params/status /api/alloc/pool-months /api/alloc/loss-months /api/bill-notices/months /api/meters/months",
        "ANA", "/api/analysis/months /api/analysis/settings",
        "DERIVE", "/api/s10/year-summary /api/pv/records /api/charging/7/records /api/charging/8/records /api/elec/records "
            + "/api/utilities/13/records /api/utilities/14/records /api/salary/lunch-totals",
        "PNLY", "/api/pnl/s1/2025 /api/pnl/s2/2025 /api/pnl/s3/2025 /api/pnl/s4/2025 /api/pnl/s5/2025",
        "LEDGERY", "/api/charging/7/records /api/charging/8/records /api/elec/records /api/utilities/13/records /api/utilities/14/records");

    /** 屏 → 它会调的读接口(进屏、换期、切回、开抽屉、开弹窗)。 */
    private static final String READS = """
        data-home: /api/data-home/overview CHAIN
        buildings: /api/buildings /api/buildings/summary /api/buildings/3
        tenants: /api/tenants /api/tenants/summary /api/tenants/7 /api/tenant-categories
        contracts: /api/contracts /api/contracts/summary /api/contracts/7 /api/contracts/7/terminate-preview /api/tenants /api/buildings /api/buildings/3
        params: CHAIN /api/params /api/params/months /api/params/history /api/params/changes /api/price-cfg /api/alloc/rules /api/alloc/cfg /api/tenants /api/buildings /api/meters
        meters: CHAIN /api/meters /api/meters/readings /api/meters/9/readings /api/meters/9/timeline /api/meters/9/status-impact /api/meters/9/delete-impact /api/meters/binding /api/meters/usage-summary /api/meters/years /api/meters/readings/delete-preview /api/tenants /api/buildings
        alloc: CHAIN /api/alloc/rules /api/alloc/pools /api/alloc/pool-candidates /api/alloc/member-diff /api/alloc/meter-diff /api/alloc/result /api/alloc/result/7 /api/alloc/years /api/alloc/recon /api/params /api/meters /api/meters/9/readings /api/tenants /api/buildings
        alloc-loss: CHAIN /api/alloc/loss /api/params
        bill-notices: CHAIN /api/bill-notices /api/bill-notices/5 /api/bill-notices/notes /api/bills/paymap /api/companies/payees /api/companies /api/params /api/alloc/rules /api/alloc/pools /api/contracts /api/buildings
        ledger: /api/ledger/companies/1/years /api/ledger/companies/1/overview /api/ledger/companies/1/months/2025/1 /api/books /api/books/1/template/versions /api/books/1/template/at/2025/1 /api/books/1/template/versions/3 /api/companies /api/tenants /api/bills
        sales-income: /api/s10/overview /api/s10/year-summary /api/s10/1/2025/1 /api/s10/month-totals /api/books /api/books/1/template/versions /api/books/1/template/at/2025/1 /api/books/1/template/versions/3 /api/tenants /api/bills/s10
        salary: /api/salary/overview /api/salary/records /api/salary/lunch-totals
        pv-income: /api/pv/records /api/pv/phases /api/pv/overview /api/pv-meter/months /api/pv-meter/stations /api/pv-meter/readings /api/pv-meter/years
        car-charging: /api/charging/7/records /api/charging/7/cats /api/charging/7/overview /api/cp-meter/months /api/cp-meter/stations /api/cp-meter/readings /api/cp-meter/power-usage /api/cp-meter/years
        ebike-charging: /api/charging/8/records /api/charging/8/cats /api/charging/8/overview /api/cp-meter/months /api/cp-meter/stations /api/cp-meter/readings /api/cp-meter/power-usage /api/cp-meter/years
        elec-cost: /api/elec/records /api/elec/phases /api/elec/overview /api/elec-cost/meters /api/elec-cost/entries /api/elec-cost/price-cfg /api/elec-cost/metrics /api/elec-cost/metrics-year /api/elec-cost/months /api/elec-cost/years
        utilities: /api/utilities/overview /api/utilities/13/records /api/utilities/14/records
        import: /api/import-log/overview
        reports-home: /api/s10/month-totals
        income-statement: /api/companies /api/reports/is/1/years /api/reports/is/1/2025 /api/reports/is/1/2025/1 /api/reports/is/all/2025/1
        balance-sheet: /api/companies /api/reports/bs/1/years /api/reports/bs/1/2025 /api/reports/bs/1/2025/1 /api/reports/bs/all/2025/1
        trial-balance: /api/companies /api/reports/tb/1/years /api/reports/tb/1/2025 /api/reports/tb/1/2025/1 /api/reports/tb/all/2025/1
        rent-pnl: /api/pnl/s1/overview /api/pnl/s1/2025 DERIVE
        elec-pnl: /api/pnl/s2/overview /api/pnl/s2/2025 DERIVE
        water-pnl: /api/pnl/s3/overview /api/pnl/s3/2025 DERIVE
        ops-pnl: /api/pnl/s4/overview /api/pnl/s4/2025 DERIVE
        expense-pnl: /api/pnl/s5/overview /api/pnl/s5/2025 DERIVE
        reconciliation: /api/recon/overview /api/recon/2025/1
        cockpit: ANA /api/analysis/s10-tenant-months /api/analysis/ledger-tenant-months /api/budget/all PNLY LEDGERY
        anomaly: ANA /api/analysis/s10-tenant-months /api/analysis/ledger-tenant-months /api/params /api/pv-meter/months /api/pv-meter/stations /api/pv-meter/readings LEDGERY
        park: ANA /api/tenants /api/buildings/summary /api/buildings/3 /api/buildings /api/contracts
        park-energy: ANA /api/analysis/s10-tenant-months /api/pv/records /api/pv/overview LEDGERY
        tenant-energy: ANA /api/analysis/s10-tenant-months /api/analysis/ledger-tenant-months /api/tenants
        tenant-portfolio: ANA /api/tenants /api/contracts
        tenant-peer: ANA /api/analysis/s10-tenant-months /api/tenants /api/buildings /api/contracts /api/contracts/7
        fin-pnl: ANA /api/companies /api/budget/all PNLY /api/reports/is/1/2025/1 /api/reports/is/all/2025/1
        fin-balance: ANA /api/companies /api/reports/is/1/2025/1 /api/reports/is/all/2025/1 /api/reports/bs/1/2025/1 /api/reports/bs/all/2025/1
        fin-cashflow: ANA /api/analysis/s10-tenant-months /api/analysis/ledger-tenant-months /api/tenants /api/companies
        fin-expense: ANA PNLY
        churn: ANA /api/analysis/s10-tenant-months /api/analysis/ledger-tenant-months
        expiry: ANA /api/contracts
        breakeven: ANA /api/analysis/s10-tenant-months PNLY
        budget: ANA /api/budget/all PNLY
        pnl-analysis: ANA PNLY
        pv-roi: ANA /api/pv/records /api/pv/phases /api/pv/overview
        pv-meter-analysis: ANA /api/params /api/pv-meter/stations /api/pv-meter/readings /api/elec-cost/price-cfg
        elec-analysis: ANA /api/elec-cost/price-cfg /api/elec-cost/meters /api/elec-cost/entries /api/elec-cost/metrics-year
        charging-analysis: ANA /api/cp-meter/stations /api/cp-meter/readings /api/cp-meter/power-usage /api/cp-meter/years
        sys-users: /api/system/users /api/system/roles
        sys-roles: /api/system/perms /api/system/roles /api/system/users
        sys-logs: /api/system/logs
        """;

    /** 写权限 → 它放行的写接口。交审 / 撤回另由 submitGateIsUnionOfKindPerms 钉(PermissionCoverageTest)。 */
    private static final String WRITES = """
        buildings:edit: POST /api/buildings | PUT /api/buildings/3 | DELETE /api/buildings/3 | POST /api/buildings/3/units | PUT /api/units/5 | DELETE /api/units/5
        tenants:edit: POST /api/tenants | PUT /api/tenants/7 | DELETE /api/tenants/7
        contracts:edit: POST /api/contracts | PUT /api/contracts/7 | POST /api/contracts/7/terminate | POST /api/contracts/7/renew | DELETE /api/contracts/7 | POST /api/contracts/billing-lines/import | POST /api/contracts/import-full
        params:edit: PUT /api/params | PUT /api/price-cfg | PUT /api/alloc/cfg
        params:monthly: PUT /api/params | POST /api/price-cfg/copy
        params:recalc: POST /api/params/recalc
        meters:edit: POST /api/meters/readings | PUT /api/meters/readings/4 | DELETE /api/meters/readings/4 | DELETE /api/meters/readings | POST /api/meters/import
        meters:archive: POST /api/meters | PUT /api/meters/9 | PUT /api/meters/assign | POST /api/meters/assign/clear-manual | POST /api/meters/9/status | DELETE /api/meters/9/status/2025-01 | DELETE /api/meters/9 | POST /api/meters/import-batches/3/revert | PUT /api/meters/9/bind | POST /api/meters/auto-link-by-name
        alloc:edit: POST /api/alloc/generate | POST /api/alloc/result/manual | DELETE /api/alloc/result/4
        alloc:pools: POST /api/alloc/rules | PUT /api/alloc/rules/12 | DELETE /api/alloc/rules/12
        alloc-loss:edit: POST /api/alloc/generate | PUT /api/alloc/loss/note
        bill-notices:edit: POST /api/bill-notices/generate | PUT /api/bill-notices/notes | DELETE /api/bill-notices/notes
        bill-notices:issue: POST /api/bill-notices/confirm | POST /api/bill-notices/unconfirm | POST /api/bill-notices/mark-exported | POST /api/bill-notices/5/issue | POST /api/bill-notices/5/void | PUT /api/bills/paymap
        bill-notices:coef: PUT /api/alloc/rules/12 | PUT /api/params
        bill-notices:payee: PUT /api/companies/3 | POST /api/companies/3/accounts | PUT /api/company-accounts/4 | DELETE /api/company-accounts/4
        ledger:edit: PUT /api/ledger/companies/1/months/2025/1 | POST /api/ledger/companies/1/months/2025/1/copy-from-prev | POST /api/ledger/companies/1/import | PUT /api/ledger/bind-tenant | PATCH /api/ledger/rows/5/tenant | PATCH /api/ledger/rows/5/tenant-name
        ledger:template: PUT /api/books/1/template
        ledger:version: POST /api/books/1/template/pin
        ledger:company: POST /api/companies | DELETE /api/companies/3
        sales-income:edit: POST /api/s10 | POST /api/s10/import | PATCH /api/s10/5/note | DELETE /api/s10/5 | DELETE /api/s10/imported | DELETE /api/s10/batch | PUT /api/s10/bind-tenant | PATCH /api/s10/5/tenant | PATCH /api/s10/5/tenant-name
        sales-income:template: PUT /api/books/1/template
        sales-income:version: POST /api/books/1/template/pin
        salary:edit: POST /api/salary/records | PATCH /api/salary/records/5/note | DELETE /api/salary/records/5 | POST /api/salary/import | DELETE /api/salary/imported | DELETE /api/salary/batch
        pv-income:edit: POST /api/pv/records | PATCH /api/pv/records/5/note | DELETE /api/pv/records/5 | POST /api/pv/import | DELETE /api/pv/imported | DELETE /api/pv/batch
        pv-income:archive: POST /api/pv-meter/stations | PUT /api/pv-meter/stations/3 | DELETE /api/pv-meter/stations/3 | POST /api/pv-meter/simulate
        pv-income:reading: POST /api/pv-meter/readings | PUT /api/pv-meter/readings/5 | DELETE /api/pv-meter/readings/5 | POST /api/pv-meter/import
        car-charging:edit: POST /api/charging/7/records | PATCH /api/charging/7/records/5/note | DELETE /api/charging/7/records/5 | POST /api/charging/7/import | DELETE /api/charging/7/imported | DELETE /api/charging/7/batch
        car-charging:archive: POST /api/cp-meter/stations | PUT /api/cp-meter/stations/3 | DELETE /api/cp-meter/stations/3
        car-charging:reading: POST /api/cp-meter/readings | PUT /api/cp-meter/readings/5 | DELETE /api/cp-meter/readings/5 | PUT /api/cp-meter/power-usage | POST /api/cp-meter/import | POST /api/cp-meter/simulate
        ebike-charging:edit: POST /api/charging/8/records | PATCH /api/charging/8/records/5/note | DELETE /api/charging/8/records/5 | POST /api/charging/8/import | DELETE /api/charging/8/imported | DELETE /api/charging/8/batch
        ebike-charging:archive: POST /api/cp-meter/stations | PUT /api/cp-meter/stations/3 | DELETE /api/cp-meter/stations/3
        ebike-charging:reading: POST /api/cp-meter/readings | PUT /api/cp-meter/readings/5 | DELETE /api/cp-meter/readings/5 | PUT /api/cp-meter/power-usage | POST /api/cp-meter/import | POST /api/cp-meter/simulate
        elec-cost:edit: POST /api/elec/records | PATCH /api/elec/records/5/note | DELETE /api/elec/records/5 | POST /api/elec/import | DELETE /api/elec/imported | DELETE /api/elec/batch | POST /api/elec-cost/meters | PUT /api/elec-cost/meters/3 | DELETE /api/elec-cost/meters/3 | PUT /api/elec-cost/entries | DELETE /api/elec-cost/entries/5 | POST /api/elec-cost/import
        elec-cost:price: PUT /api/elec-cost/price-cfg | POST /api/elec-cost/simulate
        utilities:edit: POST /api/utilities/13/records | PATCH /api/utilities/13/records/5/note | DELETE /api/utilities/14/records/5 | POST /api/utilities/14/import | DELETE /api/utilities/13/imported | DELETE /api/utilities/batch
        import:edit: POST /api/budget/import
        income-statement:edit: PUT /api/reports/is/1/2025/1 | POST /api/reports/is/1/custom-row | DELETE /api/reports/is/custom-row/5 | POST /api/reports/is/import
        balance-sheet:edit: PUT /api/reports/bs/1/2025/1 | POST /api/reports/bs/1/custom-row | DELETE /api/reports/bs/custom-row/5 | POST /api/reports/bs/import
        trial-balance:edit: PUT /api/reports/tb/1/2025/1 | POST /api/reports/tb/1/custom-row | DELETE /api/reports/tb/custom-row/5 | POST /api/reports/tb/import
        rent-pnl:edit: PUT /api/pnl/s1/2025 | POST /api/pnl/s1/import
        elec-pnl:edit: PUT /api/pnl/s2/2025 | POST /api/pnl/s2/import
        water-pnl:edit: PUT /api/pnl/s3/2025 | POST /api/pnl/s3/import
        ops-pnl:edit: PUT /api/pnl/s4/2025 | POST /api/pnl/s4/import
        expense-pnl:edit: PUT /api/pnl/s5/2025 | POST /api/pnl/s5/import
        reconciliation:edit: POST /api/recon/2025/1/mark | DELETE /api/recon/2025/1/mark
        anomaly:edit: PUT /api/analysis/settings
        park:edit: PUT /api/analysis/settings
        fin-cashflow:edit: PUT /api/analysis/settings
        churn:edit: PUT /api/analysis/settings
        breakeven:edit: PUT /api/analysis/settings
        pv-roi:edit: PUT /api/analysis/settings
        sys-users:edit: POST /api/system/users | PUT /api/system/users/3 | POST /api/system/users/3/status | POST /api/system/users/3/password
        sys-roles:edit: POST /api/system/roles | PUT /api/system/roles/3 | DELETE /api/system/roles/3
        """;

    private static Map<String, List<String>> parse(String table, String sep) {
        Map<String, List<String>> out = new LinkedHashMap<>();
        for (String line : table.strip().split("\n")) {
            int c = line.indexOf(": ");
            List<String> items = new ArrayList<>();
            for (String it : line.substring(c + 2).trim().split(sep)) {
                String t = it.trim();
                if (MACRO.containsKey(t)) items.addAll(List.of(MACRO.get(t).split(" ")));
                else if (!t.isEmpty()) items.add(t);
            }
            assertThat(out.put(line.substring(0, c).trim(), items)).as("夹具里重复的行:" + line).isNull();
        }
        return out;
    }

    /** 屏 → 它会调的读接口(宏已展开)。ScreenPermIT 拿它对每一屏真打一遍 HTTP。 */
    public static Map<String, List<String>> readsByScreen() { return parse(READS, " "); }

    private final PermissionRegistry reg = new PermissionRegistry();
    private final Map<String, List<String>> reads = parse(READS, " ");
    private final Map<String, List<String>> writes = parse(WRITES, "\\|");

    @Test
    void everyScreenAndEveryWritePermHasAFixtureRow() {
        assertThat(reads.keySet()).containsExactlyInAnyOrderElementsOf(Perm.SCREENS.stream().map(Perm.Screen::value).toList());
        List<String> writePerms = Perm.ALL.stream().filter(Perm::isWrite).toList();
        assertThat(writes.keySet()).containsExactlyInAnyOrderElementsOf(writePerms);
    }

    /** ① + ③(读):每屏的每个读路径对它的查看放行;一条路径放行的恰好是调它的那几屏。 */
    @Test
    void readsOpenExactlyToTheScreensThatCallThem() {
        Map<String, Set<String>> callers = new TreeMap<>();
        reads.forEach((scr, paths) -> paths.forEach(p -> callers.computeIfAbsent(p, k -> new TreeSet<>()).add(scr + ":view")));
        List<String> bad = new ArrayList<>();
        callers.forEach((path, want) -> {
            List<String> got = reg.resolveRead(path);
            if (got == null || !new TreeSet<>(got).equals(want)) bad.add("GET " + path + "\n   规则 " + got + "\n   夹具 " + want);
        });
        assertThat(bad).isEmpty();
    }

    /** ② + ③(写):每项的每个写路径对它放行;一条路径放行的恰好是夹具里认领它的那几项。 */
    @Test
    void writesOpenExactlyToTheActionsThatOwnThem() {
        Map<String, Set<String>> owners = new TreeMap<>();
        writes.forEach((perm, eps) -> eps.forEach(ep -> owners.computeIfAbsent(ep, k -> new TreeSet<>()).add(perm)));
        List<String> bad = new ArrayList<>();
        owners.forEach((ep, want) -> {
            String[] mp = ep.split(" ");
            List<String> got = reg.resolve(HttpMethod.valueOf(mp[0]), mp[1]);
            if (got == null || !new TreeSet<>(got).equals(want)) bad.add(ep + "\n   规则 " + got + "\n   夹具 " + want);
        });
        assertThat(bad).isEmpty();
    }

    /** §15.10 点名的兄弟屏拒绝(上面的等式已经覆盖,这里逐条写出来,改坏时报错一眼看懂)。 */
    @Test
    void namedSiblingDenials() {
        assertThat(reg.resolve(HttpMethod.POST, "/api/alloc/rules")).doesNotContain("alloc-loss:edit", Perm.BILL_NOTICES_COEF);
        assertThat(reg.resolve(HttpMethod.POST, "/api/charging/8/records")).doesNotContain("car-charging:edit");
        assertThat(reg.resolve(HttpMethod.PUT, "/api/pnl/s2/2025")).doesNotContain("rent-pnl:edit");
        assertThat(reg.resolve(HttpMethod.POST, "/api/books/1/template/pin")).doesNotContain("ledger:template");
        assertThat(reg.resolveRead("/api/bills")).doesNotContain(Perm.BILL_NOTICES_VIEW);
        assertThat(reg.resolveRead("/api/bills/s10")).doesNotContain(Perm.BILL_NOTICES_VIEW);
        assertThat(reg.resolveRead("/api/s10/1/2025/1")).doesNotContain("reports-home:view");
        assertThat(reg.resolveRead("/api/pnl/s1/2025")).doesNotContain("import:view");
        assertThat(reg.resolveRead("/api/reports/is/all/2025/1")).doesNotContain("reports-home:view");
        assertThat(reg.resolveRead("/api/tenants/7")).as("租户抽屉只给租户屏").containsExactly(Perm.TENANTS_VIEW);
    }
}
