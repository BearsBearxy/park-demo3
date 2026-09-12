package com.park.demo3.security;

import org.springframework.http.HttpMethod;
import org.springframework.http.server.PathContainer;
import org.springframework.stereotype.Component;
import org.springframework.web.util.pattern.PathPattern;
import org.springframework.web.util.pattern.PathPatternParser;

import java.util.ArrayList;
import java.util.List;

/**
 * 「写端点 → 权限点」映射表(RBAC-SPEC v2 §5.2)。只管非 GET —— 读全开。
 *
 * 三条铁律(每条都是查证过会踩的坑,改这个文件前先读 RBAC-SPEC §5.2):
 *  1. **按 path segment 匹配,不是字符串前缀**。用 PathPattern,不是 startsWith。
 *     若写成 startsWith("/api/elec"),PUT /api/elec-cost/price-cfg 会落到 entry —— 录入员
 *     直接拿到四个电价键的写权限。同型隐患:/api/pv ⊂ /api/pv-meter、/api/bills 与
 *     /api/bill-notices、/api/salary/import 与 /api/salary/imported。
 *  2. **最长字面前缀优先**:表是有序的,首个命中生效,具体规则必须排在 catch-all 之前。
 *  3. **默认拒绝**:表里没有的写路径一律 403(resolve 返回 null → SecurityConfig 拒)。
 *
 * ⚠ 唯一一条 URL 判不了的规则:PUT /api/params 的 13 个 monthlyCheck 月度键归 param-monthly,
 *   其余键归 param-policy。URL 层放行「两者任一」,细分在 ParamService 里按 cfg_key 判。
 */
@Component
public class PermissionRegistry {

    /** 命中但不要求任何权限点 —— 任何已登录账号可写。目前只有 POST /api/import-log。 */
    public static final String ANY_AUTHENTICATED = "*";

    private record Rule(HttpMethod method, PathPattern pattern, List<String> anyOf) {}

    private final List<Rule> rules = new ArrayList<>();
    private final PathPatternParser parser = PathPatternParser.defaultInstance;

