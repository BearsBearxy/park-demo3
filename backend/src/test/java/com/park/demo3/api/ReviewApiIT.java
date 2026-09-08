package com.park.demo3.api;

import com.jayway.jsonpath.JsonPath;
import com.park.demo3.AbstractMysqlIT;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * 审核机制的端到端闭环(SIDEBAR-UX-REDESIGN §7.2 / §7.4)。
 *
 * 守卫本身由 {@code ReviewGuardIT} 逐条钉死,键解析由 {@code ReviewKeyTest} 钉死。
 * 这里只测**只有接上 HTTP 与账号体系才成立**的那几条:状态机、两种前置、理由必填、
 * 谁能审谁不能审、撤回限本人、review_log 落没落。
 *
 * 用 elec-model 这把键跑状态机:它的交审前置是「该月 elec_cost_entry 有行」,插一行就能
 * 造出 done —— 其余 13 把键的 done 要跑一遍首页聚合,得先造出台账/抄表/公摊一整套数据。
 * 前置图那两条用例直接往 review_state 塞行:前置判据读的就是 review_state,不碰业务数据。
 */
@AutoConfigureMockMvc
class ReviewApiIT extends AbstractMysqlIT {

    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;

    private static final String PASS = "init-pass-123";
    private static final String YM = "2031-07";           // 远期空月,不撞任何既有数据
    private static final String MODEL = "elec-model:" + YM;

    /**
     * ⚠ 按**年**清,不是按 YM 清。本类有两条用例故意写同年别的月(statesOfYear 那条要证明
     * 「一趟带回整年」)与次年一月;testcontainer 是复用的,某条中途红掉时它自己那句 DELETE
     * 就跑不到,残留行会让**下一次运行**的别的用例撞主键或多出一条 ——
     * 2026-09-07 破坏验证时实际发生过一次(pv:2031-02 撞主键)。
     */
    @AfterEach
    void wipe() {
        String year = YM.substring(0, 4);
        jdbc.update("DELETE FROM review_log WHERE review_key LIKE ?", "%" + year + "-__");
        jdbc.update("DELETE FROM review_state WHERE period LIKE ?", year + "-%");
        jdbc.update("DELETE FROM review_state WHERE period LIKE ?", (Integer.parseInt(year) + 1) + "-%");
        jdbc.update("DELETE FROM elec_cost_entry WHERE acct_month = ?", YM);
    }

    // ══ 状态机 ══════════════════════════════════════════════════════════════

