package com.park.demo3.security;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.DirectoryStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.fail;

/**
 * SIDEBAR-UX-REDESIGN §7.4 的覆盖率门 —— **R1 的验收判据**（spec §9 R1 行：
 * 「删掉某 service 的守卫调用 → 覆盖率测试红」）。
 *
 * 半年后有人给附表12 加一个新写端点忘了挂审核守卫，这个测试当场红 —— 而不是等到
 * 「屏上显示已审核、数据照改」被人发现。模板是同目录的 PermissionCoverageTest，
 * 四条骨架照抄：不起 Spring 上下文（直接读源码文本）· 防空扫的自证断言 ·
 * 豁免名单来自产品代码（{@link NoReviewGuard} 注解，不在测试里另写一份常量数组）·
 * 失败消息带修复指路。
 *
 * <h2>推导链（四步，不手写清单 —— spec §7.4：stage-review 2026-08-31 新1 的教训）</h2>
 * <pre>
 * ① 读 PermissionRegistry.java 源码 → 抓出全部登记过的 /api URL pattern
 * ② 扫 controller 目录 → @RequestMapping 的前两段命中 ① → 命中的 controller 文件集合
 * ③ 每个命中 controller 的非 GET 方法 → 方法体里 `xxxService.yyy(` → (service 类名, 方法名)
 * ④ 打开该 service 源码定位那个方法 → 方法体含 reviewGuard.assert（含同类内转调）
 *    或方法上有 @NoReviewGuard
 * </pre>
 *
 * <h2>审核相关性怎么判（这是本测试唯一的口径选择，改它前先读完这一段）</h2>
 *
 * 一个写端点进不进本测试的分母，判据是**它要的权限点落不落在 ReviewKind.perms() 的并集里**
 * （目前 = param-policy / param-monthly / meter-reading / billing-run / entry 五个 edit 权），
 * 判定落在 controller 这一档：该 controller 只要有**一个**写端点要这五个权之一，它的写方法全进。
 *
 * 为什么不是「全部 156 个写端点都要挂」：合同 / 主数据 / 报表 / 系统管理这些写端点根本不碰
 * 期间数据，要它们逐个挂 @NoReviewGuard 会把白名单从 41 条撑到 99 条 —— 白名单是例外不是常态
 * （spec §7.4），撑大了没人会再逐条看。
 *
 * 为什么不是「凡是注入了 ReviewGuard 的 service 就算」：那是循环判据 —— 把某个 service 的守卫
 * 字段连同调用一起删掉，它就自动退出分母，测试照绿。本判据只读 PermissionRegistry 与
 * ReviewKind 两张产品代码里的表，与「有没有守卫」无关。
 *
 * 为什么落在 controller 而不是逐端点：同一个 controller 里 meter-master（表档案）与
 * meter-reading（抄读数）混着排，逐端点判会把 MeterService.create / PvMeterService.createStation
 * 这些已经明确标了 @NoReviewGuard 的方法踢出分母 —— 删掉它们的注解将不再报红。
 *
 * <h2>已知口径边界（照 ponytail 的规矩把天花板写明）</h2>
 * <ul>
 *   <li>ponytail: 守卫的传递闭包按**方法名**算，不区分重载。LedgerService.bindRow 两个重载里
 *       2 参那个转调 3 参那个，名字相同所以一起算守住 —— 对这一处是对的；代价是将来若有同名
 *       重载一个守一个不守，本测试看不出来。升级路径：真出现那种重载时改成按参数个数配对。</li>
 *   <li>ponytail: /api/books 两条模板写端点要的是 book-template:edit / :switch，不在
 *       ReviewKind.perms() 里，所以 BookController 不进分母；BookService 那两条 @NoReviewGuard
 *       因此是「写了但没被用上」的说明性注解。它自己有同型守卫 assertMonthEditable（P6 录入即冻结），
 *       不靠本测试守。等模板真进审核键时它会自动进分母。</li>
 * </ul>
 */
