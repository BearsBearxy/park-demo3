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
import java.util.HashMap;
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
 * ① 扫 controller 目录 → 每个文件的类级 @RequestMapping 前缀
 * ② 该文件里全部 @(Post|Put|Patch|Delete)Mapping → 全站每一个非 GET 端点（实测 157 条）
 * ③ 端点方法体里 `xxxService.yyy(` → (service 类名, 方法名)
 * ④ 打开该 service 源码定位那个方法 → 方法体含 reviewGuard.assert（含同类内转调）
 *    或方法上有 @NoReviewGuard
 * </pre>
 * 四步里任何一步解析不出来都 fail 并点名，不许 continue —— 「解析不了就跳过」是这类测试
 * 最常见的假绿源（本仓成文规矩）。
 *
 * <h2>分母 = 全部写端点（2026-09-09 换的判据，改它前先读完这一段）</h2>
 *
 * 换之前的判据是「端点要的权限点落不落在 ReviewKind.perms() 的并集里」，且判在 **controller
 * 文件**这一档：同文件只要有一个写端点要那几个权，整个文件的写方法全进。分母 110 条，
 * 剩下 47 条门禁**根本看不见**。
 *
 * 那不是保守，是**结构性**的坏：判据判在文件边界上，而文件边界跟数据流毫无关系。两组实测对照：
 * <ul>
 *   <li>meter-master:edit 同一个权限点 —— MeterController.create/update/delete 进分母（靠同文件里
 *       meter-reading 的兄弟捎带），MeterBindingController.bind 出局，只因为它住在另一个 .java。</li>
 *   <li>billing-issue:edit 同一个权限点 —— BillNoticeController 四条进分母且真挂了守卫，
 *       BillController.savePaymap 出局，只因为它是那个文件里唯一的写端点。</li>
 * </ul>
 * 也就是说：把一个方法从 A 文件挪到 B 文件（bind 的历史就是这么来的），它就**静默退出分母**，
 * 门禁一声不吭。这比漏了某一条更糟。
 *
 * 现在的分母是**全部 157 个非 GET 端点**，一条不落。枚举方式与隔壁 PermissionCoverageTest.scan()
 * 同源（同一套 @RequestMapping / @XxxMapping 正则、同样 157 条），不另发明一套。
 *
 * 为什么不是「凡是注入了 ReviewGuard 的 service 就算」：那是循环判据 —— 把某个 service 的守卫
 * 字段连同调用一起删掉，它就自动退出分母，测试照绿。本判据只读 controller 源码里的
 * @(Post|Put|Patch|Delete)Mapping，与「有没有守卫」无关；顺带甩掉了旧判据对 ReviewKind.perms()
 * 的耦合（加一把新 kind 会悄悄改变分母，101→110 就是这么来的）。
 *
 * 为什么不排 SecurityPaths.PERMIT_ALL（隔壁 PermissionCoverageTest 排了它）：那边排是因为
 * permitAll 的路径**本来就走不到写规则**，不排会误报；这边「匿名可访问」不构成「可以不写理由」。
 * 全站唯一落在 PERMIT_ALL 里的写端点 POST /api/auth/login 照样得有落点（AuthService.login 上
 * 有 @NoReviewGuard）。不排更严，也少一份 PathPattern 机器。
 *
 * <h2>已知口径边界（照 ponytail 的规矩把天花板写明）</h2>
 * <ul>
 *   <li>ponytail: 守卫的传递闭包按**方法名**算，不区分重载。LedgerService.bindRow 两个重载里
 *       2 参那个转调 3 参那个，名字相同所以一起算守住 —— 对这一处是对的；代价是将来若有同名
 *       重载一个守一个不守，本测试看不出来。升级路径：真出现那种重载时改成按参数个数配对。</li>
 *   <li>ponytail: 一个端点转调两个 service 时直接 fail（守卫该挂哪个要人看过才知道）。全站 157 条
 *       目前一条都没触发；真出现时是加一条判定，不是放宽。</li>
 *   <li>换判据当天，19 条早就写好、但旧分母够不到的 @NoReviewGuard（SystemService 7 · LockService 4
 *       · PresenceService 2 · BookService 2 · Auth/Elevation/Approval/ImportLog 各 1）从
 *       「写了没被用上的说明性注解」变成真的在守门 —— 删掉其中任何一条现在都会报红。</li>
 * </ul>
 */
