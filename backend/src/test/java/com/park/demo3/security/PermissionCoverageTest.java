package com.park.demo3.security;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * RBAC-SPEC v2 §5.4：**本规范最重要的一条**。
 *
 * 扫源码里所有 controller 的写端点（非 GET），断言每一条都被 {@link PermissionRegistry} 覆盖。
 * 半年后有人加了新写接口忘了配权限，这个测试当场红——而不是等它在生产上裸奔。
 *
 * 不用 Spring 上下文：直接解析 controller 源文件。跑得快，且不依赖 DB。
 */
class PermissionCoverageTest {

    private static final Path CONTROLLERS =
        Paths.get("src/main/java/com/park/demo3/controller");

    /** 类级与方法级映射注解;括号里的原文交给 {@link #literal} 判写法。 */
    private static final Pattern MAPPING =
        Pattern.compile("@(Request|Get|Post|Put|Patch|Delete)Mapping\\b(?:\\s*\\(([^)]*)\\))?");
    /** 括号里只认「一个字面路径」(可带 value =)或什么都不写。 */
    private static final Pattern LITERAL_ARG = Pattern.compile("\\s*(?:value\\s*=\\s*)?\"([^\"]*)\"\\s*");

    private record Endpoint(HttpMethod method, String path, String source) {}

    // ── 扫描 ──────────────────────────────────────────────────────────────

    /**
     * ⚠ 扫描器看不懂的写法一律让测试红,不许静默跳过:
     *  · 递归扫(Files.walk):controller 子包里的新接口也得扫到;
     *  · 映射注解括号里不是单个字面路径(数组、produces = …、常量)→ 红。老正则会把 @GetMapping(value="/x", produces=…)
     *    当成没写路径,拼出类基址去命中已有规则,测试照绿、运行时却 403;
     *  · 一个文件只许一个 @RequestMapping(类级)—— 方法级的 @RequestMapping(method = …) 扫不到 HTTP 方法。
     */
    private List<Endpoint> scan() throws IOException {
        List<Path> files;
        try (Stream<Path> s = Files.walk(CONTROLLERS)) {
            files = s.filter(p -> p.toString().endsWith(".java")).sorted().toList();
        }
        List<Endpoint> out = new ArrayList<>();
        for (Path f : files) {
            String src = Files.readString(f, StandardCharsets.UTF_8);
            String base = null;
            Matcher mm = MAPPING.matcher(src);
            while (mm.find()) {
                String sub = literal(mm.group(2), f, mm.group());
                if ("Request".equals(mm.group(1))) {
                    assertThat(base).as(f.getFileName() + ":只认一个类级 @RequestMapping,方法级的扫描器判不出 HTTP 方法").isNull();
                    base = sub;
                    continue;
                }
                HttpMethod m = HttpMethod.valueOf(mm.group(1).toUpperCase(Locale.ROOT));
                out.add(new Endpoint(m, join(base == null ? "" : base, sub), f.getFileName().toString()));
            }
        }
        return out;
    }

    private static String literal(String args, Path f, String whole) {
        if (args == null || args.isBlank()) return "";
        Matcher lm = LITERAL_ARG.matcher(args);
        assertThat(lm.matches())
            .as(f.getFileName() + " 的 " + whole + ":括号里只许一个字面路径,别的写法扫描器会拼错路径")
            .isTrue();
        return lm.group(1);
    }

    private static String join(String base, String sub) {
        String b = base.endsWith("/") ? base.substring(0, base.length() - 1) : base;
        if (sub.isEmpty()) return b.isEmpty() ? "/" : b;
        return b + (sub.startsWith("/") ? sub : "/" + sub);
    }

    // ── 断言 ──────────────────────────────────────────────────────────────

