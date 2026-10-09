package com.park.demo3.security;

import org.springframework.http.HttpMethod;
import org.springframework.http.server.PathContainer;
import org.springframework.stereotype.Component;
import org.springframework.web.util.pattern.PathPattern;
import org.springframework.web.util.pattern.PathPatternParser;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.stream.Stream;

/**
 * 「写端点 → 权限点」与「读端点 → 查看点」两张有序表(RBAC-SPEC §15.5,v4「权限细到菜单单项」)。
 * 读表每行写的是「实际调用这条接口的那几屏」的查看(按调用方列,不按数据归属列;分析屏调到的模块接口照样对该分析屏放行);
 * 写表每行写的是「发起这条写的那一屏」的编辑或专有动作。URL 分不出屏的,在 service 里再判(§15.6)。
 *
 * 四条铁律(每条都是查证过会踩的坑,改这个文件前先读 RBAC-SPEC §5.2 / §15.5):
 *  1. **按 path segment 匹配,不是字符串前缀**。用 PathPattern,不是 startsWith。
 *     startsWith("/api/elec") 会吞掉 /api/elec-cost/price-cfg;同型:/api/pv ⊂ /api/pv-meter、/api/bills 与 /api/bill-notices。
 *  2. **首个命中生效**:具体规则排在通配之前。
 *  3. **默认拒绝**:表里没有的路径一律 403(resolve 返回 null)。
 *  4. **按屏拆的路径段只认字面值**:/api/charging/{no}(int,07、+7 都会被转成 7)、/api/pnl/{schedule}、/api/reports/{statement}
 *     按段拆到屏之后各补一条**显式拒绝**(anyOf 为空)接住其余写法。空 anyOf 两个 AccessManager 直接拒,不问提权。
 */
@Component
public class PermissionRegistry {

    /** 命中但不要求任何权限点 —— 任何已登录账号可读 / 可写。 */
    public static final String ANY_AUTHENTICATED = "*";

    /** 出账链六屏(billingPeriod.loadChain 的使用方):Promise.all 没有 catch,少一条月索引整屏加载失败,所以整组放行。 */
    public static final String[] CHAIN = {"data-home", "params", "meters", "alloc", "alloc-loss", "bill-notices"};
    /** 分析层 20 屏。 */
    public static final String[] ANALYSIS = Perm.SCREENS.stream().filter(s -> "analysis".equals(s.layer()))
        .map(Perm.Screen::value).toArray(String[]::new);
    /** 损益五屏:pnlDerive.loadDeriveData 每屏都拉 8 个接口,不按附表收窄。 */
    public static final String[] PNL5 = {"rent-pnl", "elec-pnl", "water-pnl", "ops-pnl", "expense-pnl"};
    /** 损益分析:anaData.fetchPnlSummary / fetchPnlYear 的调用屏。 */
    private static final String[] PNL_ANA = {"cockpit", "fin-pnl", "fin-expense", "breakeven", "budget", "pnl-analysis"};
    /** 台账读者:fetchAnomalyInputs、fetchElecYear 等与 pnlDerive。 */
    private static final String[] LEDGER_READERS = cat(new String[]{"cockpit", "anomaly", "park-energy"}, PNL5);

    private record Rule(HttpMethod method, PathPattern pattern, List<String> anyOf) {}

    private final List<Rule> rules = new ArrayList<>();
    private final List<Rule> readRules = new ArrayList<>();
    private final PathPatternParser parser = PathPatternParser.defaultInstance;

    public PermissionRegistry() {
        registerWrites();
        registerReads();
    }

    // ══════════ 写规则(非 GET,§15.5.2) ══════════