class ReviewGuardCoverageTest {

    private static final Path CONTROLLERS = Paths.get("src/main/java/com/park/demo3/controller");
    private static final Path SERVICES    = Paths.get("src/main/java/com/park/demo3/service");
    private static final Path REGISTRY    =
        Paths.get("src/main/java/com/park/demo3/security/PermissionRegistry.java");

    /** ①：注册表里登记过的 URL。注释与字符串已抹平，所以剩下的 "/api…" 一定是真规则里的。 */
    private static final Pattern API_LITERAL = Pattern.compile("\"(/api/[^\"]*)\"");
    /** ②：controller 的类级前缀。**这条正则失配 = 分母塌成 0**，靠 scanFoundEnoughWriteMethods 兜。 */
    private static final Pattern CLASS_MAPPING =
        Pattern.compile("@RequestMapping\\s*\\(\\s*\"([^\"]*)\"\\s*\\)");
    /** ③：非 GET 端点。GET 不进 —— 读全开，审核只锁写。 */
    private static final Pattern WRITE_MAPPING = Pattern.compile(
        "@(Post|Put|Patch|Delete)Mapping\\s*(?:\\(\\s*(?:value\\s*=\\s*)?\"([^\"]*)\"\\s*\\))?");
    private static final Pattern PUBLIC_SIG =
        Pattern.compile("public\\s+[\\w<>,\\[\\]\\.\\? ]+?\\s+(\\w+)\\s*\\(");
    private static final Pattern CTRL_FIELD =
        Pattern.compile("private\\s+final\\s+(\\w+)\\s+(\\w+)\\s*;");
    private static final Pattern CALL = Pattern.compile("\\b(\\w+)\\.(\\w+)\\s*\\(");
    /** ④：service 里的方法声明（含 private 助手 —— 守卫大多落在 assertXxxEditable 这类助手里）。 */
    private static final Pattern METHOD_SIG = Pattern.compile(
        "\\n\\s*(?:public|private|protected)\\s+[\\w<>,\\[\\]\\.\\? ]+?\\s+(\\w+)\\s*\\(");
    private static final Pattern NO_GUARD_REASON =
        Pattern.compile("@NoReviewGuard\\s*\\(\\s*reason\\s*=\\s*\"([^\"]*)\"\\s*\\)");
    private static final String GUARD_CALL = "reviewGuard.assert";

    /** 一条写路径：controller 端点 → service 方法。 */
    private record Row(String controller, String ctrlMethod, HttpMethod verb, String path,
                       String service, String svcMethod) {}

    /** 一条豁免：谁、为什么。名单来自产品代码的注解，测试里没有第二份。 */
    private record Exemption(String service, String method, String reason) {}

    // ── 源码文本预处理 ────────────────────────────────────────────────────────

    /**
     * 把注释与字符串/字符字面量的**内容**抹成空格，长度与下标保持不变。
     *
     * 两个必须做的理由：
     *  1. @RequestParam @Pattern(regexp = "\\d{4}-(0[1-9]|1[0-2])") 里的花括号会把方法体的
     *     大括号配对整个带偏 —— 不抹的话 5 个端点直接解析不出来。
     *  2. 注释里写着 reviewGuard.assertEditable 的一句说明，会让一个**被注释掉**的守卫算数。
     */
    private static String blank(String src) {
        char[] out = src.toCharArray();
        int i = 0, n = src.length();
        while (i < n) {
            char c = src.charAt(i);
            if (c == '/' && i + 1 < n && src.charAt(i + 1) == '/') {
                while (i < n && src.charAt(i) != '\n') out[i++] = ' ';
            } else if (c == '/' && i + 1 < n && src.charAt(i + 1) == '*') {
                out[i] = ' '; out[i + 1] = ' '; i += 2;
                while (i + 1 < n && !(src.charAt(i) == '*' && src.charAt(i + 1) == '/')) {
                    if (src.charAt(i) != '\n') out[i] = ' ';
                    i++;
                }
                if (i + 1 < n) { out[i] = ' '; out[i + 1] = ' '; i += 2; }
            } else if (c == '"' || c == '\'') {
                char q = c;
                i++;
                while (i < n && src.charAt(i) != q) {
                    if (src.charAt(i) == '\\') { out[i] = ' '; i++; }
                    if (i < n) out[i++] = ' ';
                }
                i++;
            } else {
                i++;
            }
        }
        return new String(out);
    }