class ReviewGuardCoverageTest {

    private static final Path CONTROLLERS = Paths.get("src/main/java/com/park/demo3/controller");
    private static final Path SERVICES    = Paths.get("src/main/java/com/park/demo3/service");

    /** ①：controller 的类级前缀。**这条正则失配 = 分母塌成 0**，靠 scanFoundEnoughWriteMethods 兜。 */
    private static final Pattern CLASS_MAPPING =
        Pattern.compile("@RequestMapping\\s*\\(\\s*\"([^\"]*)\"\\s*\\)");
    /** ②：非 GET 端点。GET 不进 —— 读全开，审核只锁写。 */
    private static final Pattern WRITE_MAPPING = Pattern.compile(
        "@(Post|Put|Patch|Delete)Mapping\\s*(?:\\(\\s*(?:value\\s*=\\s*)?\"([^\"]*)\"\\s*\\))?");
    private static final Pattern PUBLIC_SIG =
        Pattern.compile("public\\s+[\\w<>,\\[\\]\\.\\? ]+?\\s+(\\w+)\\s*\\(");
    private static final Pattern CTRL_FIELD =
        Pattern.compile("private\\s+final\\s+(\\w+)\\s+(\\w+)\\s*;");
    private static final Pattern CALL = Pattern.compile("\\b(\\w+)\\.(\\w+)\\s*\\(");
    /** ③④：service 里的方法声明（含 private 助手 —— 守卫大多落在 assertXxxEditable 这类助手里）。 */
    private static final Pattern METHOD_SIG = Pattern.compile(
        "\\n\\s*(?:public|private|protected)\\s+[\\w<>,\\[\\]\\.\\? ]+?\\s+(\\w+)\\s*\\(");
    /**
     * ④：@NoReviewGuard 的 reason。**必须收得下 `"前半" + "后半"` 这种拼接**（2026-09-09 补）。
     *
     * 改之前只认单个字面量，而判「这个方法豁免没豁免」走的是 {@link #exemptMethods}（纯 indexOf），
     * 两条路径不同源 —— 于是把 reason 写成拼接的那条豁免会**从 whitelist() 里整条消失，却仍然免单**：
     * 既不计入「白名单要小」的上限，也不受「reason 不许空」的检查。实测踩中的是
     * ParamService#recalc（换行拼接），businessData 因此长期少数一条。
     *
     * 这一轮新写的 reason 最长 130+ 字，换行拼接是最自然的写法，不许拼接等于给写理由的人设一道
     * 没道理的门槛（而门槛的代价是「不写理由」）。所以是**收下拼接**而不是禁掉它；真解析不出来的
     * （比如 reason = 某个常量引用）由 whitelist() 当场 fail 点名，不静默跳过。
     */
    private static final Pattern NO_GUARD_REASON = Pattern.compile(
        "@NoReviewGuard\\s*\\(\\s*reason\\s*=\\s*(\"[^\"]*\"(?:\\s*\\+\\s*\"[^\"]*\")*)\\s*\\)");
    /** 从上面第 1 组里逐段抠出字面量内容（拼接时按序拼回一整句）。 */
    private static final Pattern STRING_LITERAL = Pattern.compile("\"([^\"]*)\"");
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
        Map<String, String> ctrlSrc = readAll(CONTROLLERS);
        List<Row> out = new ArrayList<>();
        for (Map.Entry<String, String> e : ctrlSrc.entrySet()) {
            String file = e.getKey().substring(0, e.getKey().length() - ".java".length());
            String src = e.getValue(), s = blank(src);

            // ① 类级前缀
            Matcher cm = CLASS_MAPPING.matcher(src);
            String base = null;
            while (cm.find()) {
                if (s.charAt(cm.start()) != '@') continue;
                base = cm.group(1);
                break;
            }

            Map<String, String> fields = new HashMap<>();
            Matcher fm = CTRL_FIELD.matcher(s);
            while (fm.find()) fields.put(fm.group(2), fm.group(1));

            // ② 该文件里全部非 GET 端点 —— 一条不筛
            Matcher wm = WRITE_MAPPING.matcher(src);
            while (wm.find()) {
                if (s.charAt(wm.start()) != '@') continue;
                HttpMethod verb = HttpMethod.valueOf(wm.group(1).toUpperCase(Locale.ROOT));
                // 有写端点却抓不到类级前缀 = 路径拼不出来。旧判据在这里 continue(前缀是用来配
                // 注册表的),换成全量枚举之后 continue 就等于让整个文件静默出局 —— 必须响。
                if (base == null) {
                    fail("解析不出 " + file + " 的类级 @RequestMapping，但它有 " + verb
                       + " 写端点 —— 整个文件会静默退出分母，不许 continue");
                }
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

                // ③ 端点方法体 → 唯一的 service 调用
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
                out.add(new Row(file, ctrlMethod, verb, path,
                                t.substring(0, t.indexOf('#')), t.substring(t.indexOf('#') + 1)));
            }
        }
        return out;
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