    private void registerWrites() {
        // ── 1 请求提权与发起远程授权:viewer / 园区股东连问都不能问。
        //    ⚠ 必须排在下面 /api/auth/approvals/** 前面:PathPattern 的 /** 也匹配 /api/auth/approvals 本身,
        //    顺序反了只读账号也能发远程授权请求(ApprovalService.request 不再判 elevate:request)。
        add(HttpMethod.POST, "/api/auth/elevate",   Perm.ELEVATE_REQUEST);
        add(HttpMethod.POST, "/api/auth/approvals", Perm.ELEVATE_REQUEST);
        // ── 2 任何已登录可写:导入日志(9 个导入屏共用,挂某一屏的编辑会静默丢审计)、本人改密 / 登出 / 结束提权、
        //    批准与撤回远程授权(批准人凭的是本人真有那几个权限,ApprovalService 逐条校验)、编辑锁、在场心跳、铃铛
        add(HttpMethod.POST,   "/api/import-log",            ANY_AUTHENTICATED);
        add(HttpMethod.POST,   "/api/auth/change-password",  ANY_AUTHENTICATED);
        add(HttpMethod.POST,   "/api/auth/logout",           ANY_AUTHENTICATED);
        add(HttpMethod.DELETE, "/api/auth/elevate",          ANY_AUTHENTICATED);
        add(HttpMethod.POST,   "/api/auth/approvals/**",     ANY_AUTHENTICATED);
        add(HttpMethod.DELETE, "/api/auth/approvals/*",      ANY_AUTHENTICATED);
        // 锁不是安全边界:拿到锁也写不了自己没权限的东西;门在 LockService(一个写权都没有的账号不许占锁)
        add(null, "/api/locks/**",    ANY_AUTHENTICATED);
        add(null, "/api/presence/**", ANY_AUTHENTICATED);
        add(null, "/api/notices/**",  ANY_AUTHENTICATED);

        // ── 3–9 公共电核算:池配置、系数簿改层份、生成两屏都调、损耗备注
        add(HttpMethod.POST, "/api/alloc/rules",   "alloc:pools");
        // 系数簿改二期电梯 / 消防层份也走这条;只有系数簿的人能改什么由 AllocService.updateRule 再判
        add(HttpMethod.PUT,  "/api/alloc/rules/*", "alloc:pools", Perm.BILL_NOTICES_COEF);
        add(null, "/api/alloc/rules/**",           "alloc:pools");
        add(null, "/api/alloc/cfg",                Perm.PARAMS_EDIT);           // 没有屏在调;ParamService 按键再判
        add(HttpMethod.POST, "/api/alloc/generate", "alloc:edit", "alloc-loss:edit");
        add(HttpMethod.PUT,  "/api/alloc/loss/note", "alloc-loss:edit");
        add(null, "/api/alloc/**",                 "alloc:edit");

        // ── 10–14 计费参数。recalc = alloc.generate + billNotice.generate,归「重算」这一项
        add(HttpMethod.POST, "/api/params/recalc", "params:recalc");
        // 系数簿改户级单价也走 PUT /api/params:ParamService 按键判(系数簿只认 12 个白名单键)
        add(HttpMethod.PUT,  "/api/params",        Perm.PARAMS_EDIT, Perm.PARAMS_MONTHLY, Perm.BILL_NOTICES_COEF);
        add(null, "/api/params/**",                Perm.PARAMS_EDIT, Perm.PARAMS_MONTHLY);
        // 「复制上月电价」只搬月变电价键 —— 是月度录入的活。⚠ 必须排在 /api/price-cfg/** 之前
        add(HttpMethod.POST, "/api/price-cfg/copy", Perm.PARAMS_MONTHLY);
        add(null, "/api/price-cfg",                Perm.PARAMS_EDIT);
        add(null, "/api/price-cfg/**",             Perm.PARAMS_EDIT);

        // ── 15–16 附表11 电费成本:电价口径与模拟填充(simulate 会往 elec_price_cfg 插行)归「电价口径」
        add(null, "/api/elec-cost/price-cfg",          "elec-cost:price");
        add(HttpMethod.POST, "/api/elec-cost/simulate", "elec-cost:price");
        add(null, "/api/elec-cost/**",                 "elec-cost:edit");

        // ── 17–20 催缴单:签发一档(对外不可逆),生成 / 备注一档
        add(null, "/api/bills/paymap", "bill-notices:issue");
        add(null, "/api/bills/**",     Perm.BILL_NOTICES_EDIT);
        add(null, "/api/bill-notices/confirm",       "bill-notices:issue");
        add(null, "/api/bill-notices/unconfirm",     "bill-notices:issue");
        add(null, "/api/bill-notices/mark-exported", "bill-notices:issue");
        add(null, "/api/bill-notices/{id}/issue",    "bill-notices:issue");
        add(null, "/api/bill-notices/{id}/void",     "bill-notices:issue");
        add(null, "/api/bill-notices/**",            Perm.BILL_NOTICES_EDIT);

        // ── 21–22 园区抄表:读数一档、表档案一档。⚠ 抄表导入必须排在 /api/meters/** 之前;
        //    导入里改倍率另由 MeterService 判表档案;删本期 / 删表连带删草稿催缴单另判催缴单编辑
        add(null, "/api/meters/readings",            "meters:edit");
        add(null, "/api/meters/readings/**",         "meters:edit");
        add(HttpMethod.POST, "/api/meters/import",   "meters:edit");
        add(null, "/api/meters",                     Perm.METERS_ARCHIVE);
        add(null, "/api/meters/**",                  Perm.METERS_ARCHIVE);

        // ── 23–24 附表6 光伏:电站档案(含单价;simulate 会反推写单价)一档,分栋读数一档
        add(null, "/api/pv-meter/stations",           "pv-income:archive");
        add(null, "/api/pv-meter/stations/**",        "pv-income:archive");
        add(HttpMethod.POST, "/api/pv-meter/simulate", "pv-income:archive");
        add(null, "/api/pv-meter/**",                 "pv-income:reading");

        // ── 25–27 附表7 / 8 分桩运营账:一组接口两屏共用,CpMeterService 按桩的车型再判
        add(null, "/api/cp-meter/stations",           "car-charging:archive", "ebike-charging:archive");
        add(null, "/api/cp-meter/stations/**",        "car-charging:archive", "ebike-charging:archive");
        add(HttpMethod.POST, "/api/cp-meter/simulate", "car-charging:reading", "ebike-charging:reading");
        add(null, "/api/cp-meter/**",                 "car-charging:reading", "ebike-charging:reading");

        // ── 28 年度预算只在导入中心导
        add(HttpMethod.POST, "/api/budget/import", "import:edit");

        // ── 29–30 账册模板:URL 只有 bookId,BookService 按账册所属屏再判
        add(HttpMethod.PUT,  "/api/books/*/template",     "ledger:template", "sales-income:template");
        add(HttpMethod.POST, "/api/books/*/template/pin", "ledger:version", "sales-income:version");

        // ── 31–32 审核。submit / recall 的权限看 key 里的 kind,URL 判不出:放行「任一能交审的编辑」,
        //    细分在 ReviewService(ReviewKind.perms())。补上了 v3 缺的三张报表编辑
        String[] submitters = {Perm.PARAMS_EDIT, Perm.PARAMS_MONTHLY, "meters:edit", "alloc:edit", "alloc-loss:edit",
            Perm.BILL_NOTICES_EDIT, "ledger:edit", "sales-income:edit", Perm.SALARY_EDIT, "utilities:edit", "pv-income:edit",
            "car-charging:edit", "ebike-charging:edit", "elec-cost:edit",
            "income-statement:edit", "balance-sheet:edit", "trial-balance:edit"};
        add(HttpMethod.POST, "/api/review/*/submit",   submitters);
        add(HttpMethod.POST, "/api/review/*/recall",   submitters);
        add(HttpMethod.POST, "/api/review/*/approve",  Perm.REVIEW_APPROVE);
        add(HttpMethod.POST, "/api/review/*/return",   Perm.REVIEW_APPROVE);
        add(HttpMethod.POST, "/api/review/*/withdraw", Perm.REVIEW_APPROVE);

        // ── 33–34 公司:建删 = 建删账册(月度台账);改名与收款账户归催缴单的「收款公司」
        add(HttpMethod.POST,   "/api/companies",                "ledger:company");
        add(HttpMethod.DELETE, "/api/companies/**",             "ledger:company");
        add(HttpMethod.PUT,    "/api/companies/*",              "bill-notices:payee");
        add(HttpMethod.POST,   "/api/companies/*/accounts",     "bill-notices:payee");
        add(null, "/api/company-accounts",                      "bill-notices:payee");
        add(null, "/api/company-accounts/**",                   "bill-notices:payee");

        // ── 35–46 档案与事后录入,一屏一前缀
        both("/api/buildings", "buildings:edit");
        both("/api/units", "buildings:edit");
        both("/api/tenants", "tenants:edit");
        both("/api/tenant-categories", "tenants:edit");
        both("/api/contracts", "contracts:edit");
        both("/api/ledger", "ledger:edit");
        both("/api/s10", "sales-income:edit");
        both("/api/pv", "pv-income:edit");
        add(null, "/api/charging/7/**", "car-charging:edit");
        add(null, "/api/charging/8/**", "ebike-charging:edit");
        add(null, "/api/charging/**");                                   // 铁律 4:07、+7 之类一律拒
        both("/api/elec", "elec-cost:edit");
        both("/api/utilities", "utilities:edit");
        // 工资:整个前缀一档(salary_record 只有 SalaryService 写),不可提权
        both("/api/salary", Perm.SALARY_EDIT);

        // ── 47–53 账簿与报表。⚠ /api/pnl 是损益附表 1–5,/api/pv 是附表6 光伏:名字都叫「附表」,按名字归类必错
        add(null, "/api/reports/is/**", "income-statement:edit");
        add(null, "/api/reports/bs/**", "balance-sheet:edit");
        add(null, "/api/reports/tb/**", "trial-balance:edit");
        add(null, "/api/reports/**");                                    // 铁律 4
        for (int i = 0; i < PNL5.length; i++) add(null, "/api/pnl/s" + (i + 1) + "/**", PNL5[i] + ":edit");
        add(null, "/api/pnl/**");                                        // 铁律 4
        both("/api/recon", "reconciliation:edit");

        // ── 54 经营分析「目标与阈值」:一次 PUT 可带多项,AnalysisSettingService 按项判归属屏;/api/analysis 下别的写照旧拒
        add(HttpMethod.PUT, "/api/analysis/settings",
            "park:edit", "anomaly:edit", "fin-cashflow:edit", "churn:edit", "breakeven:edit", "pv-roi:edit");

        // ── 55–56 系统管理:不留 /api/system/** 兜底,新加的写端点落默认拒绝,覆盖率测试当场红
        both("/api/system/users", Perm.SYS_USERS_EDIT);
        both("/api/system/roles", Perm.SYS_ROLES_EDIT);   // 含成员增减(§15.9)
    }