    /** 从 from 起找第一个 '{'，返回配对的方法体（不含两端大括号）。源码须先过 blank()。 */
    private static String bodyAfter(String blanked, int from) {
        int j = blanked.indexOf('{', from);
        if (j < 0) return null;
        int depth = 0;
        for (int k = j; k < blanked.length(); k++) {
            char c = blanked.charAt(k);
            if (c == '{') depth++;
            else if (c == '}' && --depth == 0) return blanked.substring(j + 1, k);
        }
        return null;
    }

    private static Map<String, String> readAll(Path dir) throws IOException {
        Map<String, String> out = new LinkedHashMap<>();
        try (DirectoryStream<Path> ds = Files.newDirectoryStream(dir, "*.java")) {
            for (Path f : ds) out.put(f.getFileName().toString(), Files.readString(f, StandardCharsets.UTF_8));
        }
        return out;
    }

    // ── 推导链 ────────────────────────────────────────────────────────────────

    private static List<Row> cached;

    private static synchronized List<Row> rows() throws IOException {
        if (cached == null) cached = derive();
        return cached;
    }

    private static List<Row> derive() throws IOException {
        // ① 注册表里登记过的 URL → 前两段（/api/salary、/api/pv-meter …）
        String regSrc = blank(Files.readString(REGISTRY, StandardCharsets.UTF_8));
        Set<String> registered = new TreeSet<>();
        Matcher rm = API_LITERAL.matcher(Files.readString(REGISTRY, StandardCharsets.UTF_8));
        while (rm.find()) {
            if (regSrc.charAt(rm.start()) != '"') continue;   // 注释里的路径不算
            registered.add(head2(rm.group(1)));
        }

        // ② controller 的类级前缀命中 ①
        PermissionRegistry reg = new PermissionRegistry();
        Set<String> kindPerms = new HashSet<>();
        for (ReviewKind k : ReviewKind.values()) kindPerms.addAll(k.perms());

        Map<String, String> ctrlSrc = readAll(CONTROLLERS);
        List<Row> out = new ArrayList<>();
        for (Map.Entry<String, String> e : ctrlSrc.entrySet()) {
            String file = e.getKey().substring(0, e.getKey().length() - ".java".length());
            String src = e.getValue(), s = blank(src);
            Matcher cm = CLASS_MAPPING.matcher(src);
            String base = null;
            while (cm.find()) {
                if (s.charAt(cm.start()) != '@') continue;
                base = cm.group(1);
                break;
            }
            if (base == null || !registered.contains(head2(base))) continue;

            // ③ 非 GET 端点 → service 调用
            Map<String, String> fields = new HashMap<>();
            Matcher fm = CTRL_FIELD.matcher(s);
            while (fm.find()) fields.put(fm.group(2), fm.group(1));

            List<Row> here = new ArrayList<>();
            boolean reviewRelevant = false;
            Matcher wm = WRITE_MAPPING.matcher(src);
            while (wm.find()) {
                if (s.charAt(wm.start()) != '@') continue;
                HttpMethod verb = HttpMethod.valueOf(wm.group(1).toUpperCase(Locale.ROOT));
                String path = join(base, wm.group(2) == null ? "" : wm.group(2));

                Matcher sig = PUBLIC_SIG.matcher(s).region(wm.end(), s.length());
                if (!sig.find()) {
                    fail("解析不出 " + file + " 里 " + verb + " " + path + " 的方法签名 —— "
                       + "推导链断了就必须响，不许 continue（spec §7.4）");
                }
                String ctrlMethod = sig.group(1);
                String body = bodyAfter(s, sig.start());
                if (body == null) {
                    fail("解析不出 " + file + "." + ctrlMethod + " 的方法体 —— 大括号配对失败");
                }

                Set<String> targets = new LinkedHashSet<>();
                Matcher call = CALL.matcher(body);
                while (call.find()) {
                    String type = fields.get(call.group(1));
                    if (type != null && type.endsWith("Service")) targets.add(type + "#" + call.group(2));
                }
                if (targets.size() != 1) {
                    fail("从 " + file + "." + ctrlMethod + "（" + verb + " " + path + "）解析不出唯一的"
                       + " service 调用，找到 " + targets + " —— 一个端点转调两个 service 时守卫该挂哪个"
                       + "要人看过才知道，不许跳过（spec §7.4）");
                }
                String t = targets.iterator().next();
                here.add(new Row(file, ctrlMethod, verb, path,
                                 t.substring(0, t.indexOf('#')), t.substring(t.indexOf('#') + 1)));

                List<String> anyOf = reg.resolve(verb, path);
                if (anyOf != null && anyOf.stream().anyMatch(kindPerms::contains)) reviewRelevant = true;
            }
            if (reviewRelevant) out.addAll(here);
        }
        return out;
    }