    @Test
    @DisplayName("每一个写端点都必须被权限映射表覆盖（默认拒绝，漏配即裸奔）")
    void everyWriteEndpointIsMapped() throws IOException {
        PermissionRegistry reg = new PermissionRegistry();
        List<Endpoint> all = scan();

        assertThat(all)
            .as("controller 扫描结果为空 —— 说明正则或路径失效了，这个测试等于没跑")
            .hasSizeGreaterThan(150);

        var parser = org.springframework.web.util.pattern.PathPatternParser.defaultInstance;
        List<org.springframework.web.util.pattern.PathPattern> permitAll =
            Arrays.stream(SecurityPaths.PERMIT_ALL).map(parser::parse).toList();

        List<String> uncovered = all.stream()
            .filter(e -> e.method() != HttpMethod.GET)
            // permitAll 的路径走不到写规则(SecurityConfig 先放行)。白名单来自 SecurityPaths,
            // 测试里没有自己的一份 —— 想豁免必须真把端点变成公开可访问,那是显眼可 review 的动作。
            .filter(e -> permitAll.stream().noneMatch(
                pp -> pp.matches(org.springframework.http.server.PathContainer.parsePath(e.path()))))
            .filter(e -> reg.resolve(e.method(), e.path()) == null)
            .map(e -> e.method() + " " + e.path() + "   (" + e.source() + ")")
            .sorted()
            .toList();

        assertThat(uncovered)
            .as("这些写端点没有落进 PermissionRegistry，按「默认拒绝」它们会 403；"
              + "新加接口请去 PermissionRegistry 补一条规则，并对照 docs/design/RBAC-SPEC.md §5.2")
            .isEmpty();
    }

    @Test
    @DisplayName("映射表引用的权限点必须都真实存在（防手滑写错字符串）")
    void registryOnlyReferencesRealPerms() throws IOException {
        PermissionRegistry reg = new PermissionRegistry();
        List<String> bad = new ArrayList<>();
        for (Endpoint e : scan()) {
            if (e.method() == HttpMethod.GET) continue;
            List<String> anyOf = reg.resolve(e.method(), e.path());
            if (anyOf == null) continue;
            for (String p : anyOf) {
                if (!PermissionRegistry.ANY_AUTHENTICATED.equals(p) && !Perm.exists(p)) {
                    bad.add(e.path() + " → " + p);
                }
            }
        }
        assertThat(bad).as("映射表引用了 Perm.ALL 里没有的权限点").isEmpty();
    }

    // ── 回归断言：全是查证过会踩的坑（RBAC-SPEC §5.4）──────────────────────

    @Test
    @DisplayName("回归：段感知匹配 —— /api/elec 不得吞掉 /api/elec-cost")
    void segmentAwareMatching() {
        PermissionRegistry reg = new PermissionRegistry();
        // 若把规则写成 startsWith("/api/elec")，录入员就直接拿到四个电价键的写权限
        assertThat(reg.resolve(HttpMethod.PUT, "/api/elec-cost/price-cfg"))
            .containsExactly(Perm.PARAM_POLICY_EDIT);
        assertThat(reg.resolve(HttpMethod.POST, "/api/elec-cost/simulate"))
            .containsExactly(Perm.PARAM_POLICY_EDIT);
        assertThat(reg.resolve(HttpMethod.POST, "/api/elec/records"))
            .containsExactly(Perm.ENTRY_EDIT);
        // /api/pv ⊂ /api/pv-meter
        assertThat(reg.resolve(HttpMethod.POST, "/api/pv-meter/readings"))
            .containsExactly(Perm.METER_READING_EDIT);
        assertThat(reg.resolve(HttpMethod.POST, "/api/pv/records"))
            .containsExactly(Perm.ENTRY_EDIT);
        // /api/bills 与 /api/bill-notices
        assertThat(reg.resolve(HttpMethod.PUT, "/api/bills/paymap"))
            .containsExactly(Perm.BILLING_ISSUE_EDIT);
        assertThat(reg.resolve(HttpMethod.POST, "/api/bill-notices/generate"))
            .containsExactly(Perm.BILLING_RUN_EDIT);
    }