    // ══════════ 读规则(GET,§15.5.1;写的是屏 value,意思是 <屏>:view) ══════════

    private void registerReads() {
        // ── 1 任何已登录可读:身份 / 会话 / 协作基础设施,与不含业务数据的字典。逐条精确路径,不用 /** 通配 ——
        //    这几个前缀下以后新加的 GET 落默认拒绝,审过回包再登记
        for (String p : List.of("/api/auth/me", "/api/auth/perms", "/api/auth/elevate", "/api/auth/approvals",
                "/api/auth/approvals/candidates", "/api/notices", "/api/notices/system-seen", "/api/review",
                "/api/review/states", "/api/review/closed-months", "/api/review/pending", "/api/review/returned",
                "/api/zones", "/api/probe/ok", "/api/probe/boom", "/api/app/config"))
            read(p, ANY_AUTHENTICATED);

        // ── 2–5 系统管理三屏
        read("/api/system/perms", "sys-roles");
        read("/api/system/roles", "sys-roles", "sys-users");             // 用户管理屏的角色勾选
        read("/api/system/users", "sys-users", "sys-roles");             // 角色屏的成员栏与「添加成员」候选
        read("/api/system/logs",  "sys-logs");

        // ── 6–8 经营分析
        read("/api/analysis/s10-tenant-months", "cockpit", "anomaly", "park-energy", "tenant-energy", "tenant-peer",
             "fin-cashflow", "churn", "breakeven");
        read("/api/analysis/ledger-tenant-months", "cockpit", "anomaly", "tenant-energy", "fin-cashflow", "churn");
        read("/api/analysis/**", ANALYSIS);                              // months(AnaShell 挂载)、settings(路由守卫)

        // ── 9–17 档案。联系人电话、收款账号由服务端按 tenants:view / bill-notices:view 打码(SensitiveMask)
        read("/api/tenants/summary", "tenants");
        read("/api/tenants/{id}", "tenants");
        read("/api/tenants", "tenants", "contracts", "params", "meters", "alloc", "ledger", "sales-income",
             "park", "tenant-energy", "tenant-portfolio", "tenant-peer", "fin-cashflow");
        read("/api/tenant-categories", "tenants");
        read("/api/buildings/summary", "buildings", "park");
        read("/api/buildings/{id}", "buildings", "contracts", "park");
        read("/api/buildings", "buildings", "contracts", "params", "meters", "alloc", "bill-notices", "park", "tenant-peer");
        read("/api/companies/payees", "bill-notices");                   // 收款账号明文(单子要发给租户)
        read("/api/companies", "ledger", "bill-notices", "income-statement", "balance-sheet", "trial-balance",
             "fin-pnl", "fin-balance", "fin-cashflow");

        // ── 18–21 合同
        read("/api/contracts/summary", "contracts");
        read("/api/contracts/{id}/terminate-preview", "contracts");
        read("/api/contracts/{id}", "contracts", "tenant-peer");
        read("/api/contracts", "contracts", "bill-notices", "park", "tenant-portfolio", "tenant-peer", "expiry");

        // ── 22–27 计费参数。/api/params 不带 key 会回当月全表,ParamController 再按屏收窄回包
        read("/api/params/status", CHAIN);
        read("/api/params", "params", "alloc", "alloc-loss", "bill-notices", "anomaly", "pv-meter-analysis");
        read("/api/params/**", "params");
        read("/api/price-cfg", "params");
        read("/api/alloc/rules", "params", "alloc", "bill-notices");
        read("/api/alloc/cfg", "params");

        // ── 28–35 出账链
        read("/api/alloc/pool-months", CHAIN);
        read("/api/alloc/loss-months", CHAIN);
        read("/api/alloc/pools", "alloc", "bill-notices");               // 系数簿按生效月取池
        read("/api/alloc/loss", "alloc-loss");
        read("/api/alloc/**", "alloc");
        read("/api/bill-notices/months", CHAIN);
        read("/api/bill-notices/**", "bill-notices");
        read("/api/bills/paymap", "bill-notices");
        read("/api/bills/s10", "sales-income");                          // 某期全部附表10 逐户行,不能挂催缴单
        read("/api/bills", "ledger");                                    // 某期台账 × 租户 × 公司全部行
        read("/api/data-home/**", "data-home");

        // ── 36–44 抄表、光伏分栋、分桩运营账
        read("/api/meters/months", CHAIN);
        read("/api/meters/{id}/readings", "meters", "alloc");            // 池抽屉移出表前确认
        read("/api/meters", "meters", "params", "alloc");
        read("/api/meters/**", "meters");
        read("/api/pv-meter/months", "pv-income", "anomaly");
        read("/api/pv-meter/stations", "pv-income", "anomaly", "pv-meter-analysis");
        read("/api/pv-meter/readings", "pv-income", "anomaly", "pv-meter-analysis");
        read("/api/pv-meter/**", "pv-income");
        read("/api/cp-meter/months", "car-charging", "ebike-charging");  // CpMeterService 再按车型判
        read("/api/cp-meter/**", "car-charging", "ebike-charging", "charging-analysis");   // 回包按车型过滤

        // ── 45–47 电费成本
        read("/api/elec-cost/price-cfg", "elec-cost", "pv-meter-analysis", "elec-analysis");
        read("/api/elec-cost/meters", "elec-cost", "elec-analysis");
        read("/api/elec-cost/entries", "elec-cost", "elec-analysis");
        read("/api/elec-cost/metrics-year", "elec-cost", "elec-analysis");
        read("/api/elec-cost/**", "elec-cost");

        // ── 48–69 台账与附表
        read("/api/budget/all", "cockpit", "fin-pnl", "budget");
        read("/api/books/**", "ledger", "sales-income");                 // 账册清单与模板版本(列名,不含金额)
        read("/api/ledger/**", "ledger");
        read("/api/s10/overview", "sales-income");
        read("/api/s10/year-summary", cat(new String[]{"sales-income"}, PNL5));
        read("/api/s10/month-totals", "reports-home", "sales-income");   // 报表中心勾稽③只要四个期区的月合计
        read("/api/s10/**", "sales-income");                             // 逐租户宽表只给附表10 本屏
        read("/api/pv/records", cat(new String[]{"pv-income", "park-energy", "pv-roi"}, PNL5));
        read("/api/pv/phases", "pv-income", "pv-roi");
        read("/api/pv/overview", "pv-income", "park-energy", "pv-roi");
        read("/api/pv/**", "pv-income");
        read("/api/charging/7/records", cat(new String[]{"car-charging"}, LEDGER_READERS));
        read("/api/charging/8/records", cat(new String[]{"ebike-charging"}, LEDGER_READERS));
        read("/api/charging/7/**", "car-charging");
        read("/api/charging/8/**", "ebike-charging");
        read("/api/charging/**");                                        // 铁律 4
        read("/api/elec/records", cat(new String[]{"elec-cost"}, LEDGER_READERS));
        read("/api/elec/**", "elec-cost");
        read("/api/utilities/*/records", cat(new String[]{"utilities"}, LEDGER_READERS));
        read("/api/utilities/**", "utilities");
        read("/api/import-log/**", "import");
        // 工资只给工资屏;例外是不带人的餐补逐月合计(损益附表派生对照)
        read("/api/salary/lunch-totals", cat(new String[]{"salary"}, PNL5));
        read("/api/salary/**", "salary");

        // ── 70–80 损益附表:overview 只给本屏,年份数据另给损益分析
        for (int i = 0; i < PNL5.length; i++) {
            read("/api/pnl/s" + (i + 1) + "/overview", PNL5[i]);
            read("/api/pnl/s" + (i + 1) + "/*", cat(new String[]{PNL5[i]}, PNL_ANA));
        }
        read("/api/pnl/**");                                             // 铁律 4

        // ── 81–88 三大报表与收入核对。科目余额表不给分析(科目名里有疑似账号片段)
        read("/api/reports/is/all/*/*", "income-statement", "fin-pnl", "fin-balance");
        read("/api/reports/is/*/*/*", "income-statement", "fin-pnl", "fin-balance");
        read("/api/reports/is/**", "income-statement");
        read("/api/reports/bs/all/*/*", "balance-sheet", "fin-balance");
        read("/api/reports/bs/*/*/*", "balance-sheet", "fin-balance");
        read("/api/reports/bs/**", "balance-sheet");
        read("/api/reports/tb/**", "trial-balance");
        read("/api/reports/**");                                         // 铁律 4
        read("/api/recon/**", "reconciliation");
    }