    private static String head2(String p) {
        String[] seg = p.split("/");
        StringBuilder b = new StringBuilder();
        for (String x : seg) {
            if (x.isEmpty()) continue;
            b.append('/').append(x);
            if (b.chars().filter(c -> c == '/').count() == 2) break;
        }
        return b.toString();
    }

    private static String join(String base, String sub) {
        String b = base.endsWith("/") ? base.substring(0, base.length() - 1) : base;
        if (sub.isEmpty()) return b.isEmpty() ? "/" : b;
        return b + (sub.startsWith("/") ? sub : "/" + sub);
    }

    // ── ④ service 侧：守卫 / 豁免 ────────────────────────────────────────────

    /** 一个 service 类里，能走到 reviewGuard.assert 的方法名（含同类内一层层的转调）。 */
    private static Set<String> guardingMethods(Map<String, List<String>> bodies) {
        Set<String> guarding = new TreeSet<>();
        for (Map.Entry<String, List<String>> e : bodies.entrySet())
            if (e.getValue().stream().anyMatch(b -> b.contains(GUARD_CALL))) guarding.add(e.getKey());
        boolean changed = !guarding.isEmpty();
        while (changed) {
            changed = false;
            Pattern p = Pattern.compile("\\b(" + String.join("|", guarding) + ")\\s*\\(");
            for (Map.Entry<String, List<String>> e : bodies.entrySet()) {
                if (guarding.contains(e.getKey())) continue;
                if (e.getValue().stream().anyMatch(b -> p.matcher(b).find())) {
                    guarding.add(e.getKey());
                    changed = true;
                    break;   // guarding 变了就重编正则，别在旧的上继续走
                }
            }
        }
        return guarding;
    }

    /** 方法名 → 该名下所有方法体（重载归一档，见类注释里的天花板说明）。 */
    private static Map<String, List<String>> methodBodies(String blanked) {
        Map<String, List<String>> out = new LinkedHashMap<>();
        Matcher m = METHOD_SIG.matcher(blanked);
        while (m.find()) {
            String body = bodyAfter(blanked, m.end() - 1);
            if (body != null) out.computeIfAbsent(m.group(1), k -> new ArrayList<>()).add(body);
        }
        return out;
    }

