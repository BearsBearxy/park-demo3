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

    private static final Pattern CLASS_MAPPING =
        Pattern.compile("@RequestMapping\\s*\\(\\s*\"([^\"]*)\"\\s*\\)");
    private static final Pattern METHOD_MAPPING =
        Pattern.compile("@(Get|Post|Put|Patch|Delete)Mapping\\s*(?:\\(\\s*(?:value\\s*=\\s*)?\"([^\"]*)\"\\s*\\))?");

    private record Endpoint(HttpMethod method, String path, String source) {}

    // ── 扫描 ──────────────────────────────────────────────────────────────

    private List<Endpoint> scan() throws IOException {
        List<Endpoint> out = new ArrayList<>();
        try (DirectoryStream<Path> ds = Files.newDirectoryStream(CONTROLLERS, "*.java")) {
            for (Path f : ds) {
                String src = Files.readString(f, StandardCharsets.UTF_8);
                Matcher cm = CLASS_MAPPING.matcher(src);
                String base = cm.find() ? cm.group(1) : "";
                Matcher mm = METHOD_MAPPING.matcher(src);
                while (mm.find()) {
                    HttpMethod m = HttpMethod.valueOf(mm.group(1).toUpperCase(Locale.ROOT));
                    String sub = mm.group(2) == null ? "" : mm.group(2);
                    out.add(new Endpoint(m, join(base, sub), f.getFileName().toString()));
                }
            }
        }
        return out;
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
}