    private static String[] cat(String[]... parts) {
        return Arrays.stream(parts).flatMap(Arrays::stream).toArray(String[]::new);
    }

    /** 读规则:屏 value → `<屏>:view`;不给屏 = 显式拒绝(铁律 4);ANY_AUTHENTICATED 原样。 */
    private void read(String pattern, String... screens) {
        List<String> anyOf = Stream.of(screens).map(s -> ANY_AUTHENTICATED.equals(s) ? s : s + ":view").toList();
        readRules.add(new Rule(HttpMethod.GET, parser.parse(pattern), anyOf));
    }

    private void add(HttpMethod method, String pattern, String... anyOf) {
        rules.add(new Rule(method, parser.parse(pattern), List.of(anyOf)));
    }

    /** 一个前缀本身与它下面全部路径,同一档。 */
    private void both(String prefix, String perm) {
        add(null, prefix, perm);
        add(null, prefix + "/**", perm);
    }

    /**
     * 解析一个**读请求(GET)**需要的查看点。
     * {@code [ANY_AUTHENTICATED]} = 任何已登录可读;空表 = 显式拒绝;{@code null} = 表里没这条路径 → 也拒绝。
     */
    public List<String> resolveRead(String path) {
        PathContainer pc = PathContainer.parsePath(path);
        for (Rule r : readRules) {
            if (r.pattern().matches(pc)) return r.anyOf();
        }
        return null;
    }