    public PermissionRegistry() {
        // ═══ 任意已登录可写 ═══
        // 9 个导入屏共用这一个端点(importRegistry.ts 在每次导入成功后统一调)。挂 entry:edit 的话,
        // 只有 meter-reading:edit 的人导完表会被 403 —— 而前端是 catch+console.warn 吞掉的,
        // 用户毫无感知,审计痕迹静默丢失。
        add(HttpMethod.POST, "/api/import-log", ANY_AUTHENTICATED);
        // 本人改密:任何已登录账号都能改自己的。不登记的话按「默认拒绝」会 403 ——
        // 首次强制改密的账号会被卡死在改密页(它是他唯一能去的地方,却提交不了)。
        add(HttpMethod.POST, "/api/auth/change-password", ANY_AUTHENTICATED);
        // 登出只作废自己的令牌(用名取自 SecurityContext,不收入参),任何已登录账号都能调
        add(HttpMethod.POST, "/api/auth/logout", ANY_AUTHENTICATED);
        // 结束自己的提权授权:幂等、只影响自己,任何人可调。放在 POST /elevate 之前 —— 方法不同不冲突,
        // 但顺序表读起来要一眼看出这两条是一对。
        add(HttpMethod.DELETE, "/api/auth/elevate", ANY_AUTHENTICATED);
        // 请求提权本身是一道门:viewer / 园区股东没有 elevate:request,连问都不能问。
        // 具体授权哪些权限点由 ElevationService 校验(不可提权名单见 Perm.elevatable)。
        add(HttpMethod.POST, "/api/auth/elevate", Perm.ELEVATE_REQUEST);
        // 远程授权(设计稿 §07)。发起请求与当场授权同一道门:viewer / 园区股东连问都不能问。
        // ⚠ 必须排在 /api/auth/elevate 之后、但两条 POST 路径不同,互不遮挡;
        //   「批准」那一下不挂 elevate:request —— 批准人凭的是他**本人真有那几个权限**
        //   (ApprovalService 逐条校验),而不是「能不能请求提权」。
        add(HttpMethod.POST, "/api/auth/approvals", Perm.ELEVATE_REQUEST);
        add(HttpMethod.POST, "/api/auth/approvals/**", ANY_AUTHENTICATED);

        // 编辑锁(CONCURRENCY-SPEC §4.4)。这里放行到「任何已登录账号」,具体的门在 LockService:
        // 一个 :edit 权都没有的账号占锁毫无意义,只会变成谁都解不开的堵。
        //
        // ⚠ 为什么不在这里按 scope 映射权限点:scope 是 `模块:标识:期` 的自由字符串,
        //   URL 层解不出它对应哪一档权限。而**锁不是安全边界** —— 126 个写端点仍由
        //   WriteAccessManager 逐个把守,拿到锁也写不了自己没权限的东西。
        add(null, "/api/locks/**", ANY_AUTHENTICATED);

        // 在场心跳(PRESENCE §02)。任何已登录账号都要发 —— 浏览态也发,顶栏头像组靠它。
        // 只读账号也在场:他在看哪一屏是有用信息(「赵总在看经营分析」),而他本来就写不了任何东西。
        add(null, "/api/presence/**", ANY_AUTHENTICATED);

        // ═══ 出账链:同一 controller 前缀下混着口径与运行两档 ═══
        add(null, "/api/alloc/rules",        Perm.PARAM_POLICY_EDIT);
        add(null, "/api/alloc/rules/**",     Perm.PARAM_POLICY_EDIT);
        add(null, "/api/alloc/cfg",          Perm.PARAM_POLICY_EDIT);
        add(null, "/api/alloc/**",           Perm.BILLING_RUN_EDIT);

        // recalc 不写任何参数表:ParamService.recalc() 内部就是 alloc.generate + billNotice.generate,
        // 语义与 /alloc/generate 完全同级。按 controller 归 param 会让专员重算不了,出账链断在这步。
        add(HttpMethod.POST, "/api/params/recalc", Perm.BILLING_RUN_EDIT);
        add(null, "/api/params",     Perm.PARAM_POLICY_EDIT, Perm.PARAM_MONTHLY_EDIT);
        add(null, "/api/params/**",  Perm.PARAM_POLICY_EDIT, Perm.PARAM_MONTHLY_EDIT);
        // 「复制上月电价」只搬 ELEC_KEYS 六个月变电价键 —— 是月度录入的活,不是改口径。
        // 挂 policy 的话财务专员在计费参数页 ① 区看得到按钮、点下去 403(前端按 param-monthly 画的按钮)。
        // ⚠ 必须排在 /api/price-cfg/** 之前:首个命中生效(本文件铁律 2)。
        add(HttpMethod.POST, "/api/price-cfg/copy", Perm.PARAM_MONTHLY_EDIT);
        add(null, "/api/price-cfg",    Perm.PARAM_POLICY_EDIT);
        add(null, "/api/price-cfg/**", Perm.PARAM_POLICY_EDIT);

        // ═══ 电费成本:price-cfg 是口径,其余是录入 ═══
        add(null, "/api/elec-cost/price-cfg", Perm.PARAM_POLICY_EDIT);
        // simulate 里 insertCfgIfAbsent() 会往 elec_price_cfg 插行 —— 只收紧 price-cfg
        // 而放开 simulate,param 门形同虚设。
        add(HttpMethod.POST, "/api/elec-cost/simulate", Perm.PARAM_POLICY_EDIT);
        add(null, "/api/elec-cost/**", Perm.ENTRY_EDIT);

        // ═══ 账单 / 催缴单:生成与签发两档 ═══
        add(null, "/api/bills/paymap", Perm.BILLING_ISSUE_EDIT);
        add(null, "/api/bills/**",     Perm.BILLING_RUN_EDIT);
        add(null, "/api/bill-notices/confirm",        Perm.BILLING_ISSUE_EDIT);
        add(null, "/api/bill-notices/mark-exported",  Perm.BILLING_ISSUE_EDIT);
        add(null, "/api/bill-notices/{id}/issue",     Perm.BILLING_ISSUE_EDIT);
        add(null, "/api/bill-notices/{id}/void",      Perm.BILLING_ISSUE_EDIT);
        add(null, "/api/bill-notices/**",             Perm.BILLING_RUN_EDIT);

        // ═══ 抄表:读数与表档案两档 ═══
        // ⚠ DELETE /api/meters/readings 默认 cascade=true + dropEmptyMeters=true,会顺手删该月
        //   alloc_pool_result / alloc_pool_meter_result / alloc_loss_result / alloc_result 派生快照
        //   并删空表档案。它落 meter-reading 是刻意的(抄表员重导当月要用),破坏力已在 SPEC §5.3-④ 记明。
        add(null, "/api/meters/readings",    Perm.METER_READING_EDIT);
        add(null, "/api/meters/readings/**", Perm.METER_READING_EDIT);
        // ⚠ 抄表导入必须显式排在 /api/meters/** 之前,否则被 meter-master 吃掉 ——
        //   财务专员在导入中心看得见「园区抄表」磁贴、点下去 403(RBAC-SPEC §2:导入属 meter-reading)
        add(HttpMethod.POST, "/api/meters/import", Perm.METER_READING_EDIT);
        add(null, "/api/meters",    Perm.METER_MASTER_EDIT);
        add(null, "/api/meters/**", Perm.METER_MASTER_EDIT);

        // 电站档案含单价字段,改它直接决定此后所有 pv_reading 的 price_snap 计价快照
        add(null, "/api/pv-meter/stations",    Perm.METER_MASTER_EDIT);
        add(null, "/api/pv-meter/stations/**", Perm.METER_MASTER_EDIT);
        // simulate 会给单价为空的电站反推写入 price_yuan —— 与 elec-cost/simulate 同型的写旁路
        add(HttpMethod.POST, "/api/pv-meter/simulate", Perm.METER_MASTER_EDIT);
        add(null, "/api/pv-meter/**", Perm.METER_READING_EDIT);

        // 桩库档案改运营商/车型会迁移甚至删除历史 cp_power_usage 行
        add(null, "/api/cp-meter/stations",    Perm.METER_MASTER_EDIT);
        add(null, "/api/cp-meter/stations/**", Perm.METER_MASTER_EDIT);
        // cp 的 simulate 是「读附表7/8 整年批量派生」,等同跑一次出结果,不是录一条抄表
        add(HttpMethod.POST, "/api/cp-meter/simulate", Perm.BILLING_RUN_EDIT);
        add(null, "/api/cp-meter/**", Perm.METER_READING_EDIT);

        // ═══ 预算:数据域属分析,但挂在导入中心由录入岗执行(拍板 #9) ═══
        add(HttpMethod.POST, "/api/budget/import", Perm.ENTRY_EDIT);

        // ═══ 账册模板写端点(第16点 book-template:edit,2026-08-24 拍板):
        //     模板改动独立于事后录入——录入员没这点就只能看不能改模板;GET 读全开 ═══
        add(HttpMethod.PUT,  "/api/books/*/template",          Perm.BOOK_TEMPLATE_EDIT);
        // 换版本走第17点 book-template:switch(2026-08-26 拍板):换一套别人的列、和在本月微调列名,
        // 是两种风险,故分权。第16点不蕴含第17点 —— 只勾模板编辑的人切不了版。
        add(HttpMethod.POST, "/api/books/*/template/pin",      Perm.BOOK_TEMPLATE_SWITCH);

        // ═══ 审核端点(第18点 review:approve,2026-09-03 拍板;SIDEBAR-UX-REDESIGN §7.3)═══
        //     submit 要哪个权限点取决于 key 里的 kind(params 是 policy|monthly 两档、其余多为 entry),
        //     URL 层判不出来 —— 照 PUT /api/params 那条既有例外:这里放行「任一相关 edit 权」,
        //     真正的 kind→perm 判定下沉到 ReviewService.submit(表在 ReviewKind.perms())。
        //     GET /api/review 不登记:本表只管非 GET,读全开。
        add(HttpMethod.POST, "/api/review/*/submit",
            Perm.PARAM_POLICY_EDIT, Perm.PARAM_MONTHLY_EDIT, Perm.METER_READING_EDIT,
            Perm.BILLING_RUN_EDIT, Perm.ENTRY_EDIT);
        //     撤回(R4)与 submit **同源**:同为录入方的动作,同样是「任一相关 edit 权」,
        //     kind→perm 与「只能撤自己交的」都下沉到 ReviewService.recall。故参数逐字同上一条。
        //     ⚠ 既有缺口,这里照抄就原样继承:两条都**没有 Perm.REPORT_EDIT**,而三大报表那三把键
        //     (ReviewKind.REPORT_IS/BS/TB)要的正是 report:edit —— 只有 report:edit 的窄权限账号
        //     在 URL 层就 403,交不了也撤不了报表的审。预置角色里 report:edit 恒与 entry:edit 同现
        //     (admin / finance_manager / finance_clerk),所以今天打不着;客户自建一个「只录报表」的
        //     角色就会踩上。不在本期改(改的是 submit 的既有行为),记在 spec §12。
        add(HttpMethod.POST, "/api/review/*/recall",
            Perm.PARAM_POLICY_EDIT, Perm.PARAM_MONTHLY_EDIT, Perm.METER_READING_EDIT,
            Perm.BILLING_RUN_EDIT, Perm.ENTRY_EDIT);
        add(HttpMethod.POST, "/api/review/*/approve",  Perm.REVIEW_APPROVE);
        add(HttpMethod.POST, "/api/review/*/return",   Perm.REVIEW_APPROVE);
        add(HttpMethod.POST, "/api/review/*/withdraw", Perm.REVIEW_APPROVE);

        // ═══ 公司建/删 = 建删账册(第15点 company:manage,2026-08-24 拍板):
        //     必须排在主数据 catch-all 之前(铁律2:首个命中);改名 PUT 与收款账户仍落 master:edit ═══
        add(HttpMethod.POST,   "/api/companies",    Perm.COMPANY_MANAGE);
        add(HttpMethod.DELETE, "/api/companies/**", Perm.COMPANY_MANAGE);

        // ═══ 主数据 ═══
        for (String p : new String[]{"/api/buildings", "/api/units", "/api/tenants",
                                     "/api/tenant-categories", "/api/companies", "/api/company-accounts"}) {
            add(null, p, Perm.MASTER_EDIT);
            add(null, p + "/**", Perm.MASTER_EDIT);
        }

        // ═══ 合同(含 contract_billing_term 租金单价 —— 催缴单租金金额直接取该表) ═══
        add(null, "/api/contracts",    Perm.CONTRACT_EDIT);
        add(null, "/api/contracts/**", Perm.CONTRACT_EDIT);

        // ═══ 事后录入:台账 + 附表6/7/8/10/11/12 + 办公三期水电 ═══
        for (String p : new String[]{"/api/ledger", "/api/s10", "/api/pv", "/api/charging",
                                     "/api/elec", "/api/salary", "/api/utilities"}) {
                                     // /api/books 已摘除:模板写走第16点(上方方法级规则),其余写默认拒
            add(null, p, Perm.ENTRY_EDIT);
            add(null, p + "/**", Perm.ENTRY_EDIT);
        }

        // ═══ 账簿与报表 ═══
        // ⚠ /api/pnl 是损益附表 1-5(pnl_row)归 report,/api/pv 是附表6 光伏(pv_record)归 entry。
        //   两者都叫「附表」,路径上没有任何相似度提示,按名字归类必错。
        for (String p : new String[]{"/api/reports", "/api/pnl", "/api/recon"}) {
            add(null, p, Perm.REPORT_EDIT);
            add(null, p + "/**", Perm.REPORT_EDIT);
        }

        // ═══ 系统管理(P1 才有实体端点,先把规则占住,免得将来裸奔) ═══
        add(null, "/api/system",    Perm.SYSTEM_EDIT);
        add(null, "/api/system/**", Perm.SYSTEM_EDIT);
    }