    /**
     * 白名单 = 全部 @NoReviewGuard，**与 {@link #exemptMethods} 同源**（2026-09-09 换的骨架）。
     *
     * 换之前是从 NO_GUARD_REASON 那条正则去找的：正则匹不上的注解**根本不进这份名单**，而
     * exemptMethods 只 indexOf 注解名、照样给它免单。两条路径不同源 = 一条静默逃逸口：
     * reason 写成拼接就悄悄退出上限、也躲过「reason 不许空」，实测 businessData 44→43 而三条
     * 断言全绿。所以现在先用同一个 indexOf 拿到注解全集，再逐个找 reason，找不到就 fail 点名。
     *
     * 扫 blanked 而不是 src：注释里写着 @NoReviewGuard 的一句说明不该算数（ElecCostService 里
     * 就有一条），blank() 已经把它抹平；reason 的内容再回 src 的同一下标去取（blank 保长保序）。
     */
    private static List<Exemption> whitelist() throws IOException {
        List<Exemption> out = new ArrayList<>();
        for (Map.Entry<String, String> e : readAll(SERVICES).entrySet()) {
            String src = e.getValue(), s = blank(src);
            String svc = e.getKey().replace(".java", "");
            int i = s.indexOf("@NoReviewGuard");
            while (i >= 0) {
                Matcher sig = METHOD_SIG.matcher(s).region(i, s.length());
                String method = sig.find() ? sig.group(1) : "???";
                Matcher m = NO_GUARD_REASON.matcher(src).region(i, src.length());
                // find() 会往后飘到**下一条**注解上，所以要认死 start()==i：这一条解析不出来就是
                // 解析不出来，不许让后面那条的 reason 顶包（推导链断了必须响，spec §7.4）。
                if (!m.find() || m.start() != i) {
                    fail("解析不出 " + svc + "." + method + " 的 @NoReviewGuard reason —— "
                       + "reason 必须是字符串字面量（允许 \"前半\" + \"后半\" 拼接，不许写成常量引用"
                       + "或别的表达式）；解析不出来的豁免会从白名单里消失却仍然免单，那正是这条"
                       + "断言要防的静默逃逸口");
                }
                StringBuilder reason = new StringBuilder();
                Matcher lit = STRING_LITERAL.matcher(m.group(1));
                while (lit.find()) reason.append(lit.group(1));
                out.add(new Exemption(svc, method, reason.toString()));
                i = s.indexOf("@NoReviewGuard", i + 1);
            }
        }
        return out;
    }

    // ── 待裁定名单（这是**欠账**，不是白名单）────────────────────────────────