    /** 方法上带 @NoReviewGuard 的方法名。注解块之后的第一个方法声明就是它标的那个。 */
    private static Set<String> exemptMethods(String blanked) {
        Set<String> out = new TreeSet<>();
        int i = blanked.indexOf("@NoReviewGuard");
        while (i >= 0) {
            Matcher m = METHOD_SIG.matcher(blanked).region(i, blanked.length());
            if (m.find()) out.add(m.group(1));
            i = blanked.indexOf("@NoReviewGuard", i + 1);
        }
        return out;
    }

    private static List<Exemption> whitelist() throws IOException {
        List<Exemption> out = new ArrayList<>();
        for (Map.Entry<String, String> e : readAll(SERVICES).entrySet()) {
            String src = e.getValue(), s = blank(src);
            String svc = e.getKey().replace(".java", "");
            Matcher m = NO_GUARD_REASON.matcher(src);
            while (m.find()) {
                if (s.charAt(m.start()) != '@') continue;
                Matcher sig = METHOD_SIG.matcher(s).region(m.start(), s.length());
                out.add(new Exemption(svc, sig.find() ? sig.group(1) : "???", m.group(1)));
            }
        }
        return out;
    }

    // ── 断言 ──────────────────────────────────────────────────────────────────

    @Test
    @DisplayName("审核相关的写方法都要么挂了守卫、要么显式豁免（漏挂 = 审过的表照改）")
    void everyWriteMethodIsGuardedOrExempt() throws IOException {
        Map<String, String> svcSrc = readAll(SERVICES);
        Map<String, Set<String>> guardingCache = new HashMap<>();
        Map<String, Set<String>> exemptCache = new HashMap<>();
        Map<String, Set<String>> declaredCache = new HashMap<>();

        List<String> unguarded = new ArrayList<>();
        for (Row r : rows()) {
            String src = svcSrc.get(r.service() + ".java");
            if (src == null) {
                fail("找不到 " + r.service() + ".java —— " + r.controller() + "." + r.ctrlMethod()
                   + " 调的这个 service 不在 service 目录里，推导链断了");
            }
            String s = blank(src);
            Set<String> declared = declaredCache.computeIfAbsent(r.service(),
                k -> methodBodies(s).keySet());
            if (!declared.contains(r.svcMethod())) {
                fail("在 " + r.service() + " 里找不到方法 " + r.svcMethod() + "（来自 "
                   + r.controller() + "." + r.ctrlMethod() + "）—— 解析不出来必须响，不许 continue");
            }
            Set<String> guarding = guardingCache.computeIfAbsent(r.service(),
                k -> guardingMethods(methodBodies(s)));
            Set<String> exempt = exemptCache.computeIfAbsent(r.service(), k -> exemptMethods(s));
            if (!guarding.contains(r.svcMethod()) && !exempt.contains(r.svcMethod()))
                unguarded.add(r.service() + "." + r.svcMethod()
                            + "   ← " + r.controller() + "." + r.ctrlMethod()
                            + "  (" + r.verb() + " " + r.path() + ")");
        }

        assertThat(unguarded)
            .as("这些写方法既走不到 reviewGuard.assert 也没有 @NoReviewGuard："
              + "新加写方法请挂 ReviewGuard.assertEditable,或用 @NoReviewGuard(reason) 说明为什么不挂;"
              + "对照 spec §7.4")
            .isEmpty();
    }

    @Test
    @DisplayName("防空扫：推导链必须真的扫到东西（正则一坏就是永久假绿）")
    void scanFoundEnoughWriteMethods() throws IOException {
        assertThat(rows())
            .as("审核相关的写方法扫描结果太少 —— 说明 ①/②/③ 哪一步的正则或路径失效了，"
              + "这个测试等于没跑（实测 101 条）")
            .hasSizeGreaterThan(60);
    }

