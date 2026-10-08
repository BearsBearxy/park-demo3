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
 * RBAC-SPEC §5.4 / §15.10:**本规范最重要的一条**。
 *
 * 扫源码里所有 controller 的端点,断言每一条都被 {@link PermissionRegistry} 覆盖(读写都默认拒绝)。
 * 半年后有人加了新接口忘了配权限,这个测试当场红——而不是等它在生产上 403 或裸奔。
 * 另钉 v4 权限点表本身的形状(107 项、每屏一个查看、隐含、不可提权)与两张规则表的回归点。
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
     *  · 映射注解括号里不是单个字面路径(数组、produces = …、常量)→ 红;
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

    private static List<org.springframework.web.util.pattern.PathPattern> permitAll() {
        var parser = org.springframework.web.util.pattern.PathPatternParser.defaultInstance;
        return Arrays.stream(SecurityPaths.PERMIT_ALL).map(parser::parse).toList();
    }

    private static boolean isPermitAll(String path) {
        return permitAll().stream().anyMatch(pp -> pp.matches(org.springframework.http.server.PathContainer.parsePath(path)));
    }

    private static Set<String> keysOfKind(String... kinds) {
        Set<String> ks = Set.of(kinds), out = new LinkedHashSet<>();
        for (Perm.Meta m : Perm.META) if (ks.contains(m.kind())) out.add(m.key());
        return out;
    }

    // ── 覆盖 ──────────────────────────────────────────────────────────────

    @Test
    @DisplayName("每一个写端点都必须被写规则表覆盖（默认拒绝，漏配即 403）")
    void everyWriteEndpointIsMapped() throws IOException {
        PermissionRegistry reg = new PermissionRegistry();
        List<Endpoint> all = scan();
        assertThat(all).as("controller 扫描结果为空 —— 说明正则或路径失效了，这个测试等于没跑").hasSizeGreaterThan(150);
        // permitAll 的路径走不到写规则(SecurityConfig 先放行)。白名单来自 SecurityPaths,测试里没有自己的一份
        List<String> uncovered = all.stream()
            .filter(e -> e.method() != HttpMethod.GET)
            .filter(e -> !isPermitAll(e.path()))
            .filter(e -> reg.resolve(e.method(), e.path()) == null)
            .map(e -> e.method() + " " + e.path() + "   (" + e.source() + ")")
            .sorted().toList();
        assertThat(uncovered)
            .as("这些写端点没有落进 PermissionRegistry，按「默认拒绝」它们会 403；新加接口请补一条规则，对照 RBAC-SPEC §15.5.2")
            .isEmpty();
    }

    @Test
    @DisplayName("每一个读端点(GET)都必须命中读规则表（默认拒绝，漏配即 403）")
    void everyReadEndpointIsMapped() throws IOException {
        PermissionRegistry reg = new PermissionRegistry();
        List<Endpoint> gets = scan().stream().filter(e -> e.method() == HttpMethod.GET).toList();
        assertThat(gets).as("GET 扫描结果太少 —— 正则或路径失效了，这个测试等于没跑").hasSizeGreaterThan(100);
        // 模板路径(/api/charging/{no}/records)落在铁律 4 的显式拒绝上也算已登记;真实路径由 ScreenAccessMatrixTest 钉
        List<String> uncovered = gets.stream()
            .filter(e -> !isPermitAll(e.path()))
            .filter(e -> reg.resolveRead(e.path()) == null)
            .map(e -> "GET " + e.path() + "   (" + e.source() + ")")
            .sorted().toList();
        assertThat(uncovered)
            .as("这些读端点没有落进 PermissionRegistry.registerReads，按「默认拒绝」它们对所有人 403；对照 RBAC-SPEC §15.5.1")
            .isEmpty();
    }

    @Test
    @DisplayName("写规则只引用存在的写权限(编辑 / 专有动作 / 跨屏),不引用查看 —— 写挂查看等于让只读的人能改")
    void writeRulesOnlyReferenceRealNonViewPerms() throws IOException {
        PermissionRegistry reg = new PermissionRegistry();
        Set<String> views = keysOfKind("view");
        List<String> bad = new ArrayList<>();
        for (Endpoint e : scan()) {
            if (e.method() == HttpMethod.GET) continue;
            List<String> anyOf = reg.resolve(e.method(), e.path());
            if (anyOf == null) continue;
            for (String p : anyOf)
                if (!PermissionRegistry.ANY_AUTHENTICATED.equals(p) && (!Perm.exists(p) || views.contains(p)))
                    bad.add(e.method() + " " + e.path() + " → " + p);
        }
        assertThat(bad).isEmpty();
    }

    @Test
    @DisplayName("读规则只许引用查看点 —— 读规则挂一个编辑等于让查看依赖编辑")
    void readRulesOnlyReferenceViewPerms() throws IOException {
        PermissionRegistry reg = new PermissionRegistry();
        Set<String> views = keysOfKind("view");
        List<String> bad = new ArrayList<>();
        for (Endpoint e : scan()) {
            if (e.method() != HttpMethod.GET) continue;
            List<String> anyOf = reg.resolveRead(e.path());
            if (anyOf == null) continue;
            for (String p : anyOf)
                if (!PermissionRegistry.ANY_AUTHENTICATED.equals(p) && !views.contains(p)) bad.add(e.path() + " → " + p);
        }
        assertThat(bad).isEmpty();
    }

    // ── 权限点表的形状(RBAC-SPEC §15.2) ─────────────────────────────────────

    @Test
    @DisplayName("ALL 107 项、与 META 同序;查看 51 且每屏恰好一个;编辑 34、专有动作 19、跨屏 3")
    void metaShape() {
        assertThat(Perm.META.stream().map(Perm.Meta::key).toList()).containsExactlyElementsOf(Perm.ALL);
        assertThat(Perm.ALL).hasSize(107).doesNotHaveDuplicates();
        assertThat(keysOfKind("view")).hasSize(51);
        assertThat(keysOfKind("edit")).hasSize(34);
        assertThat(keysOfKind("action")).hasSize(19);
        assertThat(keysOfKind("other")).containsExactly(Perm.REVIEW_APPROVE, Perm.LOCK_TAKEOVER, Perm.ELEVATE_REQUEST);
        for (Perm.Screen s : Perm.SCREENS) {
            assertThat(Perm.META.stream().filter(m -> s.value().equals(m.screen()) && "view".equals(m.kind())).map(Perm.Meta::key))
                .as("屏 %s 的查看", s.value()).containsExactly(s.value() + ":view");
        }
        assertThat(Perm.META).allSatisfy(m -> {
            assertThat("other".equals(m.kind())).as(m.key() + ":只有跨屏三项不挂屏").isEqualTo(m.screen() == null);
            if (m.screen() != null) {
                assertThat(m.key()).as("键 = <屏>:<动作>").startsWith(m.screen() + ":");
                assertThat(m.label()).as("中文名 = 屏名 · 动作").startsWith(Perm.screen(m.screen()).label() + " · ");
            }
            assertThat(m.key().length()).as("auth_role_perm.perm 是 varchar(32)").isLessThanOrEqualTo(32);
        });
    }

    @Test
    @DisplayName("隐含:每个编辑 / 专有动作 → 本屏查看,不跨屏;查看与跨屏三项不隐含任何东西")
    void impliedViewIsSameScreenOnly() {
        Set<String> writes = keysOfKind("edit", "action");
        assertThat(Perm.IMPLIED_VIEW.keySet()).isEqualTo(writes);
        Perm.IMPLIED_VIEW.forEach((w, v) ->
            assertThat(v).as(w).isEqualTo(w.substring(0, w.lastIndexOf(':')) + ":view"));
        assertThat(Perm.withImplied(List.of("bill-notices:issue")))
            .containsExactlyInAnyOrder("bill-notices:issue", "bill-notices:view");
        assertThat(Perm.withImplied(List.of("ledger:company", Perm.REVIEW_APPROVE)))
            .as("新增删除公司不带出报表屏;审核不带出任何屏").containsExactlyInAnyOrder("ledger:company", "ledger:view", Perm.REVIEW_APPROVE);
        assertThat(writes).allMatch(Perm::isWrite);
        assertThat(keysOfKind("view", "other")).noneMatch(Perm::isWrite);
    }

    @Test
    @DisplayName("不可提权 = §15.2 的「不可」列:全部查看、系统管理三屏全部动作、工资编辑、跨屏三项")
    void notElevatableMatchesDesign() {
        Set<String> design = new HashSet<>(keysOfKind("view"));
        design.addAll(List.of(Perm.SYS_USERS_EDIT, Perm.SYS_ROLES_EDIT, Perm.SALARY_EDIT,
            Perm.REVIEW_APPROVE, Perm.LOCK_TAKEOVER, Perm.ELEVATE_REQUEST));
        Set<String> notElevatable = new HashSet<>();
        for (String p : Perm.ALL) if (!Perm.elevatable(p)) notElevatable.add(p);
        assertThat(notElevatable).isEqualTo(design);
        assertThat(Perm.elevatable("master:edit")).as("旧键不存在,更谈不上可提权").isFalse();
        assertThat(Perm.isSystem(Perm.SYS_ROLES_EDIT)).isTrue();
        assertThat(Perm.isSystem("ledger:edit")).isFalse();
    }

    @Test
    @DisplayName("旧键:exists 不认、label 给「（旧版）」人话名;needText 三档")
    void legacyKeysAndNeedText() {
        assertThat(Perm.LEGACY_LABELS).hasSize(23);
        assertThat(Perm.LEGACY_LABELS.keySet()).noneMatch(Perm::exists);
        assertThat(Perm.label("billing-issue:edit")).isEqualTo("催缴单签发（旧版）");
        assertThat(Perm.label("bill-notices:issue")).isEqualTo("催缴单 · 签发");
        assertThat(Perm.needText(List.of("ledger:view"))).isEqualTo("「月度台账 · 查看」");
        assertThat(Perm.needText(List.of("ledger:view", "data-home:view")))
            .as("按 ALL 顺序").isEqualTo("「本月出账 · 查看」或「月度台账 · 查看」其中一项");
        assertThat(Perm.needText(List.of("cockpit:view", "ledger:view", "data-home:view", "park:view")))
            .isEqualTo("「本月出账 · 查看」「月度台账 · 查看」等 4 项中的任一项");
    }

    // ── 回归断言(RBAC-SPEC §5.4 / §15.5)──────────────────────────────────

    @Test
    @DisplayName("回归：段感知匹配 —— /api/elec 不得吞掉 /api/elec-cost,/api/pv 不得吞掉 /api/pv-meter")
    void segmentAwareMatching() {
        PermissionRegistry reg = new PermissionRegistry();
        assertThat(reg.resolve(HttpMethod.PUT, "/api/elec-cost/price-cfg")).containsExactly("elec-cost:price");
        assertThat(reg.resolve(HttpMethod.POST, "/api/elec-cost/simulate")).containsExactly("elec-cost:price");
        assertThat(reg.resolve(HttpMethod.POST, "/api/elec/records")).containsExactly("elec-cost:edit");
        assertThat(reg.resolve(HttpMethod.POST, "/api/pv-meter/readings")).containsExactly("pv-income:reading");
        assertThat(reg.resolve(HttpMethod.POST, "/api/pv/records")).containsExactly("pv-income:edit");
        assertThat(reg.resolve(HttpMethod.PUT, "/api/bills/paymap")).containsExactly("bill-notices:issue");
        assertThat(reg.resolve(HttpMethod.POST, "/api/bill-notices/generate")).containsExactly(Perm.BILL_NOTICES_EDIT);
        assertThat(reg.resolveRead("/api/pv-meter/years")).containsExactly("pv-income:view");
        assertThat(reg.resolveRead("/api/elec-cost/months")).containsExactly("elec-cost:view");
    }

    @Test
    @DisplayName("回归：首个命中 —— 具体规则不得被通配吃掉")
    void firstMatchWins() {
        PermissionRegistry reg = new PermissionRegistry();
        assertThat(reg.resolve(HttpMethod.PUT, "/api/alloc/rules/12")).containsExactly(Perm.ALLOC_POOLS, Perm.BILL_NOTICES_COEF);
        assertThat(reg.resolve(HttpMethod.DELETE, "/api/alloc/rules/12")).containsExactly(Perm.ALLOC_POOLS);
        assertThat(reg.resolve(HttpMethod.POST, "/api/alloc/generate")).containsExactly("alloc:edit", "alloc-loss:edit");
        assertThat(reg.resolve(HttpMethod.PUT, "/api/alloc/loss/note")).containsExactly("alloc-loss:edit");
        assertThat(reg.resolve(HttpMethod.POST, "/api/params/recalc")).containsExactly("params:recalc");
        assertThat(reg.resolve(HttpMethod.POST, "/api/price-cfg/copy")).containsExactly(Perm.PARAMS_MONTHLY);
        assertThat(reg.resolve(HttpMethod.POST, "/api/meters/readings")).containsExactly("meters:edit");
        assertThat(reg.resolve(HttpMethod.POST, "/api/meters/import")).containsExactly("meters:edit");
        assertThat(reg.resolve(HttpMethod.DELETE, "/api/meters/9")).containsExactly(Perm.METERS_ARCHIVE);
        assertThat(reg.resolve(HttpMethod.PUT, "/api/pv-meter/stations/3")).containsExactly("pv-income:archive");
        assertThat(reg.resolve(HttpMethod.POST, "/api/cp-meter/simulate")).containsExactly("car-charging:reading", "ebike-charging:reading");
        assertThat(reg.resolve(HttpMethod.POST, "/api/companies")).containsExactly("ledger:company");
        assertThat(reg.resolve(HttpMethod.PUT, "/api/companies/3")).containsExactly("bill-notices:payee");
        assertThat(reg.resolve(HttpMethod.PUT, "/api/books/7/template")).containsExactly("ledger:template", "sales-income:template");
        assertThat(reg.resolve(HttpMethod.POST, "/api/books/7/template/pin")).containsExactly("ledger:version", "sales-income:version");
        assertThat(reg.resolveRead("/api/tenants/summary")).containsExactly("tenants:view");
        assertThat(reg.resolveRead("/api/meters/9/readings")).containsExactly("meters:view", "alloc:view");
        assertThat(reg.resolveRead("/api/meters/readings/delete-preview")).containsExactly("meters:view");
        assertThat(reg.resolveRead("/api/alloc/rules")).containsExactly("params:view", "alloc:view", "bill-notices:view");
    }

    @Test
    @DisplayName("回归：任何已登录可写的几条;远程授权的发起要 elevate:request,批准任何已登录")
    void anyAuthenticatedWrites() {
        PermissionRegistry reg = new PermissionRegistry();
        assertThat(reg.resolve(HttpMethod.POST, "/api/import-log")).containsExactly(PermissionRegistry.ANY_AUTHENTICATED);
        assertThat(reg.resolve(HttpMethod.POST, "/api/auth/change-password")).containsExactly(PermissionRegistry.ANY_AUTHENTICATED);
        // ⚠ /api/auth/approvals/** 也匹配 /api/auth/approvals 本身:发起那条必须排在它前面
        assertThat(reg.resolve(HttpMethod.POST, "/api/auth/approvals")).containsExactly(Perm.ELEVATE_REQUEST);
        assertThat(reg.resolve(HttpMethod.POST, "/api/auth/approvals/7")).containsExactly(PermissionRegistry.ANY_AUTHENTICATED);
        assertThat(reg.resolve(HttpMethod.POST, "/api/brand-new-endpoint")).isNull();
        assertThat(reg.resolveRead("/api/brand-new-endpoint")).isNull();
    }

    @Test
    @DisplayName("回归：铁律 4 —— 按屏拆的路径段只认字面值,其余写法落显式拒绝(空 anyOf)")
    void literalSegmentsOnly() {
        PermissionRegistry reg = new PermissionRegistry();
        assertThat(reg.resolveRead("/api/charging/07/records")).isEmpty();
        assertThat(reg.resolveRead("/api/charging/+7/records")).isEmpty();
        assertThat(reg.resolveRead("/api/pnl/S1/2025")).isEmpty();
        assertThat(reg.resolveRead("/api/reports/IS/1/2025/1")).isEmpty();
        assertThat(reg.resolve(HttpMethod.POST, "/api/charging/07/records")).isEmpty();
        assertThat(reg.resolve(HttpMethod.PUT, "/api/pnl/S1/2025")).isEmpty();
        assertThat(reg.resolve(HttpMethod.PUT, "/api/reports/IS/1/2025/1")).isEmpty();
        assertThat(reg.resolveRead("/api/charging/7/records")).contains("car-charging:view").doesNotContain("ebike-charging:view");
        assertThat(reg.resolve(HttpMethod.POST, "/api/charging/8/records")).containsExactly("ebike-charging:edit");
    }

    @Test
    @DisplayName("回归：只给一屏的宽表 —— 台账 / 附表10 的整期逐户行不对催缴单、报表中心放行")
    void wideTablesStayOnTheirScreen() {
        PermissionRegistry reg = new PermissionRegistry();
        assertThat(reg.resolveRead("/api/bills")).containsExactly("ledger:view");
        assertThat(reg.resolveRead("/api/bills/s10")).containsExactly("sales-income:view");
        assertThat(reg.resolveRead("/api/bills/paymap")).containsExactly("bill-notices:view");
        assertThat(reg.resolveRead("/api/s10/1/2025/1")).containsExactly("sales-income:view");
        assertThat(reg.resolveRead("/api/s10/month-totals")).containsExactly("reports-home:view", "sales-income:view");
        assertThat(reg.resolveRead("/api/reports/tb/all/2025/1")).containsExactly("trial-balance:view");
        assertThat(reg.resolveRead("/api/salary/records")).containsExactly("salary:view");
        assertThat(reg.resolveRead("/api/companies/payees")).containsExactly("bill-notices:view");
        for (String fresh : List.of("/api/auth/approvals/history", "/api/auth/whatever", "/api/notices/all",
                                    "/api/review/export", "/api/probe/dump", "/api/app/secrets", "/api/system/secrets"))
            assertThat(reg.resolveRead(fresh)).as(fresh).isNull();
        assertThat(reg.resolve(HttpMethod.POST, "/api/system/whatever")).as("系统管理不留 /** 兜底").isNull();
        assertThat(reg.resolve(HttpMethod.POST, "/api/analysis/settings")).isNull();
    }

    /**
     * 工资的写一律 salary:edit。从 controller 源码枚举,不手抄清单 —— 将来 /api/salary 下新加一个写端点,它自动进这条断言。
     * 破坏验证:PermissionRegistry 把 "/api/salary" 挂到别的键 → 本条红;ReviewKind.SALARY 改掉 → 交审那条红;
     *          NOT_ELEVATABLE 去掉 SALARY_EDIT → 最后一条红。
     */
    @Test
    @DisplayName("工资的每一个写端点都只认 salary:edit;交审附表12 也只认它;它不可提权")
    void everySalaryWriteNeedsSalaryEdit() throws IOException {
        List<Endpoint> writes = scan().stream()
            .filter(e -> e.method() != HttpMethod.GET && e.path().startsWith("/api/salary/")).toList();
        assertThat(writes).as("SalaryController 的写端点:新增 / 改备注 / 删 / 导入 / 清空本期导入 / 批删").hasSize(6);
        PermissionRegistry reg = new PermissionRegistry();
        for (Endpoint e : writes)
            assertThat(reg.resolve(e.method(), e.path())).as(e.method() + " " + e.path()).containsExactly(Perm.SALARY_EDIT);
        assertThat(ReviewKind.SALARY.perms()).containsExactly(Perm.SALARY_EDIT);
        assertThat(reg.resolve(HttpMethod.POST, "/api/review/salary:2024-02/submit")).contains(Perm.SALARY_EDIT);
        assertThat(reg.resolve(HttpMethod.POST, "/api/review/salary:2024-02/recall")).contains(Perm.SALARY_EDIT);
        assertThat(Perm.elevatable(Perm.SALARY_EDIT)).as("借到它就能往看不见的工资表里写").isFalse();
    }

    /** 交审的 URL 门 = 每个 kind 的交审权并集:哪个 kind 的权限不在 URL 门里,只有那一项的人在 URL 层就被挡(v3 报表编辑就是这样漏的)。 */
    @Test
    @DisplayName("交审 / 撤回的 URL 门恰好是全部 kind 交审权的并集")
    void submitGateIsUnionOfKindPerms() {
        PermissionRegistry reg = new PermissionRegistry();
        Set<String> union = new HashSet<>();
        for (ReviewKind k : ReviewKind.values()) union.addAll(k.perms());
        assertThat(new HashSet<>(reg.resolve(HttpMethod.POST, "/api/review/report-is:3:2025-01/submit"))).isEqualTo(union);
        assertThat(new HashSet<>(reg.resolve(HttpMethod.POST, "/api/review/report-is:3:2025-01/recall"))).isEqualTo(union);
    }
}