    /**
     * 解析一个**写请求**需要的权限。
     *
     * @return 满足其一即可的权限点列表;{@code [ANY_AUTHENTICATED]} = 任何已登录账号可写;
     *         空表 = 显式拒绝(不问提权);{@code null} = 表里没这条路径 → **拒绝**
     */
    public List<String> resolve(HttpMethod method, String path) {
        PathContainer pc = PathContainer.parsePath(path);
        for (Rule r : rules) {
            if (r.method() != null && !r.method().equals(method)) continue;
            if (r.pattern().matches(pc)) return r.anyOf();
        }
        return null;
    }

    /**
     * ANY_AUTHENTICATED 的全部写端点,形如 "POST /api/import-log"。只给测试用:自动枚举而不是在测试里手抄一份 ——
     * 手抄的那份加一条时必忘,而那正是 2026-08-22 那个匿名绕过能存活的原因。
     */
    public List<String> anyAuthenticatedEndpoints() {
        return rules.stream()
            .filter(r -> r.anyOf().contains(ANY_AUTHENTICATED))
            .map(r -> (r.method() == null ? "ANY" : r.method().name()) + " " + r.pattern().getPatternString())
            .toList();
    }

    /** 覆盖率测试用:写表一共几条规则。 */
    public int size() { return rules.size(); }
}
