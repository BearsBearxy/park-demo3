package com.park.demo3.security;

import java.util.Collection;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 权限点常量表(RBAC-SPEC §15,v4「权限细到菜单单项」,用户 2026-10-09 拍板)。
 * **权限点由代码定义,角色→权限点的映射才是数据。** 客户在角色屏能随意配角色,但配不出这里没有的权限。
 *
 * v4:每个菜单单项一个「查看」(`<屏>:view`),有写的屏一个「编辑」(`<屏>:edit`),原来单列的特殊动作挂到发起它的那一屏
 * (`<屏>:<动作>`);跨屏三项(审核、编辑锁授权、可请求提权)原键原义。屏 = frontend/src/nav/fpNav.ts 的 item.value,
 * {@link #SCREENS} 与它逐条一致(PermScreensMatchFpNavTest 钉着)。
 * 同屏任一非查看动作隐含本屏查看({@link #withImplied},装载快照时展开,不落库);不跨屏隐含。
 * v3 的 28 个模块键已退役:库里还留着的旧键行(V140 只增不删)新代码一律当不存在({@link #exists} 不认),
 * 只在操作日志里显示成人话({@link #LEGACY_LABELS})。
 */
public final class Perm {
    private Perm() {}

    // ═══ 代码里直接引用的键(其余键只出现在规则表与 META 里,由 PermissionCoverageTest 查拼写) ═══
    public static final String REVIEW_APPROVE  = "review:approve";
    public static final String LOCK_TAKEOVER   = "lock:takeover";
    public static final String ELEVATE_REQUEST = "elevate:request";
    public static final String SALARY_EDIT     = "salary:edit";
    public static final String SYS_USERS_VIEW  = "sys-users:view";
    public static final String SYS_USERS_EDIT  = "sys-users:edit";
    public static final String SYS_ROLES_VIEW  = "sys-roles:view";
    public static final String SYS_ROLES_EDIT  = "sys-roles:edit";
    public static final String SYS_LOGS_VIEW   = "sys-logs:view";
    public static final String TENANTS_VIEW    = "tenants:view";
    public static final String PARAMS_VIEW     = "params:view";
    public static final String PARAMS_EDIT     = "params:edit";
    public static final String PARAMS_MONTHLY  = "params:monthly";
    public static final String METERS_VIEW     = "meters:view";
    public static final String METERS_ARCHIVE  = "meters:archive";
    public static final String ALLOC_POOLS     = "alloc:pools";
    public static final String BILL_NOTICES_VIEW = "bill-notices:view";
    public static final String BILL_NOTICES_EDIT = "bill-notices:edit";
    public static final String BILL_NOTICES_COEF = "bill-notices:coef";
    public static final String CHARGING_ANALYSIS_VIEW = "charging-analysis:view";

    /** 一屏:value、屏上名字、所在层(data / reports / analysis / system)。顺序 = fpNav 的顺序。 */
    public record Screen(String value, String label, String layer) {}

    public static final List<Screen> SCREENS = List.of(
        new Screen("data-home", "本月出账", "data"),
        new Screen("buildings", "楼栋管理", "data"),
        new Screen("tenants", "租户管理", "data"),
        new Screen("contracts", "合同管理", "data"),
        new Screen("params", "计费参数", "data"),
        new Screen("meters", "园区抄表", "data"),
        new Screen("alloc", "公共电核算", "data"),
        new Screen("alloc-loss", "楼栋损耗", "data"),
        new Screen("bill-notices", "催缴单", "data"),
        new Screen("ledger", "月度台账", "data"),
        new Screen("sales-income", "附表10 销售收入", "data"),
        new Screen("salary", "附表12 工资明细", "data"),
        new Screen("pv-income", "附表6 光伏发电", "data"),
        new Screen("car-charging", "附表7 汽车充电桩", "data"),
        new Screen("ebike-charging", "附表8 电动车充电桩", "data"),
        new Screen("elec-cost", "附表11 电费成本", "data"),
        new Screen("utilities", "办公·三期水电", "data"),
        new Screen("import", "导入中心", "data"),
        new Screen("reports-home", "报表中心", "reports"),
        new Screen("income-statement", "利润表", "reports"),
        new Screen("balance-sheet", "资产负债表", "reports"),
        new Screen("trial-balance", "科目余额表", "reports"),
        new Screen("rent-pnl", "附表1 租金损益", "reports"),
        new Screen("elec-pnl", "附表2 用电损益", "reports"),
        new Screen("water-pnl", "附表3 用水损益", "reports"),
        new Screen("ops-pnl", "附表4 运管损益", "reports"),
        new Screen("expense-pnl", "附表5 费用支出", "reports"),
        new Screen("reconciliation", "收入核对", "reports"),
        new Screen("cockpit", "经营驾驶舱", "analysis"),
        new Screen("anomaly", "异常提醒中心", "analysis"),
        new Screen("park", "出租与楼栋", "analysis"),
        new Screen("park-energy", "园区能耗", "analysis"),
        new Screen("tenant-energy", "用能与缴费", "analysis"),
        new Screen("tenant-portfolio", "结构与续约", "analysis"),
        new Screen("tenant-peer", "租户对标", "analysis"),
        new Screen("fin-pnl", "利润表分析", "analysis"),
        new Screen("fin-balance", "资产负债分析", "analysis"),
        new Screen("fin-cashflow", "现金流量分析", "analysis"),
        new Screen("fin-expense", "费用与报销", "analysis"),
        new Screen("churn", "租户流失预警", "analysis"),
        new Screen("expiry", "到期墙与续约", "analysis"),
        new Screen("breakeven", "盈亏平衡与敏感性", "analysis"),
        new Screen("budget", "预算对比", "analysis"),
        new Screen("pnl-analysis", "损益附表分析", "analysis"),
        new Screen("pv-roi", "光伏投资回收", "analysis"),
        new Screen("pv-meter-analysis", "光伏分栋分析", "analysis"),
        new Screen("elec-analysis", "电费成本分析", "analysis"),
        new Screen("charging-analysis", "充电桩分析", "analysis"),
        new Screen("sys-users", "用户管理", "system"),
        new Screen("sys-roles", "角色权限", "system"),
        new Screen("sys-logs", "操作日志", "system"));

    private static final Map<String, Screen> SCREEN_BY_VALUE = new HashMap<>();
    static { for (Screen s : SCREENS) SCREEN_BY_VALUE.put(s.value(), s); }

    /** 屏 value → 屏;不是导航里的一屏回 null。 */
    public static Screen screen(String value) { return value == null ? null : SCREEN_BY_VALUE.get(value); }

    /**
     * 角色屏权限树用的人话名 + 一句说明 + 所属屏 + 种类。**前端不许硬编码这些权限点** —— 加一个时它要自动出现。
     * screen = 屏 value(跨屏三项为 null);kind ∈ view / edit / action / other。
     */
    public record Meta(String key, String label, String hint, String screen, String kind) {}

    private static Meta v(String scr, String hint) { return new Meta(scr + ":view", SCREEN_BY_VALUE.get(scr).label() + " · 查看", hint, scr, "view"); }
    private static Meta e(String scr, String hint) { return new Meta(scr + ":edit", SCREEN_BY_VALUE.get(scr).label() + " · 编辑", hint, scr, "edit"); }
    private static Meta a(String scr, String act, String name, String hint) {
        return new Meta(scr + ":" + act, SCREEN_BY_VALUE.get(scr).label() + " · " + name, hint, scr, "action");
    }
    private static Meta x(String key, String label, String hint) { return new Meta(key, label, hint, null, "other"); }

    /** 107 项,按 fpNav 的层 / 分组 / 屏顺序(RBAC-SPEC §15.2)。⚠ 必须声明在 SCREEN_BY_VALUE 之后:静态初始化按源码顺序走。 */
    public static final List<Meta> META = List.of(
        // ── 数据中心 ──
        v("data-home", "这个月每张表录没录、交没交审、审没审；催缴单那一步的金额另要「催缴单 · 查看」才显示"),
        v("buildings", "楼栋、楼层、单元和面积"),
        e("buildings", "新增、修改、删除楼栋、楼层和单元；单元面积会影响按面积分摊和按面积收的租金"),
        v("tenants", "租户档案、分类和联系人；没有这一项时，别的屏上看到的租户联系人和电话只显示一部分"),
        e("tenants", "新增、修改、删除租户"),
        v("contracts", "合同列表、合同详情和租金计费行"),
        e("contracts", "新增、编辑、续签、终止、删除合同，导入合同计费行；楼栋抽屉里的「新增合同」、导入中心里的两张合同卡片也要这一项"),
        v("params", "单价、系数、户级例外、每月电价，以及它们的改动记录；编辑模式要「编辑」「月度录入」「重算」都有才进得去"),
        e("params", "长期计费口径：常量、规则、户级例外、不计入的表"),
        a("params", "monthly", "月度录入", "每月照供电局账单填的电价和调整量，「复制上月电价」"),
        a("params", "recalc", "重算", "「重算本月」：按改好的参数重新生成这个月的公共电核算、楼栋损耗和催缴单"),
        v("meters", "每块表的读数、表档案和按月归属；编辑模式要「编辑」「表档案」都有才进得去"),
        e("meters", "录读数、改读数、导入抄表册、删掉本期读数"),
        a("meters", "archive", "表档案", "新增、删除电表，改倍率、表号、按月归属、在用 / 停用、和合同的绑定；导入抄表册时改倍率也要这一项"),
        v("alloc", "每个公摊池本月的用量、分摊结果和受益户；编辑模式要「编辑」「公摊池配置」都有才进得去"),
        e("alloc", "生成 / 重新生成本月公共电核算，交审"),
        a("alloc", "pools", "公摊池配置", "新增、修改、删除公摊池：受益户、绑的表、折入关系"),
        v("alloc-loss", "每栋楼本月的损耗和备注"),
        e("alloc-loss", "改备注、重算本月、交审"),
        v("bill-notices", "每户催缴单、明细和收款簿；收款账号显示完整（单子要发给租户）；编辑模式要「编辑」「签发」都有才进得去"),
        e("bill-notices", "生成 / 重新生成本月催缴单、改单据备注、交审；在园区抄表里删读数或删表时连带删草稿催缴单也要这一项"),
        a("bill-notices", "issue", "签发", "确认、取消确认、作废、标记已导出、指定收款公司；单子发出去就收不回"),
        a("bill-notices", "coef", "系数簿", "在「系数簿」里改每户的单价系数和电梯 / 消防层份"),
        a("bill-notices", "payee", "收款公司", "在「收款公司」里改公司名称、加改删收款账户；报表屏上给公司改名也要这一项"),
        v("ledger", "各公司每月台账，账册模板的历史版本"),
        e("ledger", "录入、导入、从上月复制、绑定租户、交审"),
        a("ledger", "template", "账册模板", "改列名、别名、列宽，增删自定义列（升一版模板）"),
        a("ledger", "version", "更换版本", "给还没录数的月份换一版账册模板"),
        a("ledger", "company", "新增删除公司", "新增记账公司（同时建台账册）；删除公司会连同它全部台账和报表数据一起删掉，不能恢复。报表屏的新增 / 删除公司、收款公司里的新增公司也要这一项"),
        v("sales-income", "四本期区册每月的销售收入"),
        e("sales-income", "录入、导入、删除、绑定租户、交审"),
        a("sales-income", "template", "账册模板", "改列名、别名、列宽，增删自定义列（升一版模板）"),
        a("sales-income", "version", "更换版本", "给还没录数的月份换一版账册模板"),
        v("salary", "逐人逐月工资明细"),
        e("salary", "新增、改备注、删除、导入（含导入中心）、交审；不能请主管当场授权"),
        v("pv-income", "报送台账和分栋运营账两本；分栋运营账的编辑模式要「电站档案」「分栋读数」都有才进得去"),
        e("pv-income", "报送台账的录入、导入、删除、交审"),
        a("pv-income", "archive", "电站档案", "新增、修改、删除电站（含上网单价），模拟填充"),
        a("pv-income", "reading", "分栋读数", "分栋运营账的抄表记录录入、导入、删除"),
        v("car-charging", "报送台账和分桩运营账两本（汽车桩）；分桩运营账的编辑模式要「桩库」「分桩读数」都有才进得去"),
        e("car-charging", "报送台账的录入、导入、删除、交审"),
        a("car-charging", "archive", "桩库", "新增、修改、删除汽车充电桩"),
        a("car-charging", "reading", "分桩读数", "汽车桩的充电记录和电表用电量录入、导入、删除；「模拟填充」要汽车、电动车两屏的这一项都有"),
        v("ebike-charging", "报送台账和分桩运营账两本（电动车桩）；分桩运营账的编辑模式要「桩库」「分桩读数」都有才进得去"),
        e("ebike-charging", "报送台账的录入、导入、删除、交审"),
        a("ebike-charging", "archive", "桩库", "新增、修改、删除电动车充电桩"),
        a("ebike-charging", "reading", "分桩读数", "电动车桩的充电记录和电表用电量录入、导入、删除；「模拟填充」要汽车、电动车两屏的这一项都有"),
        v("elec-cost", "报送台账和园区电费模型两本；电费模型的编辑模式要「编辑」「电价口径」都有才进得去"),
        e("elec-cost", "报送台账和电费模型的费项录入、导入、电表增删、交审"),
        a("elec-cost", "price", "电价口径", "电费模型里的电价参数，模拟填充"),
        v("utilities", "办公室和三期的逐月水电"),
        e("utilities", "录入、导入、删除、交审"),
        v("import", "导入记录：文件名、行数、谁导的；导入中心里每张卡片另按它导进去的那一屏的编辑权显示"),
        e("import", "导入年度预算（预算只在导入中心导）"),
        // ── 账簿与报表 ──
        v("reports-home", "本期各张报表做没做、勾稽对不对；看不了的报表照样列出，卡片上写明缺哪一项"),
        v("income-statement", "各公司和全部汇总的利润表"),
        e("income-statement", "改数、增删子类、导入、交审"),
        v("balance-sheet", "各公司和全部汇总的资产负债表"),
        e("balance-sheet", "改数、增删子类、导入、交审"),
        v("trial-balance", "各公司的科目余额"),
        e("trial-balance", "改数、增删科目、导入、交审"),
        v("rent-pnl", "逐月数和取自台账附表的对照数"),
        e("rent-pnl", "改数、导入"),
        v("elec-pnl", "同上"),
        e("elec-pnl", "改数、导入"),
        v("water-pnl", "同上"),
        e("water-pnl", "改数、导入"),
        v("ops-pnl", "同上"),
        e("ops-pnl", "改数、导入"),
        v("expense-pnl", "同上"),
        e("expense-pnl", "改数、导入"),
        v("reconciliation", "台账和附表10 的逐户对账"),
        e("reconciliation", "标记已核实、取消核实"),
        // ── 经营分析(20 屏都只读数据;6 屏的「编辑」是改「目标与阈值」里归它的那一项,全园共用一份) ──
        v("cockpit", "收入、出租、收缴、异常的总览"),
        v("anomaly", "用能突变、欠费、光伏发电异常等提醒"),
        e("anomaly", "改「能耗突变阈值」（全园共用）"),
        v("park", "出租率、楼栋与楼层出租情况"),
        e("park", "改「出租率目标」（全园共用）"),
        v("park-energy", "园区用电、用水、充电、光伏的逐月对比"),
        v("tenant-energy", "逐户用能和缴费"),
        v("tenant-portfolio", "租户行业结构、面积结构和续约"),
        v("tenant-peer", "选中一户，看它在同类租户里的位置"),
        v("fin-pnl", "收入、成本、利润的趋势和预算对比"),
        v("fin-balance", "资产负债结构和变化"),
        v("fin-cashflow", "收缴率、欠费和账龄；导出催缴清单"),
        e("fin-cashflow", "改「收缴率目标」（全园共用）"),
        v("fin-expense", "费用支出的结构和趋势"),
        v("churn", "按缴费和用能给每户打的流失风险分"),
        e("churn", "改「风险线/流失预警」（全园共用，异常提醒中心也用这条线）"),
        v("expiry", "合同按月到期分布"),
        v("breakeven", "盈亏平衡点和各因素的影响"),
        e("breakeven", "改「固定成本占比」（全园共用，滑杆松手就存）"),
        v("budget", "预算和实际的逐项对比"),
        v("pnl-analysis", "五张损益附表的汇总分析"),
        v("pv-roi", "光伏累计收益和回收进度"),
        e("pv-roi", "改「光伏投资额」（全园共用）"),
        v("pv-meter-analysis", "逐栋发电、利用小时和异常"),
        v("elec-analysis", "园区电费成本结构和单价"),
        v("charging-analysis", "汽车、电动车充电量和收入"),
        // ── 系统管理(全部不可提权) ──
        v("sys-users", "账号列表和每个账号挂的角色"),
        e("sys-users", "新建账号、改显示名和角色、停用 / 启用、重置密码"),
        v("sys-roles", "每个角色勾了哪些权限、有哪些成员"),
        e("sys-roles", "新建、修改、删除角色，添加和移出角色成员"),
        v("sys-logs", "谁在什么时候改了什么；数据修改记录只列你看得了的那几屏"),
        // ── 跨屏(原键原义) ──
        x(REVIEW_APPROVE, "审核", "通过 / 退回 / 撤销某张表某个月的审核；已审核的表任何人都改不了，只有审核员能撤销"),
        x(LOCK_TAKEOVER, "编辑锁 · 授权", "别人正在编辑时，授权他人接管（不是自己接管）"),
        x(ELEVATE_REQUEST, "可请求提权", "遇到没权限的操作时，能请主管当场输密码授权 30 分钟；不给这项时缺什么只能找系统管理员补勾，编辑模式要几项齐的屏缺一项就进不去"));

    /** 全部 107 个,与 META 同序。角色屏的树、覆盖率测试、角色回包排序都按它。 */
    public static final List<String> ALL = META.stream().map(Meta::key).toList();

    private static final Map<String, Meta> META_BY_KEY = new HashMap<>();
    static { for (Meta m : META) META_BY_KEY.put(m.key(), m); }

    /** 只认 107 个新键。v3 的旧键(库里 V140 留下的行)不认 —— 不进快照、不进回包、不参与比较。 */
    public static boolean exists(String perm) { return perm != null && META_BY_KEY.containsKey(perm); }

    /** 写:编辑或专有动作。只读判定、占编辑锁都用它(专有动作不以 :edit 结尾也是写)。 */
    public static boolean isWrite(String perm) {
        Meta m = META_BY_KEY.get(perm);
        return m != null && ("edit".equals(m.kind()) || "action".equals(m.kind()));
    }

    /** 这个键的屏在系统管理层。 */
    public static boolean isSystem(String perm) {
        Meta m = META_BY_KEY.get(perm);
        Screen s = m == null ? null : screen(m.screen());
        return s != null && "system".equals(s.layer());
    }

    /**
     * v3 的 23 个旧键 → 人话名(RBAC-SPEC §15.8)。只给 {@link #label} 用:操作日志里 0.32 之前的
     * elevate.grant 存的是旧键原文。不进 ALL、不可勾。
     */
    public static final Map<String, String> LEGACY_LABELS = Map.ofEntries(
        Map.entry("master:view", "主数据 · 查看（旧版）"), Map.entry("master:edit", "主数据（旧版）"),
        Map.entry("company:manage", "公司/账册管理（旧版）"),
        Map.entry("contract:view", "合同 · 查看（旧版）"), Map.entry("contract:edit", "合同（旧版）"),
        Map.entry("param:view", "计费参数 · 查看（旧版）"), Map.entry("param-policy:edit", "计费口径（旧版）"),
        Map.entry("param-monthly:edit", "月度计费录入（旧版）"),
        Map.entry("meter:view", "抄表 · 查看（旧版）"), Map.entry("meter-master:edit", "表档案（旧版）"),
        Map.entry("meter-reading:edit", "抄表（旧版）"),
        Map.entry("billing:view", "出账与催缴单 · 查看（旧版）"), Map.entry("billing-run:edit", "出账运行（旧版）"),
        Map.entry("billing-issue:edit", "催缴单签发（旧版）"),
        Map.entry("entry:view", "台账与附表 · 查看（旧版）"), Map.entry("entry:edit", "事后录入（旧版）"),
        Map.entry("book-template:edit", "账册模板编辑（旧版）"), Map.entry("book-template:switch", "更换账册版本（旧版）"),
        Map.entry("report:view", "报表 · 查看（旧版）"), Map.entry("report:edit", "账簿报表（旧版）"),
        Map.entry("analysis:view", "经营分析 · 查看（旧版）"),
        Map.entry("system:view", "系统管理 · 查看（旧版）"), Map.entry("system:edit", "系统管理 · 管理（旧版）"));

    /** 权限点的人话名。给人看的地方一律走它 —— 弹窗里出现 `bill-notices:issue` 等于没说。 */
    public static String label(String perm) {
        Meta m = META_BY_KEY.get(perm);
        if (m != null) return m.label();
        String legacy = LEGACY_LABELS.get(perm);
        return legacy != null ? legacy : perm;
    }

    /**
     * **不可提权**(RBAC-SPEC §15.2,原则同 v3):
     *  · 全部查看:借得到的话「工资只给两个人看」就成了一句话的事;ReadAccessManager 也不查 ElevationStore。
     *  · 系统管理层三屏的全部动作:一次 30 分钟的授权就能换一个永久管理员账号,整套 RBAC 当场作废。
     *  · salary:edit:隐含工资查看,拆出来就是为了「看不见工资的人写不了工资」。
     *  · 审核 / 编辑锁授权 / 可请求提权:借审核权 = 录审分离作废;后两项只会让提权自我授权。
     */
    private static final Set<String> NOT_ELEVATABLE;
    static {
        Set<String> s = new HashSet<>(List.of(SALARY_EDIT, REVIEW_APPROVE, LOCK_TAKEOVER, ELEVATE_REQUEST));
        for (Meta m : META) if ("view".equals(m.kind()) || isSystem(m.key())) s.add(m.key());
        NOT_ELEVATABLE = Set.copyOf(s);
    }

    public static boolean elevatable(String perm) { return exists(perm) && !NOT_ELEVATABLE.contains(perm); }

    /** 写 → 本屏查看(编辑或专有动作隐含本屏查看;不跨屏)。从 META 推出。 */
    public static final Map<String, String> IMPLIED_VIEW;
    static {
        Map<String, String> out = new HashMap<>();
        for (Meta m : META) if (isWrite(m.key())) out.put(m.key(), m.screen() + ":view");
        IMPLIED_VIEW = Map.copyOf(out);
    }

    /** 权限点集合并上它们隐含的查看。UserPermissionCache 装载快照时调,不落库。 */
    public static Set<String> withImplied(Collection<String> perms) {
        Set<String> out = new HashSet<>(perms);
        for (String p : perms) {
            String v = IMPLIED_VIEW.get(p);
            if (v != null) out.add(v);
        }
        return out;
    }

    /** 数据层 17 屏的查看(本月出账到办公·三期水电,不含导入中心):只给租户别名明文用(TenantService)。 */
    public static final List<String> DATA_SCREEN_VIEWS = SCREENS.stream()
        .filter(s -> "data".equals(s.layer()) && !"import".equals(s.value()))
        .map(s -> s.value() + ":view").toList();

    private static final Map<String, Integer> ORDER = new LinkedHashMap<>();
    static { for (int i = 0; i < ALL.size(); i++) ORDER.put(ALL.get(i), i); }

    /** 按 ALL 的顺序比;不认识的排最后。 */
    public static final Comparator<String> BY_ALL = Comparator.comparingInt(p -> ORDER.getOrDefault(p, Integer.MAX_VALUE));

    /**
     * 403 与置灰文案里「需要什么」(RBAC-SPEC §15.6,K10):一个接口被十几屏共用时,不把十几个屏名糊进一句。
     * 1 项「A」;2–3 项「A」或「B」其中一项;4 项及以上「A」「B」等 N 项中的任一项(按 ALL 顺序取前两项)。
     */
    public static String needText(Collection<String> perms) {
        List<String> q = perms.stream().distinct().sorted(BY_ALL).map(p -> "「" + label(p) + "」").toList();
        if (q.size() <= 1) return q.isEmpty() ? "" : q.get(0);
        if (q.size() <= 3) return String.join("或", q) + "其中一项";
        return q.get(0) + q.get(1) + "等 " + q.size() + " 项中的任一项";
    }
}