    @Test
    @DisplayName("回归：最长前缀优先 —— 口径规则不得被 catch-all 吃掉")
    void longestPrefixWins() {
        PermissionRegistry reg = new PermissionRegistry();
        // 系数簿改层份走这条；被 /api/alloc/** 吃掉的话专员就能改公摊口径
        assertThat(reg.resolve(HttpMethod.PUT, "/api/alloc/rules/12"))
            .containsExactly(Perm.PARAM_POLICY_EDIT);
        assertThat(reg.resolve(HttpMethod.POST, "/api/alloc/generate"))
            .containsExactly(Perm.BILLING_RUN_EDIT);
        // recalc 内部就是 alloc.generate + billNotice.generate，归 param 会让专员出不了账
        assertThat(reg.resolve(HttpMethod.POST, "/api/params/recalc"))
            .containsExactly(Perm.BILLING_RUN_EDIT);
        // 表档案 vs 抄读数
        assertThat(reg.resolve(HttpMethod.POST, "/api/meters/readings"))
            .containsExactly(Perm.METER_READING_EDIT);
        assertThat(reg.resolve(HttpMethod.DELETE, "/api/meters/9"))
            .containsExactly(Perm.METER_MASTER_EDIT);
        assertThat(reg.resolve(HttpMethod.PUT, "/api/pv-meter/stations/3"))
            .containsExactly(Perm.METER_MASTER_EDIT);
        assertThat(reg.resolve(HttpMethod.POST, "/api/cp-meter/simulate"))
            .containsExactly(Perm.BILLING_RUN_EDIT);
        // 抄表导入:被 /api/meters/** 的 meter-master 吃掉的话,专员点导入中心的磁贴会 403
        assertThat(reg.resolve(HttpMethod.POST, "/api/meters/import"))
            .containsExactly(Perm.METER_READING_EDIT);
    }

    @Test
    @DisplayName("回归：导入日志任何已登录可写 —— 挂 entry 会让抄表员静默丢审计")
    void importLogIsOpenToAnyAuthenticated() {
        PermissionRegistry reg = new PermissionRegistry();
        // 9 个导入屏共用它；前端是 catch+console.warn 吞掉的，403 了用户毫无感知
        assertThat(reg.resolve(HttpMethod.POST, "/api/import-log"))
            .containsExactly(PermissionRegistry.ANY_AUTHENTICATED);
        // 本人改密同理:漏登记的话首次强制改密的账号会被卡死 —— 改密页是他唯一能去的地方,却提交不了
        assertThat(reg.resolve(HttpMethod.POST, "/api/auth/change-password"))
            .containsExactly(PermissionRegistry.ANY_AUTHENTICATED);
    }

    @Test
    @DisplayName("回归：未登记路径默认拒绝，不是放行")
    void unknownPathIsDenied() {
        PermissionRegistry reg = new PermissionRegistry();
        assertThat(reg.resolve(HttpMethod.POST, "/api/brand-new-endpoint")).isNull();
    }
    // 第 16/17 点互不代替(spec 2026-08-26 §8):换一套别人的列、和在本月微调列名,是两种风险。
    // 只用 viewer 打 403 证不了这一点 —— 就算把 pin 错映射成 book-template:edit,那种用例照样绿。
    // 路径改名时权限门不跟着挪、或两个点被合并,都在这里当场红。
    @Test
    @DisplayName("账册模板:编辑与切版映射到两个不同的权限点")
    void bookTemplate_editAndSwitch_mapToDistinctPerms() {
        PermissionRegistry reg = new PermissionRegistry();
        assertThat(reg.resolve(HttpMethod.PUT, "/api/books/7/template"))
                .containsExactly(Perm.BOOK_TEMPLATE_EDIT);
        assertThat(reg.resolve(HttpMethod.POST, "/api/books/7/template/pin"))
                .containsExactly(Perm.BOOK_TEMPLATE_SWITCH);
        assertThat(Perm.BOOK_TEMPLATE_EDIT).isNotEqualTo(Perm.BOOK_TEMPLATE_SWITCH);
    }

    // ══ v3「读写分开」(RBAC-SPEC §11):读也默认拒绝,所以读端点也要逐条覆盖 ══════════════

    @Test
    @DisplayName("每一个读端点(GET)都必须命中读规则表（默认拒绝，漏配即 403）")
    void everyReadEndpointIsMapped() throws IOException {
        PermissionRegistry reg = new PermissionRegistry();
        List<Endpoint> gets = scan().stream().filter(e -> e.method() == HttpMethod.GET).toList();
        assertThat(gets)
            .as("GET 扫描结果太少 —— 正则或路径失效了，这个测试等于没跑")
            .hasSizeGreaterThan(100);

        var parser = org.springframework.web.util.pattern.PathPatternParser.defaultInstance;
        List<org.springframework.web.util.pattern.PathPattern> permitAll =
            Arrays.stream(SecurityPaths.PERMIT_ALL).map(parser::parse).toList();

        List<String> uncovered = gets.stream()
            // 白名单同样只来自 SecurityPaths,测试里不开自己的豁免名单
            .filter(e -> permitAll.stream().noneMatch(
                pp -> pp.matches(org.springframework.http.server.PathContainer.parsePath(e.path()))))
            .filter(e -> reg.resolveRead(e.path()) == null)
            .map(e -> "GET " + e.path() + "   (" + e.source() + ")")
            .sorted()
            .toList();

        assertThat(uncovered)
            .as("这些读端点没有落进 PermissionRegistry.registerReads，按「默认拒绝」它们对所有人 403；"
              + "新加读接口请补一条读规则，并对照 docs/design/RBAC-SPEC.md §11.3")
            .isEmpty();
    }