    @Test
    @DisplayName("每条 @NoReviewGuard 的 reason 都不许空 —— 空理由 = 悄悄开的洞")
    void everyNoReviewGuardHasNonBlankReason() throws IOException {
        List<Exemption> wl = whitelist();
        assertThat(wl)
            .as("一条 @NoReviewGuard 都没扫到 —— NO_GUARD_REASON 正则失效了，这条断言等于没跑")
            .hasSizeGreaterThan(20);
        assertThat(wl.stream().filter(x -> x.reason() == null || x.reason().isBlank()).toList())
            .as("豁免必须写实「为什么这个方法不该进审核」，不是写「不需要」；理由留白的豁免"
              + "和漏挂长得一模一样，半年后没人分得清")
            .isEmpty();
    }

    /**
     * 压根不产生期间数据的 service。它们上面的 @NoReviewGuard 不进「白名单要小」那个上限。
     *
     * 2026-09-08 加这一层之前,白名单里混着两拨性质完全不同的东西:
     *   ① 业务数据,但挂不上键 / 守卫在下游 —— PvMeter、CpMeter、Budget、ElecCost 那些。
     *      上限就是为它们设的:这一拨越多,越说明该回去想「是不是该给它一把审核键」。
     *   ② 根本不是业务数据 —— 登录、改密码、角色配置、编辑锁、在场心跳、审计流水。
     *      这一拨再多也不说明任何问题:登录永远不该进审核,数量跟设计好坏无关。
     * 混在一起数,第二拨会把第一拨的信号淹掉:补齐 17 条「不是业务数据」的豁免就撞了上限,
     * 而那 17 条恰恰是把「故意不管」和「忘了管」区分开的东西 —— 为了不撞上限而不写,
     * 等于为了让指示灯不亮而拔掉灯泡。
     *
     * ⚠ 往这个集合里加名字 = 宣称「这个 service 一行期间数据都不写」。加之前先确认。
     */
    private static final java.util.Set<String> NOT_PERIOD_DATA = java.util.Set.of(
        "SystemService", "AuthService", "ElevationService", "ApprovalService",
        "LockService", "PresenceService", "ImportLogService");

    @Test
    @DisplayName("白名单要小 —— 它是例外不是常态")
    void whitelistIsSmall() throws IOException {
        List<Exemption> all = whitelist();
        List<Exemption> businessData = all.stream()
            .filter(x -> !NOT_PERIOD_DATA.contains(x.service()))
            .toList();

        // 现值 41：PvMeter 8 + CpMeter 9 + ElecCost 6 + PvMeter 之外的档案类 8 + Review 4 + Budget 1 等。
        // 上限设 45，只留下一轮的余量：再多就不是「例外」了，该回去想想是不是该给它一把审核键，
        // 而不是继续往名单里加人（spec §7.4：白名单超过某个数就该重新想想）。
        assertThat(businessData)
            .as("@NoReviewGuard 太多了 —— 豁免成了常态。先读一遍这些 reason，"
              + "看是不是有几条其实该进 ReviewKind 而不是进白名单")
            .hasSizeLessThanOrEqualTo(45);

        // 防空扫:上面那个过滤器要是把所有人都滤掉了(比如 service() 的取值形状变了),
        // 这条断言就成了「0 ≤ 45」的恒真句。
        assertThat(businessData)
            .as("按 service 名过滤之后一条都不剩 —— 过滤器失效了，这条上限等于没设")
            .hasSizeGreaterThan(20);
    }

