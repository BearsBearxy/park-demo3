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

    /** 全部 13 个。角色屏的勾选矩阵按这个顺序渲染;覆盖率测试也拿它校验映射表不引用不存在的权限。 */
    public static final List<String> ALL = List.of(
        MASTER_EDIT, CONTRACT_EDIT, PARAM_POLICY_EDIT, PARAM_MONTHLY_EDIT,
        METER_MASTER_EDIT, METER_READING_EDIT, BILLING_RUN_EDIT, BILLING_ISSUE_EDIT,
        ENTRY_EDIT, REPORT_EDIT, SYSTEM_VIEW, SYSTEM_EDIT, LOCK_TAKEOVER);

    private static final Set<String> ALL_SET = Set.copyOf(ALL);

    public static boolean exists(String perm) { return ALL_SET.contains(perm); }

    /** 角色权限矩阵屏用的人话名 + 一句说明。**前端不许硬编码这 13 项** —— 加第 14 个时它要自动出现。 */
    public record Meta(String key, String label, String hint) {}

    public static final List<Meta> META = List.of(
        new Meta(MASTER_EDIT,        "主数据",          "楼栋、单元、租户、公司与收款账户的档案维护"),
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
        new Meta(LOCK_TAKEOVER,      "编辑锁 · 授权",   "别人正在编辑时，授权他人接管（不是自己接管）"));
}