    @Test
    @DisplayName("读规则只许引用查看点（kind=view）—— 读规则挂一个 :edit 等于让查看依赖编辑")
    void readRulesOnlyReferenceViewPerms() throws IOException {
        PermissionRegistry reg = new PermissionRegistry();
        Set<String> views = new HashSet<>();
        for (Perm.Meta m : Perm.META) if ("view".equals(m.kind())) views.add(m.key());
        List<String> bad = new ArrayList<>();
        for (Endpoint e : scan()) {
            if (e.method() != HttpMethod.GET) continue;
            List<String> anyOf = reg.resolveRead(e.path());
            if (anyOf == null) continue;
            for (String p : anyOf) {
                if (!PermissionRegistry.ANY_AUTHENTICATED.equals(p) && !views.contains(p)) bad.add(e.path() + " → " + p);
            }
        }
        assertThat(bad).isEmpty();
    }

    @Test
    @DisplayName("回归：读规则的段感知与最长前缀 —— 分析白名单不得吞掉同前缀的明细接口")
    void readRoutingRegressions() {
        PermissionRegistry reg = new PermissionRegistry();
        // 段感知:/api/pv ⊂ /api/pv-meter、/api/elec ⊂ /api/elec-cost
        assertThat(reg.resolveRead("/api/pv-meter/years")).containsExactly(Perm.METER_VIEW);
        assertThat(reg.resolveRead("/api/pv/records"))
            .containsExactly(Perm.ENTRY_VIEW, Perm.REPORT_VIEW, Perm.ANALYSIS_VIEW);
        assertThat(reg.resolveRead("/api/elec-cost/months")).containsExactly(Perm.ENTRY_VIEW);
        assertThat(reg.resolveRead("/api/elec-cost/price-cfg"))
            .containsExactly(Perm.PARAM_VIEW, Perm.ENTRY_VIEW, Perm.ANALYSIS_VIEW);
        // 最长前缀:/summary 在 /{id} 前;租户详情不给分析(电话在里面,分析只拿列表)
        assertThat(reg.resolveRead("/api/tenants/summary")).containsExactly(Perm.MASTER_VIEW, Perm.ANALYSIS_VIEW);
        assertThat(reg.resolveRead("/api/tenants/7")).containsExactly(Perm.MASTER_VIEW);
        assertThat(reg.resolveRead("/api/contracts/7/terminate-preview")).containsExactly(Perm.CONTRACT_VIEW);
        // /api/meters/{id}/readings 三段,吞不掉 readings/delete-preview
        assertThat(reg.resolveRead("/api/meters/9/readings")).containsExactly(Perm.METER_VIEW, Perm.BILLING_VIEW);
        assertThat(reg.resolveRead("/api/meters/readings/delete-preview")).containsExactly(Perm.METER_VIEW);
        // 公摊规则归计费参数,不被 /api/alloc/** 的 billing 吃掉
        assertThat(reg.resolveRead("/api/alloc/rules")).containsExactly(Perm.PARAM_VIEW, Perm.BILLING_VIEW);
        assertThat(reg.resolveRead("/api/alloc/cfg")).containsExactly(Perm.PARAM_VIEW);
        // 损益附表:overview 不给分析,排在 /*/* 前
        assertThat(reg.resolveRead("/api/pnl/1/overview")).containsExactly(Perm.REPORT_VIEW);
        assertThat(reg.resolveRead("/api/pnl/1/2024")).containsExactly(Perm.REPORT_VIEW, Perm.ANALYSIS_VIEW);
        // 报表:is / bs 本期给分析,科目余额表 tb 不给
        assertThat(reg.resolveRead("/api/reports/is/all/2024/5")).containsExactly(Perm.REPORT_VIEW, Perm.ANALYSIS_VIEW);
        assertThat(reg.resolveRead("/api/reports/bs/3/2024/5")).containsExactly(Perm.REPORT_VIEW, Perm.ANALYSIS_VIEW);
        assertThat(reg.resolveRead("/api/reports/tb/all/2024/5")).containsExactly(Perm.REPORT_VIEW);
        assertThat(reg.resolveRead("/api/reports/is/3/2024")).containsExactly(Perm.REPORT_VIEW);
        // 工资只认 salary:view —— 分析与报表都不放行;唯一例外是不带人的餐补逐月合计(报表派生对照用)
        assertThat(reg.resolveRead("/api/salary/records")).containsExactly(Perm.SALARY_VIEW);
        assertThat(reg.resolveRead("/api/salary/overview")).containsExactly(Perm.SALARY_VIEW);
        assertThat(reg.resolveRead("/api/salary/lunch-totals")).containsExactly(Perm.SALARY_VIEW, Perm.REPORT_VIEW);
        // 催缴单收款账户明文只给 billing:view(/api/companies 那条对别的查看点打码)
        assertThat(reg.resolveRead("/api/companies/payees")).containsExactly(Perm.BILLING_VIEW);
        // 协作基础设施逐条精确登记:同前缀下新加的 GET 不许被「任何已登录」顺手放开,要落默认拒绝
        assertThat(reg.resolveRead("/api/notices")).containsExactly(PermissionRegistry.ANY_AUTHENTICATED);
        assertThat(reg.resolveRead("/api/review")).containsExactly(PermissionRegistry.ANY_AUTHENTICATED);
        assertThat(reg.resolveRead("/api/auth/approvals/candidates")).containsExactly(PermissionRegistry.ANY_AUTHENTICATED);
        for (String fresh : List.of("/api/auth/approvals/history", "/api/auth/whatever", "/api/notices/all",
                                    "/api/review/export", "/api/probe/dump")) {
            assertThat(reg.resolveRead(fresh)).as(fresh).isNull();
        }
        // 默认拒绝
        assertThat(reg.resolveRead("/api/brand-new-endpoint")).isNull();
    }