    /**
     * 换判据（2026-09-09）当天照出来、但**判据本身就还没定**的写方法：既没挂守卫，也不该
     * 随手标 @NoReviewGuard —— 标了就等于替产品拍板，而这一档正是「拿不准就别加守卫、
     * 也别假装看过」的那一档。
     *
     * 它跟 @NoReviewGuard 是两种东西，所以**不进白名单**：
     *   · @NoReviewGuard 的 reason 是**结论**（「为什么这个方法不会改到已审月」）；
     *   · 这里的值是**问题**（等谁裁定什么）。混进白名单，一年后没人分得清哪些是看过的。
     *
     * 三条自证钉死它不会烂在这儿（见 pendingAdjudicationIsRealDebt）：
     *   ① 每条都必须**仍然**既无守卫又无注解 —— 一旦落地（补了守卫或补了注解）这条就变红，
     *      逼人把它从名单里删掉。这是它的「到期」机制：名单不会静默过期，只会主动喊。
     *   ② 每条都必须仍然对得上一个真实的写路径 —— 方法改名 / 端点删掉也变红。
     *   ③ 名单长度有上限，且上限就是现值。**目标状态是空**。往里加一条 = 上限也要跟着改，
     *      那是一个显眼、必须解释的动作；不许把它当成「变绿的近路」。
     *
     * <p>2026-09-09：**现值已经是 0**。原有的两条（MeterBindingService#bind / #autoLinkByName）
     * 当天裁完了 —— 绑定写的是 meter.contract_id / tenant_id，而 alloc_result 是按 ym 存的表、
     * 唯一写者 generate(ym) 已守 ALLOC+ALLOC_LOSS，bill_notice_line.contract_id 是出账快照、
     * 唯一写者 BillNoticeService.generate(ym) 已守 BILL_NOTICES：改绑定动不了已审月存下来的数。
     * 两条都改挂了 @NoReviewGuard（理由写在那两个方法上），名单随之清空，上限也跟着收到 0。
     * 名单空不等于这条断言空转：再往里加一条就红，逼人在 PR 里解释为什么又欠上了。
     */
    private static final Map<String, String> PENDING_ADJUDICATION = Map.of();

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
            if (!guarding.contains(r.svcMethod()) && !exempt.contains(r.svcMethod())
                && !PENDING_ADJUDICATION.containsKey(r.service() + "#" + r.svcMethod()))
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
    @DisplayName("防空扫：全站写端点必须真的扫到（正则一坏就是永久假绿）")
    void scanFoundEnoughWriteMethods() throws IOException {
        // 现值 157 条(与隔壁 PermissionCoverageTest 扫到的非 GET 端点数同源同值)。下限贴着现值:
        // 旧判据留了 60 的余量,结果 101→110 涨了 9 条也没人发现分母在动。
        assertThat(rows())
            .as("全站写端点扫描结果太少 —— 说明 ①/②/③ 哪一步的正则或路径失效了，这个测试等于没跑"
              + "（实测 157 条）")
            .hasSizeGreaterThan(150);
    }