    /**
     * ANY_AUTHENTICATED 的全部端点,形如 "POST /api/import-log"。
     *
     * 只给测试用:这几条是**唯一**不要求任何权限点的写端点,所以「必须挡住匿名」这条
     * 全靠它们身上的断言。自动枚举而不是在测试里手抄一份 —— 手抄的那份加第四条时必忘,
     * 而那正是 2026-08-22 那个匿名绕过能存活的原因。
     */
    public List<String> anyAuthenticatedEndpoints() {
        return rules.stream()
            .filter(r -> r.anyOf().contains(ANY_AUTHENTICATED))
            .map(r -> (r.method() == null ? "ANY" : r.method().name()) + " " + r.pattern().getPatternString())
            .toList();
    }

    private void add(HttpMethod method, String pattern, String... anyOf) {
        rules.add(new Rule(method, parser.parse(pattern), List.of(anyOf)));
    }

    /**
     * 解析一个**写请求**需要的权限。
     *
     * @return 满足其一即可的权限点列表;{@code [ANY_AUTHENTICATED]} = 任何已登录账号可写;
     *         {@code null} = 表里没这条路径 → **拒绝**(默认拒绝,不是放行)
     */
    public List<String> resolve(HttpMethod method, String path) {
        PathContainer pc = PathContainer.parsePath(path);
        for (Rule r : rules) {
            if (r.method() != null && !r.method().equals(method)) continue;
            if (r.pattern().matches(pc)) return r.anyOf();
        }
        return null;
    }

    /** 覆盖率测试用:这张表一共几条规则。 */
    public int size() { return rules.size(); }
}