    /**
     * 工资的写一律 salary:edit(用户 2026-10-04 拍板「按你推荐」,RBAC-SPEC §11.8)。从 controller 源码枚举,
     * 不手抄清单 —— 将来 /api/salary 下新加一个写端点,它自动进这条断言。
     * 破坏验证:PermissionRegistry 把 "/api/salary" 放回事后录入那一组 → 本条红(那组排在前面,首个命中);
     *          ReviewKind.SALARY 改回 ENTRY_EDIT → 交审那条红;NOT_ELEVATABLE 去掉 SALARY_EDIT → 最后一条红。
     */
    @Test
    @DisplayName("工资的每一个写端点都只认 salary:edit;交审附表12 也只认它;它不可提权")
    void everySalaryWriteNeedsSalaryEdit() throws IOException {
        List<Endpoint> writes = scan().stream()
            .filter(e -> e.method() != HttpMethod.GET && e.path().startsWith("/api/salary/")).toList();
        assertThat(writes).as("SalaryController 的写端点:新增 / 改备注 / 删 / 导入 / 清空本期导入 / 批删").hasSize(6);
        PermissionRegistry reg = new PermissionRegistry();
        for (Endpoint e : writes) {
            assertThat(reg.resolve(e.method(), e.path())).as(e.method() + " " + e.path()).containsExactly(Perm.SALARY_EDIT);
        }
        assertThat(ReviewKind.SALARY.perms()).containsExactly(Perm.SALARY_EDIT);
        assertThat(reg.resolve(HttpMethod.POST, "/api/review/salary:2024-02/submit")).contains(Perm.SALARY_EDIT);
        assertThat(reg.resolve(HttpMethod.POST, "/api/review/salary:2024-02/recall")).contains(Perm.SALARY_EDIT);
        assertThat(Perm.elevatable(Perm.SALARY_EDIT)).as("借到它就能往看不见的工资表里写").isFalse();
    }

    @Test
    @DisplayName("全部 :view 不可提权（v3 规则 6）")
    void everyViewIsNotElevatable() {
        List<String> views = Perm.META.stream().filter(m -> "view".equals(m.kind())).map(Perm.Meta::key).toList();
        assertThat(views).as("9 个模块查看点 + system:view").hasSize(10);
        assertThat(views).allSatisfy(v -> assertThat(Perm.elevatable(v)).as(v).isFalse());
    }