    @Test
    @DisplayName("待裁定名单是真欠账：每条都还悬着、都对得上一条真路径、且名单在缩不在涨")
    void pendingAdjudicationIsRealDebt() throws IOException {
        Map<String, String> svcSrc = readAll(SERVICES);
        List<String> stale = new ArrayList<>();
        List<String> orphan = new ArrayList<>(PENDING_ADJUDICATION.keySet());

        for (Row r : rows()) {
            String key = r.service() + "#" + r.svcMethod();
            if (!PENDING_ADJUDICATION.containsKey(key)) continue;
            orphan.remove(key);
            String s = blank(svcSrc.get(r.service() + ".java"));
            if (guardingMethods(methodBodies(s)).contains(r.svcMethod())
                || exemptMethods(s).contains(r.svcMethod()))
                stale.add(key);
        }

        assertThat(orphan)
            .as("待裁定名单里这几条对不上任何写路径了（方法改名？端点删了？）—— 名单在替一个已经"
              + "不存在的东西开着口子，请删掉它们")
            .isEmpty();
        assertThat(stale)
            .as("这几条已经落地了（补了 reviewGuard.assert 或 @NoReviewGuard）—— 裁定做完就把它们从"
              + "PENDING_ADJUDICATION 里删掉；留着等于把「欠账」和「看过了」混成一堆")
            .isEmpty();
        assertThat(PENDING_ADJUDICATION.values().stream().filter(v -> v == null || v.isBlank()).toList())
            .as("待裁定条目必须写清「等谁裁定什么」—— 留白的欠账和漏挂长得一模一样")
            .isEmpty();
        // 上限就是现值,而现值已经是 0(两条 MeterBinding 2026-09-09 裁完)。往里加一条必须同时
        // 改这个断言 —— 逼人在 PR 里解释一句。
        assertThat(PENDING_ADJUDICATION)
            .as("待裁定名单变长了 —— 它是欠账不是白名单；新写方法要么挂守卫要么写 @NoReviewGuard，"
              + "只有「判据本身还没定」才配进这里，而那种事该有人拍板而不是攒着")
            .isEmpty();
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

    /**
     * 第三个桶（2026-09-09，随「分母换成全部写端点」一起加）：**写的表一列月份都没有**的方法。
     *
     * 为什么必须跟桶 ① 分开数，而不是把上限从 45 抬到 66：上限是「白名单是例外不是常态」这条信号
     * 的唯一载体，抬了就等于把它关掉。而这 21 条跟桶 ① 性质不同 ——
     *   桶 ① 是**确实写期间数据、只是挂不上键**（pv_record / charging_record 都带月）：这一拨越多，
     *        越说明该回去想「是不是该给它一把审核键」。上限就是为它们设的。
     *   这一桶是**根本没有月这一维**：合同 / 楼栋 / 单元 / 租户 / 公司 / 收款账户 / 收款映射，表上
     *        一列 ym 都没有，审核键 kind[:scope]:YYYY-MM 的 period 套不上去（用户 2026-09-08 拍板：
     *        合同、楼栋、租户不进审核）。这一拨再多也不说明设计有问题 —— 跟桶 ② 同理。
     * 混在一起数，这 21 条会把桶 ① 的信号淹掉：为了不撞上限而不写理由，等于为了让指示灯不亮
     * 而拔掉灯泡（2026-09-08 分出 NOT_PERIOD_DATA 时是同一个论证）。
     *
     * 为什么按**方法**而不是按 service：CompanyService 与 TenantService 各有一个方法（delete）
     * 这一轮补的是**真守卫** —— 它们确实能跨月改已审数据。整个 service 放进来就是自打嘴巴。
     * 按方法列还有个白拿的好处：将来给这几个 service 新加的豁免**不在名单里**，会照常计入上限，
     * 名单不会让整个 service 永久变暗。
     *
     * ⚠ 往这里加名字 = 宣称「这个方法碰的每一张表都没有月份列」。加之前先把建表 SQL 看一遍。
     */
    private static final java.util.Set<String> NO_MONTH_COLUMN = java.util.Set.of(
        "ContractService#create", "ContractService#update", "ContractService#delete",
        "ContractService#renew", "ContractService#terminate",
        "ContractService#importFull", "ContractService#importBillingLines",
        "BuildingService#create", "BuildingService#update", "BuildingService#delete",
        "BuildingService#createUnit", "BuildingService#updateUnit", "BuildingService#deleteUnit",
        "CompanyService#create", "CompanyService#update",
        "CompanyService#addAccount", "CompanyService#updateAccount", "CompanyService#deleteAccount",
        "TenantService#create", "TenantService#update",
        "BillsService#savePaymap");

    @Test
    @DisplayName("白名单要小 —— 它是例外不是常态")
    void whitelistIsSmall() throws IOException {
        List<Exemption> all = whitelist();
        List<Exemption> businessData = all.stream()
            .filter(x -> !NOT_PERIOD_DATA.contains(x.service()))
            .filter(x -> !NO_MONTH_COLUMN.contains(x.service() + "#" + x.method()))
            .toList();

        // 现值 47：PvMeter 8 + CpMeter 9 + ElecCost 5 + 表档案 3 + Review 5 + Recon 2 + Pnl 2 等。
        // 上限贴着现值，不留余量：再多就不是「例外」了，该回去想想是不是该给它一把审核键，
        // 而不是继续往名单里加人（spec §7.4：白名单超过某个数就该重新想想）。
        //
        // 2026-09-09 从 44/上限45 抬到 47/上限47，三条各有出处，都不是「新写了三条豁免」：
        //   +1 ParamService#recalc —— 它一直挂着 @NoReviewGuard，只是 reason 写成了换行拼接，
        //      被换判据前的 whitelist() 漏掉。**它本来就该被数**，这一条是把数补对不是放宽。
        //   +2 MeterBindingService#bind / #autoLinkByName —— 从 PENDING_ADJUDICATION 裁出来的，
        //      那份名单同步从 2 收到 0。「要人看一眼的方法」总数没变，只是换了个桶。
        // 也就是说这次抬上限**没有放过任何一个此前被拦住的方法**；下一次要抬,先确认也能这么说。
        assertThat(businessData)
            .as("@NoReviewGuard 太多了 —— 豁免成了常态。先读一遍这些 reason，"
              + "看是不是有几条其实该进 ReviewKind 而不是进白名单")
            .hasSizeLessThanOrEqualTo(47);

        // 防空扫:上面那两个过滤器要是把所有人都滤掉了(比如 service() 的取值形状变了),
        // 这条断言就成了「0 ≤ 47」的恒真句。
        assertThat(businessData)
            .as("按 service 名过滤之后一条都不剩 —— 过滤器失效了，这条上限等于没设")
            .hasSizeGreaterThan(20);

        // NO_MONTH_COLUMN 也会烂:方法改了名、或那条 @NoReviewGuard 被换成了真守卫,名字留在集合里
        // 就成了一张对谁都不生效的空头支票 —— 直到有人新写一个同名方法,它悄悄替那个新方法免了单。
        assertThat(NO_MONTH_COLUMN.stream()
                .filter(k -> all.stream().noneMatch(x -> (x.service() + "#" + x.method()).equals(k)))
                .sorted().toList())
            .as("NO_MONTH_COLUMN 里这几条对不上任何 @NoReviewGuard 了（改名？换成真守卫了？）"
              + "—— 请把它们从集合里删掉")
            .isEmpty();
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
    @DisplayName("推导链的第 ① ③ 步自证：controller 匹配得上，service 不是全塌成一个")
    void derivationChainItselfIsAlive() throws IOException {
        // 端点总数由 scanFoundEnoughWriteMethods 兜，这里兜的是「分布」：整条链可以在总数不变的
        // 前提下塌掉一维 —— 比如 CLASS_MAPPING 只在某几个文件命中、或 CTRL_FIELD 只认出一个字段，
        // 那时 rows() 还是一大把，却全挤在少数几个 controller / service 上。
        Set<String> ctrls = new TreeSet<>(), svcs = new TreeSet<>();
        for (Row r : rows()) { ctrls.add(r.controller()); svcs.add(r.service()); }
        assertThat(ctrls)
            .as("命中的 controller 太少 —— 第 ① 步的 @RequestMapping 匹配失效了（实测 35 个有写端点）")
            .hasSizeGreaterThan(30);
        assertThat(svcs)
            .as("解析出的 service 太少 —— 第 ③ 步的 CTRL_FIELD/CALL 匹配失效了（实测 33 个）")
            .hasSizeGreaterThan(28);
        // PermissionRegistry 不再进这条链（换判据后分母只看 controller 源码），它自己由隔壁
        // PermissionCoverageTest.everyWriteEndpointIsMapped 守着。
    }
}
