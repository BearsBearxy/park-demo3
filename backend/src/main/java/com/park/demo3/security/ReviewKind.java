package com.park.demo3.security;

import com.park.demo3.common.BizException;
import com.park.demo3.common.ResultCode;

import java.util.List;
import java.util.regex.Pattern;

/**
 * 审核键的 kind 白名单(SIDEBAR-UX-REDESIGN §7.1)。键格式 `kind[:scope]:period`。
 *
 * **kind→perm 这张表是新写的,不是「复用 RBAC-SPEC §5.2」** —— §5.2 是 126 条
 * URL 路径 → 权限点的有序表,不是以 kind 为主键的表,而且那个映射对 params
 * (policy / monthly 两档)与 elec-cost 根本不是函数。交审要的是「这张表的 edit 权」,
 * 只能按屏(= 清单行)重新列一张。改这张表前先读 §7.1 与 RBAC-SPEC §2.2。
 *
 * 三个命名坑(spec 与代码对不上,别照 spec 的字面去找类):
 *  · UTILITIES 的 service 叫 OfficeService(URL /api/utilities),spec 早期写的 UtilitiesService 不存在。
 *  · ELEC_COST(附表11 报送台账)= ElecService(/api/elec,表 elec_record);ELEC_MODEL(园区电费模型)
 *    = ElecCostService(/api/elec-cost,表 elec_cost_entry)。两把键 2026-09-07 用户拍板拆开 ——
 *    本月出账屏清单上「附表11」那一行的 done 判据读的是 elec_record,所以 elec-cost 守的是 ElecService。
 *  · CHARGING_CAR / CHARGING_EBIKE 是两个 kind,不是一个 kind 的两个 scope
 *    (对比 UTILITIES 的 office / phase3 才是一个 kind 两个 scope)。
 */
public enum ReviewKind {

    PARAMS        ("params",         "计费参数",      ScopeShape.NONE,    List.of(Perm.PARAM_POLICY_EDIT, Perm.PARAM_MONTHLY_EDIT), true),
    METERS        ("meters",         "园区抄表",      ScopeShape.NONE,    List.of(Perm.METER_READING_EDIT), true),
    ALLOC         ("alloc",          "公共电核算",    ScopeShape.NONE,    List.of(Perm.BILLING_RUN_EDIT),   true),
    ALLOC_LOSS    ("alloc-loss",     "楼栋损耗",      ScopeShape.NONE,    List.of(Perm.BILLING_RUN_EDIT),   true),
    BILL_NOTICES  ("bill-notices",   "催缴单",        ScopeShape.NONE,    List.of(Perm.BILLING_RUN_EDIT),   true),
    LEDGER        ("ledger",         "月度台账",      ScopeShape.COMPANY, List.of(Perm.ENTRY_EDIT),         true),
    S10           ("s10",            "附表10",        ScopeShape.PHASE,   List.of(Perm.ENTRY_EDIT),         true),
    SALARY        ("salary",         "附表12",        ScopeShape.NONE,    List.of(Perm.ENTRY_EDIT),         true),
    UTILITIES     ("utilities",      "办公·三期水电", ScopeShape.FIXED,   List.of(Perm.ENTRY_EDIT),         true),
    PV            ("pv",             "附表6",         ScopeShape.NONE,    List.of(Perm.ENTRY_EDIT),         true),
    CHARGING_CAR  ("charging-car",   "附表7",         ScopeShape.NONE,    List.of(Perm.ENTRY_EDIT),         true),
    CHARGING_EBIKE("charging-ebike", "附表8",         ScopeShape.NONE,    List.of(Perm.ENTRY_EDIT),         true),
    ELEC_COST     ("elec-cost",      "附表11",        ScopeShape.NONE,    List.of(Perm.ENTRY_EDIT),         true),
    // 园区电费模型没有清单行(本月出账屏记账列 8 行里没有它),所以两条随之而来:
    //   ① 交审前置不走「清单行 done」,改判「该月 elec_cost_entry 有行」(见 ReviewService);
    //   ② 不进整月锁账的键集合 —— 否则锁账永远达不成,且 P2 已落地的六项计数要跟着改
    //      (§12:计数与审核键集合必须与屏内同源,假绿栽过三次)。
    ELEC_MODEL    ("elec-model",     "园区电费模型",  ScopeShape.NONE,    List.of(Perm.ENTRY_EDIT),         false),