    @Test
    void fullCycle_submitApproveWithdraw_andLogsEveryStep() throws Exception {
        String a = admin();
        seedElecCostEntry();

        assertThat(statusOf(a, MODEL)).isEqualTo("entered");

        ok(doPost("/api/review/" + MODEL + "/submit", a));
        assertThat(statusOf(a, MODEL)).isEqualTo("submitted");

        ok(doPost("/api/review/" + MODEL + "/approve", a));
        assertThat(statusOf(a, MODEL)).isEqualTo("approved");

        ok(doPostJson("/api/review/" + MODEL + "/withdraw", a, "{\"reason\":\"金额录错了\"}"));
        // 撤销 = 回派生态「录入中」,删行而不是留 returned
        assertThat(statusOf(a, MODEL)).isEqualTo("entered");
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM review_state WHERE review_key=?",
                Integer.class, MODEL)).isZero();

        List<Map<String, Object>> log = jdbc.queryForList(
            "SELECT action, actor, reason FROM review_log WHERE review_key=? ORDER BY id", MODEL);
        assertThat(log).hasSize(3);
        assertThat(log.stream().map(r -> r.get("action"))).containsExactly("submit", "approve", "withdraw");
        assertThat(log.stream().map(r -> r.get("actor"))).containsOnly("admin");
        assertThat(log.get(2).get("reason")).isEqualTo("金额录错了");
    }

    @Test
    void returned_keepsTheReason_andIsSubmittableAgain() throws Exception {
        String a = admin();
        seedElecCostEntry();
        ok(doPost("/api/review/" + MODEL + "/submit", a));

        ok(doPostJson("/api/review/" + MODEL + "/return", a, "{\"reason\":\"一期总表漏了基本电费\"}"));
        assertThat(statusOf(a, MODEL)).isEqualTo("returned");
        assertThat(reasonOf(a, MODEL)).isEqualTo("一期总表漏了基本电费");

        // returned 可再交审,且重交要把上一轮的退回痕迹清掉 —— 否则屏上「待审核」旁边还挂着旧理由
        ok(doPost("/api/review/" + MODEL + "/submit", a));
        assertThat(statusOf(a, MODEL)).isEqualTo("submitted");
        assertThat(reasonOf(a, MODEL)).isNull();
    }

    @Test
    void illegalTransitions_are409() throws Exception {
        String a = admin();
        seedElecCostEntry();
        // entered 直接通过 / 直接撤销
        assertThat(code(doPost("/api/review/" + MODEL + "/approve", a))).isEqualTo(409);
        assertThat(code(doPostJson("/api/review/" + MODEL + "/withdraw", a, "{\"reason\":\"x\"}"))).isEqualTo(409);
        // approved 再交审
        ok(doPost("/api/review/" + MODEL + "/submit", a));
        ok(doPost("/api/review/" + MODEL + "/approve", a));
        assertThat(code(doPost("/api/review/" + MODEL + "/submit", a))).isEqualTo(409);
    }

    @Test
    void submit_requiresTheRowToBeDone() throws Exception {
        String a = admin();
        // 该月一行 elec_cost_entry 都没有 → 未做,不能交审
        String r = body(doPost("/api/review/" + MODEL + "/submit", a));
        assertThat((int) JsonPath.read(r, "$.code")).isEqualTo(409);
        assertThat((String) JsonPath.read(r, "$.message")).contains("未做");

        seedElecCostEntry();
        ok(doPost("/api/review/" + MODEL + "/submit", a));
    }

    @Test
    void reasonIsMandatory_onReturnAndWithdraw() throws Exception {
        String a = admin();
        seedElecCostEntry();
        ok(doPost("/api/review/" + MODEL + "/submit", a));
        assertThat(code(doPostJson("/api/review/" + MODEL + "/return", a, "{\"reason\":\"\"}"))).isEqualTo(400);
        assertThat(code(doPostJson("/api/review/" + MODEL + "/return", a, "{\"reason\":\"   \"}"))).isEqualTo(400);
    }

    // ══ 撤回(R4)═════════════════════════════════════════════════════════════

    @Test
    void recall_byTheSubmitter_deletesTheRow_andIsSubmittableAgain() throws Exception {
        String a = admin();
        seedElecCostEntry();
        ok(doPost("/api/review/" + MODEL + "/submit", a));

        // 撤回**没有** body —— 加了 ReasonReq 的话这一句会 400
        ok(doPost("/api/review/" + MODEL + "/recall", a));
        // 与 withdraw 同形:删行,回派生态「录入中」,不留 returned
        assertThat(statusOf(a, MODEL)).isEqualTo("entered");
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM review_state WHERE review_key=?",
                Integer.class, MODEL)).isZero();

        List<Map<String, Object>> log = jdbc.queryForList(
            "SELECT action, actor, reason FROM review_log WHERE review_key=? ORDER BY id", MODEL);
        assertThat(log.stream().map(r -> r.get("action"))).containsExactly("submit", "recall");
        assertThat(log.get(1).get("reason")).as("撤回不带理由").isNull();

        // 闭环:撤回的整个意义就是「改完再交」,交不回去等于把人锁在外面
        ok(doPost("/api/review/" + MODEL + "/submit", a));
        assertThat(statusOf(a, MODEL)).isEqualTo("submitted");
    }

    /**
     * 别人交的撤不了 —— 打回去那条路是审核员的「退回」(要理由、留痕在行上)。
     *
     * 故意让 **admin** 去撤:他 13 个权限点全有、还能 approve,连他都撤不动,
     * 才说明这一条判的是「谁交的」而不是「有没有权限」。
     */
    @Test
    void recall_ofSomeoneElsesSubmission_is403_andTheRowStays() throws Exception {
        String a = admin();
        String u = mkUser(a, "it-clk", "finance_clerk");   // 有 entry:edit,交得了 elec-model 的审
        try {
            String t = login(u, PASS);
            seedElecCostEntry();
            ok(doPost("/api/review/" + MODEL + "/submit", t));

            String r = body(doPost("/api/review/" + MODEL + "/recall", a));
            assertThat((int) JsonPath.read(r, "$.code")).isEqualTo(403);
            // 文案要让人知道下一步该干什么,光说「不许」等于把人晾在那儿
            assertThat((String) JsonPath.read(r, "$.message")).contains(u).contains("退回");
            // 撤不动 ≠ 状态被动过
            assertThat(statusOf(a, MODEL)).isEqualTo("submitted");
        } finally { cleanup(u); }
    }

    /** 只有待审核态撤得回。已审核那一步该走审核员的「撤销审核」,已退回球本来就在录入人脚下。 */
    @Test
    void recall_onlyFromSubmitted_otherwise409() throws Exception {
        String a = admin();
        seedElecCostEntry();
        assertThat(code(doPost("/api/review/" + MODEL + "/recall", a))).as("录入中").isEqualTo(409);

        ok(doPost("/api/review/" + MODEL + "/submit", a));
        ok(doPostJson("/api/review/" + MODEL + "/return", a, "{\"reason\":\"重录\"}"));
        assertThat(code(doPost("/api/review/" + MODEL + "/recall", a))).as("已退回").isEqualTo(409);

        ok(doPost("/api/review/" + MODEL + "/submit", a));
        ok(doPost("/api/review/" + MODEL + "/approve", a));
        assertThat(code(doPost("/api/review/" + MODEL + "/recall", a))).as("已审核").isEqualTo(409);
    }

    /** 撤回挂的是「任一相关 edit 权」而不是 review:approve —— 审核员在 URL 层就进不来。 */
    @Test
    void recall_needsAnEditPermission_notReviewApprove() throws Exception {
        String a = admin();
        String u = mkUser(a, "it-rv", "reviewer");
        try {
            String t = login(u, PASS);
            seedState(MODEL, "elec-model", null, "submitted");
            mvc.perform(post("/api/review/" + MODEL + "/recall").header("Authorization", hdr(t)))
               .andExpect(status().isForbidden());
        } finally { cleanup(u); }
    }

    // ══ 两种前置 ════════════════════════════════════════════════════════════

    @Test
    void approve_blocksUntilUpstreamApproved() throws Exception {
        String a = admin();
        // alloc 已交审,但上游 params / meters 还没审 → 通过被挡,且要说清缺哪个
        seedState("alloc:" + YM, "alloc", null, "submitted");
        String r = body(doPost("/api/review/alloc:" + YM + "/approve", a));
        assertThat((int) JsonPath.read(r, "$.code")).isEqualTo(409);
        assertThat((String) JsonPath.read(r, "$.message")).contains("计费参数").contains("园区抄表");

        seedState("params:" + YM, "params", null, "approved");
        seedState("meters:" + YM, "meters", null, "approved");
        ok(doPost("/api/review/alloc:" + YM + "/approve", a));
    }

    /**
     * 撤销前置(D19)。这条打的是 spec §7.2 依赖图**漏掉的那条边**:
     * alloc-loss 的上游是 meters / params —— 池与损耗是 AllocService.generate(ym) 同一次算出来的。
     * 只照 spec 字面连 alloc 的话,这条会绿(放行),抄表员改完读数已审的损耗就和读数对不上了。
     */
    @Test
    void withdraw_blockedByApprovedDownstream_includingAllocLoss() throws Exception {
        String a = admin();
        seedState("meters:" + YM, "meters", null, "approved");
        seedState("alloc-loss:" + YM, "alloc-loss", null, "approved");

        String r = body(doPostJson("/api/review/meters:" + YM + "/withdraw", a, "{\"reason\":\"读数抄错\"}"));
        assertThat((int) JsonPath.read(r, "$.code")).isEqualTo(409);
        assertThat((String) JsonPath.read(r, "$.message")).contains("楼栋损耗");

        // 先撤下游,上游才撤得动
        ok(doPostJson("/api/review/alloc-loss:" + YM + "/withdraw", a, "{\"reason\":\"重算\"}"));
        ok(doPostJson("/api/review/meters:" + YM + "/withdraw", a, "{\"reason\":\"读数抄错\"}"));
    }

    // ══ 权限 ════════════════════════════════════════════════════════════════

    @Test
    void reviewerCanApprove_butCannotWriteAnyBusinessData() throws Exception {
        String a = admin();
        String u = mkUser(a, "it-rv", "reviewer");
        try {
            String t = login(u, PASS);
            seedState(MODEL, "elec-model", null, "submitted");

            // 审核员打业务写端点 → 真 403(SecurityConfig 的 accessDeniedHandler 出的,不是 body.code)
            mvc.perform(post("/api/elec-cost/entries").header("Authorization", hdr(t))
                    .contentType("application/json").content("{}"))
               .andExpect(status().isForbidden());

            // 但审得动
            ok(doPost("/api/review/" + MODEL + "/approve", t));
        } finally { cleanup(u); }
    }

    @Test
    void aClerkWithoutReviewApprove_cannotApprove() throws Exception {
        String a = admin();
        String u = mkUser(a, "it-clk", "finance_clerk");
        try {
            String t = login(u, PASS);
            seedState(MODEL, "elec-model", null, "submitted");
            // URL 层就挡住了:PermissionRegistry 给 approve 挂的是 review:approve
            mvc.perform(post("/api/review/" + MODEL + "/approve").header("Authorization", hdr(t)))
               .andExpect(status().isForbidden());
        } finally { cleanup(u); }
    }

    /**
     * 交审的 kind→perm 收窄 —— 这张表(ReviewKind.perms())的唯一消费点,也是它存在的全部理由。
     *
     * URL 层对 submit 放行的是「任一相关 edit 权」(要哪个权限点看 key 里的 kind,URL 判不出来),
     * 所以只有 entry:edit 的人**请求打得进来**,必须由 service 拦下他交 alloc 的审。
     * 这条红了就说明 kind→perm 那张表形同虚设。
     */
    @Test
    void submit_narrowsPermissionByKind_notJustByUrl() throws Exception {
        String a = admin();
        String role = "it_entry_only_" + System.nanoTime() % 100000;   // code 正则是 ^[a-z][a-z0-9_]{1,31}$,不许连字符
        int roleId = JsonPath.read(body(mvc.perform(MockMvcRequestBuilders.post("/api/system/roles")
            .header("Authorization", hdr(a)).contentType("application/json")
            .content("{\"code\":\"" + role + "\",\"name\":\"只录附表\",\"navLayers\":[\"data\"],"
                   + "\"perms\":[\"entry:edit\"]}")).andReturn()), "$.data.id");
        String u = "it-eo-" + System.nanoTime();
        try {
            mvc.perform(MockMvcRequestBuilders.post("/api/system/users")
                .header("Authorization", hdr(a)).contentType("application/json")
                .content("{\"username\":\"" + u + "\",\"displayName\":\"只录附表\","
                       + "\"password\":\"" + PASS + "\",\"roleIds\":[" + roleId + "]}"))
               .andExpect(status().isOk());
            String t = login(u, PASS);
            seedElecCostEntry();

            // alloc 要的是 billing-run:edit —— 请求打得进来(URL 层放行 entry:edit),被 service 拦下
            String r = body(doPost("/api/review/alloc:" + YM + "/submit", t));
            assertThat((int) JsonPath.read(r, "$.code")).isEqualTo(403);
            assertThat((String) JsonPath.read(r, "$.message")).contains("公共电核算");

            // 同一个人交 elec-model 的审没问题 —— 它要的正是 entry:edit
            ok(doPost("/api/review/" + MODEL + "/submit", t));
        } finally {
            cleanup(u);
            jdbc.update("DELETE FROM auth_role_perm WHERE role_id=?", roleId);
            jdbc.update("DELETE FROM auth_role WHERE id=?", roleId);
        }
    }

    // ══ 键里带冒号 ══════════════════════════════════════════════════════════

    /** ledger:7:2024-02 有两个冒号。@PathVariable 单段能不能吃下,这条是唯一的证据。 */
    @Test
    void keyWithTwoColons_reachesTheServiceIntact() throws Exception {
        String a = admin();
        String r = body(doPost("/api/review/ledger:7:" + YM + "/approve", a));
        // 走到了 service 才会是 409(状态不对);路由没解出来的话是 404/400,且 message 不会提「月度台账」
        assertThat((int) JsonPath.read(r, "$.code")).isEqualTo(409);
        assertThat((String) JsonPath.read(r, "$.message")).contains("月度台账").contains(YM);
    }

    // ══ 读侧 ════════════════════════════════════════════════════════════════

    @Test
    void list_enumeratesEveryKeyOfTheMonth_withDerivedEnteredAndBlockedBy() throws Exception {
        String a = admin();
        String b = body(doGet("/api/review?period=" + YM, a));
        List<String> keys = JsonPath.read(b, "$.data[*].key");
        List<String> kinds = JsonPath.read(b, "$.data[*].kind");

        // 出账 5 + 附10 四期区 + salary + utilities×2 + pv + 充电桩×2 + elec-cost + elec-model
        // + 台账每公司一把(公司数由库定,不写死)
        assertThat(keys).contains("params:" + YM, "meters:" + YM, "alloc:" + YM,
            "alloc-loss:" + YM, "bill-notices:" + YM, "salary:" + YM,
            "utilities:office:" + YM, "utilities:phase3:" + YM,
            "s10:1:" + YM, "s10:4:" + YM, "elec-cost:" + YM, "elec-model:" + YM);
        assertThat(kinds).contains("ledger");
        assertThat(keys).allMatch(k -> k.endsWith(YM));

        // 库里一行都没有 → 全部派生成 entered
        assertThat((List<String>) JsonPath.read(b, "$.data[*].status")).containsOnly("entered");

        // 通过前置缺项:alloc 缺两个上游,salary 没有前置 → 空数组不是 null
        List<List<String>> allocBlocked = JsonPath.read(b, "$.data[?(@.key=='alloc:" + YM + "')].blockedBy");
        assertThat(allocBlocked.get(0)).containsExactly("计费参数", "园区抄表");
        List<List<String>> salaryBlocked = JsonPath.read(b, "$.data[?(@.key=='salary:" + YM + "')].blockedBy");
        assertThat(salaryBlocked.get(0)).isEmpty();
    }

    /**
     * 闸道 `GET /api/review/states?year=`(R2 T4b)。
     *
     * 与 list 的分工要**当场看得出来**:这条只发已落库的行(没有派生 entered)、blockedBy 恒空、
     * 一趟给整年。年表屏(附6/7/8/11、附13/14)一屏 12 个月,走 list 等于跑 12 遍首页聚合。
     */
    @Test
    void statesOfYear_returnsOnlyPersistedRows_forTheWholeYear() throws Exception {
        String a = admin();
        int year = Integer.parseInt(YM.substring(0, 4));
        seedState("salary:" + YM, "salary", null, "approved");
        // 同年另一个月 —— 一趟要能把整年都带回来
        jdbc.update("INSERT INTO review_state (review_key, kind, period, scope, status) VALUES (?,?,?,?,?)",
            "pv:" + year + "-02", "pv", year + "-02", null, "submitted");

        String b = body(doGet("/api/review/states?year=" + year, a));
        List<String> keys = JsonPath.read(b, "$.data[*].key");
        assertThat(keys).containsExactlyInAnyOrder("salary:" + YM, "pv:" + year + "-02");
        // ❗不含派生 entered —— 含了就说明它偷偷走了 list 那条路(那条要跑首页聚合)
        assertThat(keys).doesNotContain("params:" + YM, "meters:" + YM);
        assertThat((List<String>) JsonPath.read(b, "$.data[*].status"))
            .containsExactlyInAnyOrder("approved", "submitted");
        // 闸只问「锁没锁」,不算前置
        List<List<String>> blocked = JsonPath.read(b, "$.data[*].blockedBy");
        assertThat(blocked).allSatisfy(x -> assertThat(x).isEmpty());
        // 清理交给 @AfterEach(它按年清)—— 写在这里的话断言一红就跑不到,残留会污染下一次运行
    }

    /** 别的年不许漏进来 —— likeRight 前缀写错(比如 like '%2031%')就会把 12031 之类也带上。 */
    @Test
    void statesOfYear_doesNotLeakOtherYears() throws Exception {
        String a = admin();
        int year = Integer.parseInt(YM.substring(0, 4));
        seedState("salary:" + YM, "salary", null, "approved");
        jdbc.update("INSERT INTO review_state (review_key, kind, period, scope, status) VALUES (?,?,?,?,?)",
            "salary:" + (year + 1) + "-01", "salary", (year + 1) + "-01", null, "approved");
        List<String> keys = JsonPath.read(body(doGet("/api/review/states?year=" + year, a)), "$.data[*].key");
        assertThat(keys).containsExactly("salary:" + YM);
        // 次年那行同样交给 @AfterEach
    }

    /**
     * 整月全审的月份(D20,年份条月格的 ✓)。
     *
     * 用 list() 拿到该月的**全部**键再逐把 approve —— 不手写那张键表:
     * 台账按公司数、附10 按期区数展开,写死就会跟着库漂。
     */
    @Test
    void closedMonths_needsEveryCountingKeyApproved_andIgnoresElecModel() throws Exception {
        String a = admin();
        List<String> keys = JsonPath.read(body(doGet("/api/review?period=" + YM, a)), "$.data[*].key");
        List<String> kinds = JsonPath.read(body(doGet("/api/review?period=" + YM, a)), "$.data[*].kind");

        // ① 差一把(salary 留着不审)→ 不在列表里
        for (int i = 0; i < keys.size(); i++)
            if (!keys.get(i).startsWith("salary:")) seedApproved(keys.get(i), kinds.get(i));
        assertThat(this.<List<String>>closed(a)).as("差一把就不算锁账").doesNotContain(YM);

        // ② 补上 salary,但 elec-model 仍**不审** → 照样算锁账(它没有清单行,§7.1)
        jdbc.update("DELETE FROM review_state WHERE review_key = ?", "elec-model:" + YM);
        for (int i = 0; i < keys.size(); i++)
            if (keys.get(i).startsWith("salary:")) seedApproved(keys.get(i), kinds.get(i));
        assertThat(this.<List<String>>closed(a))
            .as("elec-model 没有清单行,计入的话锁账永远达不成").contains(YM);
    }

    /** 只有几把键审了的月不许混进来 —— 那条 group-by 下限只是筛候选,判据仍是全集比对。 */
    @Test
    void closedMonths_doesNotLeakPartiallyApprovedMonths() throws Exception {
        String a = admin();
        seedState("params:" + YM, "params", null, "approved");
        seedState("meters:" + YM, "meters", null, "approved");
        assertThat(this.<List<String>>closed(a)).doesNotContain(YM);
    }

    private <T> T closed(String token) throws Exception {
        return JsonPath.read(body(doGet("/api/review/closed-months", token)), "$.data");
    }

    private void seedApproved(String key, String kind) {
        int i = key.lastIndexOf(':');
        String head = key.substring(0, i);
        int j = head.lastIndexOf(':');
        String scope = j < 0 ? null : head.substring(j + 1);
        jdbc.update("INSERT INTO review_state (review_key, kind, period, scope, status) VALUES (?,?,?,?,'approved')",
            key, kind, YM, scope);
    }

    // ══════════ helpers ══════════

    private void seedElecCostEntry() {
        jdbc.update("INSERT INTO elec_cost_entry (meter_id, acct_month, fee_key, sub_key, amount) "
                  + "SELECT MIN(id), ?, 'industrial', '', 100.00 FROM elec_meter", YM);
    }

    private void seedState(String key, String kind, String scope, String status) {
        jdbc.update("INSERT INTO review_state (review_key, kind, period, scope, status) VALUES (?,?,?,?,?)",
            key, kind, YM, scope, status);
    }

    private String statusOf(String token, String key) throws Exception {
        List<String> v = JsonPath.read(body(doGet("/api/review?period=" + YM, token)),
            "$.data[?(@.key=='" + key + "')].status");
        assertThat(v).hasSize(1);
        return v.get(0);
    }

    private String reasonOf(String token, String key) throws Exception {
        List<String> v = JsonPath.read(body(doGet("/api/review?period=" + YM, token)),
            "$.data[?(@.key=='" + key + "')].reason");
        return v.isEmpty() ? null : v.get(0);
    }

    private MvcResult doGet(String url, String token) throws Exception {
        return mvc.perform(MockMvcRequestBuilders.get(url).header("Authorization", hdr(token))).andReturn();
    }

    private MvcResult doPost(String url, String token) throws Exception {
        return mvc.perform(MockMvcRequestBuilders.post(url).header("Authorization", hdr(token))).andReturn();
    }

    private MvcResult doPostJson(String url, String token, String json) throws Exception {
        return mvc.perform(MockMvcRequestBuilders.post(url).header("Authorization", hdr(token))
            .contentType("application/json").content(json)).andReturn();
    }

    private void ok(MvcResult r) throws Exception {
        assertThat((int) JsonPath.read(body(r), "$.code"))
            .as("期望成功,实际:%s", body(r)).isZero();
    }

    private int code(MvcResult r) throws Exception { return JsonPath.read(body(r), "$.code"); }

    private String body(MvcResult r) throws Exception {
        return new String(r.getResponse().getContentAsByteArray(), StandardCharsets.UTF_8);
    }

    private String login(String user, String pass) throws Exception {
        String b = body(mvc.perform(MockMvcRequestBuilders.post("/api/auth/login")
            .contentType("application/json")
            .content("{\"username\":\"" + user + "\",\"password\":\"" + pass + "\"}")).andReturn());
        return JsonPath.read(b, "$.data.token");
    }

    private String admin() throws Exception { return login("admin", "admin123"); }
    private String hdr(String t) { return "Bearer " + t; }

    private String mkUser(String adminToken, String prefix, String roleCode) throws Exception {
        String uname = prefix + "-" + System.nanoTime();
        int roleId = roleIdOf(adminToken, roleCode);
        mvc.perform(MockMvcRequestBuilders.post("/api/system/users")
            .header("Authorization", hdr(adminToken)).contentType("application/json")
            .content("{\"username\":\"" + uname + "\",\"displayName\":\"审核测试\","
                   + "\"password\":\"" + PASS + "\",\"roleIds\":[" + roleId + "]}"))
           .andExpect(status().isOk());
        return uname;
    }

    private int roleIdOf(String token, String code) throws Exception {
        String b = body(doGet("/api/system/roles", token));
        List<Integer> ids = JsonPath.read(b, "$.data[?(@.code=='" + code + "')].id");
        assertThat(ids).as("预置角色 %s 应存在", code).hasSize(1);
        return ids.get(0);
    }

    private void cleanup(String username) {
        jdbc.update("DELETE FROM review_log WHERE actor=?", username);
        jdbc.update("DELETE FROM auth_audit_log WHERE actor=? OR authorizer=?", username, username);
        jdbc.update("DELETE aur FROM auth_user_role aur JOIN auth_user u ON u.id=aur.user_id WHERE u.username=?", username);
        jdbc.update("DELETE FROM auth_user WHERE username=?", username);
    }
}