    @Test
    @DisplayName("编辑隐含查看:隐含表与设计一致,且与 META 的 group/kind 一致；工资与分析不被任何点隐含")
    void impliedViewsMatchDesignAndMeta() {
        // 设计原文(2026-10-04 拍板)逐条抄录;book-template:* 归 entry、system:edit 隐含 system:view 是勘察结论
        Map<String, String> design = Map.ofEntries(
            Map.entry(Perm.MASTER_EDIT, Perm.MASTER_VIEW), Map.entry(Perm.COMPANY_MANAGE, Perm.MASTER_VIEW),
            Map.entry(Perm.CONTRACT_EDIT, Perm.CONTRACT_VIEW),
            Map.entry(Perm.PARAM_POLICY_EDIT, Perm.PARAM_VIEW), Map.entry(Perm.PARAM_MONTHLY_EDIT, Perm.PARAM_VIEW),
            Map.entry(Perm.METER_MASTER_EDIT, Perm.METER_VIEW), Map.entry(Perm.METER_READING_EDIT, Perm.METER_VIEW),
            Map.entry(Perm.BILLING_RUN_EDIT, Perm.BILLING_VIEW), Map.entry(Perm.BILLING_ISSUE_EDIT, Perm.BILLING_VIEW),
            Map.entry(Perm.ENTRY_EDIT, Perm.ENTRY_VIEW),
            Map.entry(Perm.BOOK_TEMPLATE_EDIT, Perm.ENTRY_VIEW), Map.entry(Perm.BOOK_TEMPLATE_SWITCH, Perm.ENTRY_VIEW),
            Map.entry(Perm.REPORT_EDIT, Perm.REPORT_VIEW),
            Map.entry(Perm.SALARY_EDIT, Perm.SALARY_VIEW),   // 2026-10-04 用户拍板「按你推荐」:工资录入单列
            Map.entry(Perm.SYSTEM_EDIT, Perm.SYSTEM_VIEW));
        assertThat(Perm.IMPLIED_VIEW).containsExactlyInAnyOrderEntriesOf(design);

        Map<String, Perm.Meta> meta = new HashMap<>();
        for (Perm.Meta m : Perm.META) meta.put(m.key(), m);
        design.forEach((edit, view) -> {
            assertThat(meta.get(edit).kind()).as(edit).isEqualTo("edit");
            assertThat(meta.get(view).kind()).as(view).isEqualTo("view");
            assertThat(meta.get(edit).group()).as(edit + " 与 " + view + " 同组").isEqualTo(meta.get(view).group());
        });

        assertThat(Perm.IMPLIED_VIEW.values()).doesNotContain(Perm.ANALYSIS_VIEW);
        assertThat(Perm.withImplied(List.of(Perm.ENTRY_EDIT)))
            .as("事后录入不带出工资").containsExactlyInAnyOrder(Perm.ENTRY_EDIT, Perm.ENTRY_VIEW);
    }

    @Test
    @DisplayName("META 与 ALL 同序同集；group 只用固定的 11 个模块键,kind 只用 view/edit/other")
    void metaGroupsAndKindsAreWellFormed() {
        assertThat(Perm.META.stream().map(Perm.Meta::key).toList()).containsExactlyElementsOf(Perm.ALL);
        assertThat(Perm.ALL).hasSize(28).doesNotHaveDuplicates();
        Set<String> groups = Set.of("master", "contract", "param", "meter", "billing", "entry", "salary",
                                    "report", "analysis", "system", "other");
        assertThat(Perm.META).allSatisfy(m -> {
            assertThat(groups).as(m.key()).contains(m.group());
            assertThat(Set.of("view", "edit", "other")).as(m.key()).contains(m.kind());
            assertThat("other".equals(m.group())).as(m.key() + ":other 组与 other 种类成对").isEqualTo("other".equals(m.kind()));
        });
        // 每个业务组恰好一个查看点 —— 「编辑隐含查看」靠它推出来
        for (String g : groups) {
            if (g.equals("other")) continue;
            assertThat(Perm.META.stream().filter(m -> m.group().equals(g) && m.kind().equals("view")).count())
                .as("模块 %s 的查看点个数", g).isEqualTo(1);
        }
    }
}