    @Test
    @DisplayName("14 把审核键每把都真锁得住（少一把 = 审了却锁不住，最坏的假绿）")
    void everyReviewKindIsGuardedSomewhere() throws IOException {
        // 只认「本身调了 reviewGuard.assert 的 service」里的出现。ReviewService 为了列清单
        // 也提到全部 14 个 kind，把它算进来的话这条断言恒绿 —— 那正是它要防的那种假绿。
        Map<String, String> guardingSrc = new LinkedHashMap<>();
        for (Map.Entry<String, String> e : readAll(SERVICES).entrySet()) {
            String s = blank(e.getValue());
            if (s.contains(GUARD_CALL)) guardingSrc.put(e.getKey(), s);
        }
        assertThat(guardingSrc)
            .as("没有任何 service 调 reviewGuard.assert —— 这条断言等于没跑")
            .hasSizeGreaterThan(10);

        // 三大报表的守卫是按 statement 反查 kind 的(ReviewKind.ofStatement(statement)),
        // 源码里不会出现 `ReviewKind.REPORT_IS` 这样的字面量。这不是放宽:ofStatement 是一个
        // 只覆盖这三把键的 switch(statement() 非空的恰好就是它们),所以「源码里出现 ofStatement」
        // 与「这三把键都被引用」是等价的。判据仍然只认**真的调过 reviewGuard.assert 的 service**。
        boolean byStatement = guardingSrc.values().stream().anyMatch(s -> s.contains("ReviewKind.ofStatement("));

        List<String> orphan = new ArrayList<>();
        for (ReviewKind k : ReviewKind.values()) {
            if (k.statement() != null && byStatement) continue;
            String ref = "ReviewKind." + k.name();
            if (guardingSrc.values().stream().noneMatch(s -> s.contains(ref)))
                orphan.add(k.name() + "（" + k.label() + "）");
        }
        assertThat(orphan)
            .as("这些审核键没有任何写路径守卫引用：屏上能交审、能通过，通过之后数据照改。"
              + "去对应的 service 挂上 ReviewGuard.assertEditable(ReviewKind.XXX, …)；对照 spec §7.4")
            .isEmpty();
        assertThat(ReviewKind.values()).as("键的数目变了就该有人来看一眼这份门禁").hasSize(17);
    }

    @Test
    @DisplayName("守卫落在 service 层，不是写在 controller 里")
    void guardIsCalledOnServiceLayer_notOnlyInControllers() throws IOException {
        // 守卫写在 controller 里等于没写：提权在 WriteAccessManager 放行，
        // 而内部 service 互调（ParamService.recalc → AllocService.generate）根本不过 controller。
        List<String> inControllers = new ArrayList<>();
        for (Map.Entry<String, String> e : readAll(CONTROLLERS).entrySet())
            if (blank(e.getValue()).contains(GUARD_CALL)) inControllers.add(e.getKey());
        assertThat(inControllers)
            .as("守卫出现在 controller 里 —— 内部 service 互调绕不过它，等于没守；请挪到 service")
            .isEmpty();

        List<String> inServices = new ArrayList<>();
        for (Map.Entry<String, String> e : readAll(SERVICES).entrySet())
            if (blank(e.getValue()).contains(GUARD_CALL)) inServices.add(e.getKey());
        assertThat(inServices)
            .as("调守卫的 service 少于 12 个（spec §7.4 点名的就是 12 个）—— 有 service 的守卫被整片删掉了")
            .hasSizeGreaterThanOrEqualTo(12);
    }

    @Test
    @DisplayName("推导链的第 ① ② 步自证：注册表读得到，controller 匹配得上")
    void derivationChainItselfIsAlive() throws IOException {
        String regSrc = Files.readString(REGISTRY, StandardCharsets.UTF_8);
        Matcher m = API_LITERAL.matcher(regSrc);
        int n = 0;
        while (m.find()) n++;
        assertThat(n).as("PermissionRegistry 里一条 /api 规则都没抓到 —— 第 ① 步失效").isGreaterThan(50);

        Set<String> ctrls = new TreeSet<>();
        for (Row r : rows()) ctrls.add(r.controller());
        assertThat(ctrls)
            .as("命中的 controller 太少 —— 第 ② 步的 @RequestMapping 匹配失效了（实测 17 个）")
            .hasSizeGreaterThan(10);
        assertThat(Arrays.stream(ReviewKind.values()).flatMap(k -> k.perms().stream()).distinct().toList())
            .as("ReviewKind 一个权限点都不要了 —— 审核相关性的判据塌了，分母会跟着塌")
            .isNotEmpty();
    }
}