    // ── 三大报表(2026-09-08,用户拍板「每个录入屏都要审核」) ──────────────────
    // 一张报表 × 一家公司 × 一个月一把键。三个 statement 是三个 kind 而不是一个 kind 的
    // 三个 scope —— scope 那一段已经被 companyId 占了(report_amount 的唯一键是
    // company_id + statement + year + month + row_key + field,四维,而审核键只有一段 scope)。
    // 同 CHARGING_CAR / CHARGING_EBIKE 的先例:数据在不同的逻辑表里就是不同的 kind。
    //
    // ⚠ monthClose 取 false。报表是按期导入的,并非每月都有 —— 计入整月锁账会让「本月锁账」
    //   在没导报表的月份**永远达不成**。与 ELEC_MODEL 那个 false 的区别:那把键连清单行都
    //   没有(所以永远交不了审,是个洞);这三把有清单行,交得了、审得过,只是不参与锁账判据。
    //   等报表变成每月必做,把这一位翻真即可,别的都不用动。
    REPORT_IS     ("report-is",      "利润表",        ScopeShape.COMPANY, List.of(Perm.REPORT_EDIT),        false),
    REPORT_BS     ("report-bs",      "资产负债表",    ScopeShape.COMPANY, List.of(Perm.REPORT_EDIT),        false),
    REPORT_TB     ("report-tb",      "科目余额表",    ScopeShape.COMPANY, List.of(Perm.REPORT_EDIT),        false);

    /** kind code → report_amount.statement 的值('is' / 'bs' / 'tb')。不是这三把键就回 null。 */
    public String statement() {
        return switch (this) { case REPORT_IS -> "is"; case REPORT_BS -> "bs"; case REPORT_TB -> "tb";
                               default -> null; };
    }

    /** report_amount.statement → kind。ReportService 的守卫按 statement 反查用。 */
    public static ReviewKind ofStatement(String statement) {
        for (ReviewKind k : values()) if (statement.equals(k.statement())) return k;
        throw new BizException(ResultCode.BAD_REQUEST, "未知的报表:" + statement);
    }

    /** scope 这一维长什么样。COMPANY=数字 companyId;PHASE=1..4;FIXED=office|phase3;NONE=不许带。 */
    public enum ScopeShape { NONE, COMPANY, PHASE, FIXED }

    private final String code, label;
    private final ScopeShape shape;
    private final List<String> perms;
    private final boolean monthClose;

    ReviewKind(String code, String label, ScopeShape shape, List<String> perms, boolean monthClose) {
        this.code = code; this.label = label; this.shape = shape; this.perms = perms; this.monthClose = monthClose;
    }

    public String code() { return code; }

    /** 人话名。进错误文案 —— 用户看到的该是「2024-02 附表12 已审核」而不是「salary 已审核」。 */
    public String label() { return label; }

    public ScopeShape scopeShape() { return shape; }

    /** 交审要的权限点,满足其一即可(同 PermissionRegistry 的 anyOf 语义)。 */
    public List<String> perms() { return perms; }

    /** 进不进整月锁账的键集合(D20)。只有 ELEC_MODEL 是 false。 */
    public boolean countsTowardMonthClose() { return monthClose; }

    public static ReviewKind of(String code) {
        for (ReviewKind k : values()) if (k.code.equals(code)) return k;
        throw new BizException(ResultCode.BAD_REQUEST, "未知的审核类型:" + code);
    }

    static final List<String> FIXED_SCOPES = List.of("office", "phase3");

    /**
     * ⚠ 用 (0[1-9]|1[0-2]) 不是 \d{2}。MeterService 那份 YM 正则是 `\d{4}-\d{2}`,放行 2024-00 /
     * 2024-13;另外 8 个 service 一个月份校验都没有。审核键是最后一道闸,不能跟着松。
     */
    static final Pattern PERIOD = Pattern.compile("^\\d{4}-(0[1-9]|1[0-2])$");
}
