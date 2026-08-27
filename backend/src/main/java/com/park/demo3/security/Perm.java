package com.park.demo3.security;

import java.util.List;
import java.util.Set;

/**
 * 权限点常量表(RBAC-SPEC v2 §2)。**权限点由代码定义,角色→权限点的映射才是数据。**
 * 客户在角色屏能随意配角色,但配不出这里没有的权限 —— 这条分工线是整套设计的核心。
 *
 * v2 核心模型是「读全开,写分权」:GET /api/** 任何已登录账号放行,所以这里
 * **没有任何业务模块的 :view**。唯一的读权限点是 SYSTEM_VIEW(用户列表/角色配置/操作日志)。
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

    /** 权限点的人话名。给人看的地方一律走它 —— 弹窗里出现 `param-policy:edit` 等于没说。 */
    public static String label(String perm) {
        return META.stream().filter(m -> m.key().equals(perm)).map(Meta::label).findFirst().orElse(perm);
    }
    public static final String ELEVATE_REQUEST     = "elevate:request";
    // 第 15 点(2026-08-24 用户拍板):新增/删除记账公司=建删账册(BOOK-WORKBENCH §9 对偶动作),
    // 独立于 master:edit —— 公司改名/收款账户仍归主数据,建司删司是更重的动作单独放权
    public static final String COMPANY_MANAGE      = "company:manage";
    // 第 16 点(2026-08-24 用户拍板):账册模板编辑(改列名/别名/增删列/升版/回滚)——
    // 模板入口移出页面编辑模式独立成配置面板,面板内有自己的编辑门走本权限;查看历史版本全员可看
    public static final String BOOK_TEMPLATE_EDIT  = "book-template:edit";
    // 第 17 点(2026-08-26 用户拍板):更换账册版本 —— 换一套别人的列,与第 16 点「在本月微调列名」
    // 是两种风险,故分权。已录入的月份两者都拒(录入即冻结),这个点只对空月有意义
    public static final String BOOK_TEMPLATE_SWITCH = "book-template:switch";

    /** 全部 17 个。角色屏的勾选矩阵按这个顺序渲染;覆盖率测试也拿它校验映射表不引用不存在的权限。 */
    public static final List<String> ALL = List.of(
        MASTER_EDIT, COMPANY_MANAGE, BOOK_TEMPLATE_EDIT, BOOK_TEMPLATE_SWITCH,
        CONTRACT_EDIT, PARAM_POLICY_EDIT, PARAM_MONTHLY_EDIT,
        METER_MASTER_EDIT, METER_READING_EDIT, BILLING_RUN_EDIT, BILLING_ISSUE_EDIT,
        ENTRY_EDIT, REPORT_EDIT, SYSTEM_VIEW, SYSTEM_EDIT, LOCK_TAKEOVER, ELEVATE_REQUEST);

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
     */
    private static final Set<String> NOT_ELEVATABLE = Set.of(
        SYSTEM_VIEW, SYSTEM_EDIT, ELEVATE_REQUEST, LOCK_TAKEOVER);

    public static boolean elevatable(String perm) { return exists(perm) && !NOT_ELEVATABLE.contains(perm); }

    /** 角色权限矩阵屏用的人话名 + 一句说明。**前端不许硬编码这 13 项** —— 加第 14 个时它要自动出现。 */
    public record Meta(String key, String label, String hint) {}

    public static final List<Meta> META = List.of(
        new Meta(MASTER_EDIT,        "主数据",          "楼栋、单元、租户、公司改名与收款账户的档案维护"),
        new Meta(COMPANY_MANAGE,     "公司/账册管理",   "新增与删除记账公司（建司即建台账册；删除连同其全部台账、报表数据，不可恢复）"),
        new Meta(BOOK_TEMPLATE_EDIT, "账册模板编辑",     "改列名/别名/列宽、增删自定义列、隐藏与列序（升版）、回滚版本；查看历史版本不需此权限"),
        new Meta(BOOK_TEMPLATE_SWITCH, "更换账册版本", "为某个月份切换使用哪一版账册模板;已录入数据的月份不可切"),
        new Meta(CONTRACT_EDIT,      "合同",            "新增、编辑、续签、终止、删除；含租金计费行（单价口径）"),
        new Meta(PARAM_POLICY_EDIT,  "计费口径",        "常量与规则参数、公摊规则、电价配置、收款指引、催缴单系数簿"),
        new Meta(PARAM_MONTHLY_EDIT, "月度计费录入",    "每月照抄供电局账单的 13 项电价与调整量；不给这项，催缴单出不了账"),
        new Meta(METER_MASTER_EDIT,  "表档案",          "表倍率、表与合同的绑定、删表、光伏电站与充电桩桩库"),
        new Meta(METER_READING_EDIT, "抄表",            "读数录入、修改、导入、按年模拟填充"),
        new Meta(BILLING_RUN_EDIT,   "出账运行",        "公共电核算与损耗生成、重算、催缴单生成、单据备注"),
        new Meta(BILLING_ISSUE_EDIT, "催缴单签发",      "确认、签发、作废、标记已导出、改收款公司槽（对外不可逆动作）"),
        new Meta(ENTRY_EDIT,         "事后录入",        "月度台账、附表 6/7/8/10/11/12、办公三期水电、年度预算导入"),
        new Meta(REPORT_EDIT,        "账簿报表",        "三大报表、损益附表 1–5、收入核对的处置标记"),
        new Meta(SYSTEM_VIEW,        "系统管理 · 查看", "能看到用户列表、角色配置与操作日志"),
        new Meta(SYSTEM_EDIT,        "系统管理 · 管理", "新建/停用账号、配置角色权限"),
        new Meta(LOCK_TAKEOVER,      "编辑锁 · 授权",   "别人正在编辑时，授权他人接管（不是自己接管）"),
        new Meta(ELEVATE_REQUEST,    "可请求提权",      "遇到没权限的操作时，能请主管当场输密码授权 30 分钟；不给这项的账号连编辑模式按钮都看不到"));
}
