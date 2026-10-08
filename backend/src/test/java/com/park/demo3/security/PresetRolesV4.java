package com.park.demo3.security;

import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 七个预置角色在 v4 下的权限点(RBAC-SPEC §15.4 的表,逐格写出来)。RoleApiIT(种子)与 RbacScreenPermsMigrationIT
 * (V140 重放)都对它比 —— 两处说的是同一件事:迁移后每个预置角色能看能改的一屏与 v3 完全相同(用户拍板①)。
 * 改这里之前先改 §15.4。
 */
public final class PresetRolesV4 {
    private PresetRolesV4() {}

    private static List<String> views(String layer, boolean withSalary) {
        return Perm.SCREENS.stream().filter(s -> layer.equals(s.layer()))
            .filter(s -> withSalary || !"salary".equals(s.value())).map(s -> s.value() + ":view").toList();
    }

    private static Set<String> of(List<?>... parts) {
        Set<String> out = new LinkedHashSet<>();
        for (List<?> p : parts) for (Object x : p) out.add((String) x);
        return out;
    }

    /** 报表层 9 屏的编辑 + 经营分析六项「目标与阈值」(v3 的账簿报表编辑)。 */
    private static final List<String> REPORT_EDITS = List.of("income-statement:edit", "balance-sheet:edit",
        "trial-balance:edit", "rent-pnl:edit", "elec-pnl:edit", "water-pnl:edit", "ops-pnl:edit", "expense-pnl:edit",
        "reconciliation:edit", "park:edit", "anomaly:edit", "fin-cashflow:edit", "churn:edit", "breakeven:edit", "pv-roi:edit");
    /** 抄表录入(v3 meter-reading:edit)。 */
    private static final List<String> READINGS = List.of("meters:edit", "pv-income:reading", "car-charging:reading", "ebike-charging:reading");
    /** 出账运行(v3 billing-run:edit),有计费参数查看时另带「重算」。 */
    private static final List<String> RUN = List.of("alloc:edit", "alloc-loss:edit", Perm.BILL_NOTICES_EDIT, "params:recalc");
    /** 事后录入(v3 entry:edit)。 */
    private static final List<String> ENTRY = List.of("ledger:edit", "sales-income:edit", "pv-income:edit", "car-charging:edit",
        "ebike-charging:edit", "elec-cost:edit", "utilities:edit", "import:edit");

    public static final Map<String, Set<String>> EXPECTED = Map.of(
        "admin", Set.copyOf(Perm.ALL),
        "finance_manager", of(views("data", true), views("reports", false), views("analysis", false),
            List.of("buildings:edit", "tenants:edit", "contracts:edit", Perm.PARAMS_EDIT, Perm.PARAMS_MONTHLY,
                Perm.METERS_ARCHIVE, "pv-income:archive", "car-charging:archive", "ebike-charging:archive",
                Perm.ALLOC_POOLS, Perm.BILL_NOTICES_COEF, "bill-notices:issue", "bill-notices:payee", "elec-cost:price",
                Perm.SALARY_EDIT, Perm.LOCK_TAKEOVER, Perm.ELEVATE_REQUEST),
            READINGS, RUN, ENTRY, REPORT_EDITS),
        "finance_clerk", of(views("data", false), views("reports", false), views("analysis", false),
            READINGS, RUN, ENTRY, REPORT_EDITS, List.of(Perm.ELEVATE_REQUEST)),
        "gm", of(views("data", false), views("reports", false), views("analysis", false), List.of(Perm.ELEVATE_REQUEST)),
        "shareholder", of(views("reports", false), views("analysis", false), List.of("import:view")),
        "viewer", of(views("data", false), views("reports", false), views("analysis", false)),
        "reviewer", of(views("data", false), views("reports", false), views("analysis", false), List.of(Perm.REVIEW_APPROVE)));
}
