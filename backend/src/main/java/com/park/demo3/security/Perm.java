package com.park.demo3.security;

import java.util.Collection;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 权限点常量表(RBAC-SPEC v2 §2)。**权限点由代码定义,角色→权限点的映射才是数据。**
 * 客户在角色屏能随意配角色,但配不出这里没有的权限 —— 这条分工线是整套设计的核心。
 *
 * v3(2026-10-04 用户拍板,RBAC-SPEC §11)推翻了 v2 的「读全开」:每个模块「查看 / 编辑」两项,
 * 编辑隐含同组查看({@link #withImplied},装载快照时展开,不落库);经营分析的查看不被任何编辑隐含,
 * 工资的查看只被「工资录入」({@link #SALARY_EDIT})隐含 —— 事后录入不带出工资。
 * GET /api/** 默认拒绝,读规则表在 PermissionRegistry,判定在 ReadAccessManager。
 */
public final class Perm {
    private Perm() {}

    public static final String MASTER_EDIT         = "master:edit";
    public static final String CONTRACT_EDIT       = "contract:edit";
    public static final String PARAM_POLICY_EDIT   = "param-policy:edit";
    public static final String PARAM_MONTHLY_EDIT  = "param-monthly:edit";
    public static final String METER_MASTER_EDIT   = "meter-master:edit";
    public static final String METER_READING_EDIT  = "meter-reading:edit";
    public static final String BILLING_RUN_EDIT    = "billing-run:edit";
    public static final String BILLING_ISSUE_EDIT  = "billing-issue:edit";
    public static final String ENTRY_EDIT          = "entry:edit";
    public static final String REPORT_EDIT         = "report:edit";
    public static final String SYSTEM_VIEW         = "system:view";
    public static final String SYSTEM_EDIT         = "system:edit";
    public static final String LOCK_TAKEOVER       = "lock:takeover";

    // ═══ v3 查看点(2026-10-04 用户拍板):编辑隐含同组查看;ANALYSIS_VIEW 不被任何编辑隐含,SALARY_VIEW 只被 SALARY_EDIT 隐含 ═══
    public static final String MASTER_VIEW   = "master:view";     // 楼栋、单元、租户、租户分类、公司与收款账户
    public static final String CONTRACT_VIEW = "contract:view";
    public static final String PARAM_VIEW    = "param:view";      // 计费口径、月度电价、公摊规则、电价配置、系数簿
    public static final String METER_VIEW    = "meter:view";      // 园区抄表、光伏分栋、充电桩
    public static final String BILLING_VIEW  = "billing:view";    // 公共电核算/公摊、账单、催缴单
    public static final String ENTRY_VIEW    = "entry:view";      // 台账与附表;不含工资
    public static final String SALARY_VIEW   = "salary:view";     // 工资:entry:edit 不隐含它
    public static final String REPORT_VIEW   = "report:view";     // 三大报表、损益附表、收入核对
    public static final String ANALYSIS_VIEW = "analysis:view";   // 经营分析层,独立放行
    // 工资录入(用户 2026-10-04 拍板「按你推荐」,RBAC-SPEC §11.8):工资的写从 entry:edit 拆出来。
    // 之前写挂 entry:edit,看不见工资的财务专员照样能经导入中心写这张表。隐含 salary:view;不可提权(见 NOT_ELEVATABLE)
    public static final String SALARY_EDIT   = "salary:edit";

    /** 数据层任一查看(不含 report / analysis):本月出账与出账链月索引的读门(PermissionRegistry),租户别名明文(TenantService)。 */
    public static final List<String> DATA_LAYER_VIEWS = List.of(
        MASTER_VIEW, CONTRACT_VIEW, PARAM_VIEW, METER_VIEW, BILLING_VIEW, ENTRY_VIEW, SALARY_VIEW);

    /** 权限点的人话名。给人看的地方一律走它 —— 弹窗里出现 `param-policy:edit` 等于没说。 */
    public static String label(String perm) {
        return META.stream().filter(m -> m.key().equals(perm)).map(Meta::label).findFirst().orElse(perm);
    }
    public static final String ELEVATE_REQUEST     = "elevate:request";
    // 第 15 点(2026-08-24 用户拍板):新增/删除记账公司=建删账册(BOOK-WORKBENCH §9 对偶动作),
    // 独立于 master:edit —— 公司改名/收款账户仍归主数据,建司删司是更重的动作单独放权
    public static final String COMPANY_MANAGE      = "company:manage";
    // 第 16 点(2026-08-24 用户拍板):账册模板编辑(改列名/别名/增删列/升版/回滚)——
    // 模板入口移出页面编辑模式独立成配置面板,面板内有自己的编辑门走本权限;查看历史版本只要 entry:view(v3)
    public static final String BOOK_TEMPLATE_EDIT  = "book-template:edit";
    // 第 17 点(2026-08-26 用户拍板):更换账册版本 —— 换一套别人的列,与第 16 点「在本月微调列名」
    // 是两种风险,故分权。已录入的月份两者都拒(录入即冻结),这个点只对空月有意义
    public static final String BOOK_TEMPLATE_SWITCH = "book-template:switch";
    // 第 18 点(2026-09-03 用户拍板):审核通过 / 退回 / 撤销某张表某个月(SIDEBAR-UX-REDESIGN §7)。
    // 与「录」彻底分开的一档:录审分离靠角色分配保证(六个既有角色权限不变,财务主管默认不带审核权,D16);
    // 不给这项的账号在清单行上看不到「通过/退回/撤销」,而已审核的表任何人都改不了
    public static final String REVIEW_APPROVE      = "review:approve";

    /**
     * 全部 28 个,按模块分组排(与 META 同序)。角色屏的勾选矩阵按这个顺序渲染;
     * 覆盖率测试也拿它校验映射表不引用不存在的权限。
     */
    public static final List<String> ALL = List.of(
        MASTER_VIEW, MASTER_EDIT, COMPANY_MANAGE,
        CONTRACT_VIEW, CONTRACT_EDIT,
        PARAM_VIEW, PARAM_POLICY_EDIT, PARAM_MONTHLY_EDIT,
        METER_VIEW, METER_MASTER_EDIT, METER_READING_EDIT,
        BILLING_VIEW, BILLING_RUN_EDIT, BILLING_ISSUE_EDIT,
        ENTRY_VIEW, ENTRY_EDIT, BOOK_TEMPLATE_EDIT, BOOK_TEMPLATE_SWITCH,
        SALARY_VIEW, SALARY_EDIT,
        REPORT_VIEW, REPORT_EDIT,
        ANALYSIS_VIEW,
        SYSTEM_VIEW, SYSTEM_EDIT,
        REVIEW_APPROVE, LOCK_TAKEOVER, ELEVATE_REQUEST);

    private static final Set<String> ALL_SET = Set.copyOf(ALL);

    public static boolean exists(String perm) { return ALL_SET.contains(perm); }

    /**
     * **不可提权的权限点**（用户拍板 2026-08-22）。
     *
     * system:* 必须留在名单里:能当场授权自己去建账号 / 改角色的话,提权就成了权限系统的后门 ——
     * 一次 30 分钟的授权可以换来一个永久的管理员账号,整套 RBAC 当场作废。
     * 系统管理只能主管自己登录进去改。
     *
     * elevate:request 与 lock:takeover 同理列入:提权这两项只会让提权机制自我授权,毫无业务意义。
     *
     * review:approve 同理(2026-09-03,SIDEBAR-UX-REDESIGN §7.3):审核能当场借 30 分钟的话,
     * 「录审分离」当场作废 —— 录入方可以请主管借一次审核权,把自己刚录的东西审掉。
     *
     * 全部 *:view 同理(v3 规则 6,2026-10-04):查看权借得到,「工资只给两个人看」就成了一句话的事 ——
     * 请主管授权 30 分钟,整年工资明细就导走了。ReadAccessManager 也不查 ElevationStore。
     *
     * salary:edit 同理(用户 2026-10-04 拍板「按你推荐」):它隐含 salary:view,工资的写拆出来就是为了
     * 「看不见工资的人写不了工资」—— 借得到的话,财务专员请主管授权一次又能往看不见的表里导数。
     */
    private static final Set<String> NOT_ELEVATABLE = Set.of(
        SYSTEM_VIEW, SYSTEM_EDIT, ELEVATE_REQUEST, LOCK_TAKEOVER, REVIEW_APPROVE,
        MASTER_VIEW, CONTRACT_VIEW, PARAM_VIEW, METER_VIEW, BILLING_VIEW, ENTRY_VIEW,
        SALARY_VIEW, REPORT_VIEW, ANALYSIS_VIEW, SALARY_EDIT);

    public static boolean elevatable(String perm) { return exists(perm) && !NOT_ELEVATABLE.contains(perm); }

    /**
     * 角色权限矩阵屏用的人话名 + 一句说明 + 模块键 + 种类。**前端不许硬编码这些权限点** —— 加一个时它要自动出现。
     *
     * group 取值固定:master contract param meter billing entry salary report analysis system other。
     * kind:'view' | 'edit' | 'other'。矩阵按 group 分行、按 kind 分「查看 / 编辑」两列;other 组是跨模块的点。
     * 每个业务 group 恰好一个 view —— 「编辑隐含查看」就是从这里推出来的({@link #IMPLIED_VIEW})。
     */
    public record Meta(String key, String label, String hint, String group, String kind) {}

    public static final List<Meta> META = List.of(
        new Meta(MASTER_VIEW,        "主数据 · 查看",   "楼栋、单元、租户、租户分类、公司与收款账户；没有这项时，租户联系人与收款账号显示为打码值（催缴单导出除外，有「出账与催缴单 · 查看」就印完整账号）", "master", "view"),
        new Meta(MASTER_EDIT,        "主数据",          "楼栋、单元、租户、公司改名与收款账户的档案维护", "master", "edit"),
        new Meta(COMPANY_MANAGE,     "公司/账册管理",   "新增与删除记账公司（建司即建台账册；删除连同其全部台账、报表数据，不可恢复）", "master", "edit"),
        new Meta(CONTRACT_VIEW,      "合同 · 查看",     "合同列表、合同详情与租金计费行", "contract", "view"),
        new Meta(CONTRACT_EDIT,      "合同",            "新增、编辑、续签、终止、删除；含租金计费行（单价口径）", "contract", "edit"),
        new Meta(PARAM_VIEW,         "计费参数 · 查看", "计费口径、月度电价、公摊规则、电价配置、系数簿", "param", "view"),
        new Meta(PARAM_POLICY_EDIT,  "计费口径",        "常量与规则参数、公摊规则、电价配置、收款指引、催缴单系数簿", "param", "edit"),
        new Meta(PARAM_MONTHLY_EDIT, "月度计费录入",    "每月录入的电价、调整量等月度计费数", "param", "edit"),
        new Meta(METER_VIEW,         "抄表 · 查看",     "园区抄表与表档案、光伏分栋、充电桩", "meter", "view"),
        new Meta(METER_MASTER_EDIT,  "表档案",          "表倍率、表与合同的绑定、删表、光伏电站与充电桩桩库", "meter", "edit"),
        new Meta(METER_READING_EDIT, "抄表",            "读数录入、修改、导入、按年模拟填充", "meter", "edit"),
        new Meta(BILLING_VIEW,       "出账与催缴单 · 查看", "公共电核算与公摊、楼栋损耗、催缴单", "billing", "view"),
        new Meta(BILLING_RUN_EDIT,   "出账运行",        "公共电核算与损耗生成、重算、催缴单生成、单据备注", "billing", "edit"),
        new Meta(BILLING_ISSUE_EDIT, "催缴单签发",      "确认、签发、作废、标记已导出、改收款公司槽（对外不可逆动作）", "billing", "edit"),
        new Meta(ENTRY_VIEW,         "台账与附表 · 查看", "月度台账、附表 6/7/8/10/11、办公三期水电、电费成本；附表 12 工资明细的查看与录入在「工资」那一行另勾", "entry", "view"),
        new Meta(ENTRY_EDIT,         "事后录入",        "月度台账、附表 6/7/8/10/11、办公三期水电、年度预算导入；不含附表 12 工资", "entry", "edit"),
        new Meta(BOOK_TEMPLATE_EDIT, "账册模板编辑",     "改列名/别名/列宽、增删自定义列、隐藏与列序（升版）、回滚版本；查看历史版本不需此权限", "entry", "edit"),
        new Meta(BOOK_TEMPLATE_SWITCH, "更换账册版本", "为某个月份切换使用哪一版账册模板;已录入数据的月份不可切", "entry", "edit"),
        new Meta(SALARY_VIEW,        "工资 · 查看",     "逐人逐月工资明细；勾「工资录入」会自动带上，别的编辑权都不包含这一项", "salary", "view"),
        new Meta(SALARY_EDIT,        "工资录入",        "附表 12 工资明细的新增、改备注、删除与导入（含导入中心）；不能请主管当场授权", "salary", "edit"),
        new Meta(REPORT_VIEW,        "报表 · 查看",     "三大报表、损益附表 1–5、收入核对", "report", "view"),
        new Meta(REPORT_EDIT,        "账簿报表",        "三大报表、损益附表 1–5、收入核对的处置标记", "report", "edit"),
        new Meta(ANALYSIS_VIEW,      "经营分析 · 查看", "经营分析层各屏；不需要各模块的查看权，联系人电话与收款账号照样打码", "analysis", "view"),
        new Meta(SYSTEM_VIEW,        "系统管理 · 查看", "能看到用户列表、角色配置与操作日志", "system", "view"),
        new Meta(SYSTEM_EDIT,        "系统管理 · 管理", "新建/停用账号、配置角色权限", "system", "edit"),
        new Meta(REVIEW_APPROVE,     "审核",            "通过 / 退回 / 撤销某张表某个月的审核；已审核的表任何人都改不了，只有审核员能撤销", "other", "other"),
        new Meta(LOCK_TAKEOVER,      "编辑锁 · 授权",   "别人正在编辑时，授权他人接管（不是自己接管）", "other", "other"),
        new Meta(ELEVATE_REQUEST,    "可请求提权",      "遇到没权限的操作时，能请主管当场输密码授权 30 分钟；不给这项的账号连编辑模式按钮都看不到", "other", "other"));

    /**
     * 编辑 → 它隐含的查看(v3 规则 1)。从 META 推出:同 group 里 kind=edit 的点 → 该 group 的 view。
     * analysis 组没有 edit,所以 analysis:view 不被任何点隐含;salary 组只有 salary:edit,所以 salary:view
     * 只被它隐含 —— entry:edit 不带出工资。这正是设计要的。
     * ⚠ 必须声明在 META 之后:静态初始化按源码顺序走。
     */
    public static final Map<String, String> IMPLIED_VIEW;
    static {
        Map<String, String> viewOf = new HashMap<>();
        for (Meta m : META) if ("view".equals(m.kind())) viewOf.put(m.group(), m.key());
        Map<String, String> out = new HashMap<>();
        for (Meta m : META) {
            if ("edit".equals(m.kind()) && viewOf.containsKey(m.group())) out.put(m.key(), viewOf.get(m.group()));
        }
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
}
