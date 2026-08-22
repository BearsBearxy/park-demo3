package com.park.demo3.api;

import com.jayway.jsonpath.JsonPath;
import com.park.demo3.AbstractMysqlIT;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import java.nio.charset.StandardCharsets;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * 主管当场授权提权(ELEVATION-SPEC)。
 *
 * 核心闭环:财务专员改不了计费口径 → 主管在他屏幕上输账号密码 → 30 分钟内改得了
 * → **审计记两个人**。最后一条是这套设计的全部意义 —— 没有它,提权就只是把墙拆了。
 */
@AutoConfigureMockMvc
class ElevationApiIT extends AbstractMysqlIT {
    @Autowired MockMvc mvc;
    @Autowired org.springframework.jdbc.core.JdbcTemplate jdbc;

    private static final String PASS = "init-pass-123";
    /** 计费口径键(Group.CONSTANT):财务专员不该改得动 */
    private static final String POLICY_BODY =
        "{\"key\":\"park_share_div\",\"scope\":\"p1\",\"mode\":\"from\",\"acctMonth\":\"2025-01\",\"value\":6}";
    /** 月度电价键(Group.MONTHLY)。V104 起也归主管级 —— 用来验证提权是**按权限点精确发放**的 */
    private static final String MONTHLY_BODY =
        "{\"key\":\"elec_flat\",\"scope\":\"p1\",\"mode\":\"month\",\"acctMonth\":\"2025-01\",\"value\":0.66}";

    // ══════════ 核心闭环 ══════════

    @Test
    void clerkCannotEditPolicyUntilManagerAuthorizesOnTheSpot() throws Exception {
        String a = admin();
        String clerk = mkUser(a, "it-elev-clerk", "finance_clerk");
        String boss  = mkUser(a, "it-elev-boss",  "finance_manager");
        try {
            String ct = login(clerk, PASS);

            // ① 两档都改不动(V104 起电价也收归主管级)
            assertCode(put("/api/params").header("Authorization", hdr(ct))
                .contentType("application/json").content(MONTHLY_BODY), 403);

            // ② 计费口径也 403。V104 之后专员两个 param 权限都没有 → 这一下是 **URL 层**挡的
            //    (PermissionRegistry 给 /api/params 登记的是「policy 或 monthly 任一」),
            //    所以文案是通用的那句,不是 ParamService 里细分门的文案。细分门见第 ⑤ 步。
            assertCode(put("/api/params").header("Authorization", hdr(ct))
                .contentType("application/json").content(POLICY_BODY), 403);

            // ③ 主管走过来,在专员的屏幕上输自己的账号密码
            String granted = body(mvc.perform(post("/api/auth/elevate").header("Authorization", hdr(ct))
                .contentType("application/json")
                .content("{\"perms\":[\"param-policy:edit\"],\"authorizer\":\"" + boss + "\",\"password\":\"" + PASS + "\"}")
            ).andExpect(status().isOk()).andReturn());
            assertThat((int) JsonPath.read(granted, "$.code")).isEqualTo(0);
            List<String> perms = JsonPath.read(granted, "$.data[*].perm");
            assertThat(perms).containsExactly("param-policy:edit");

            // ④ 同一个令牌,不重登 —— 现在改得动了
            assertCode(put("/api/params").header("Authorization", hdr(ct))
                .contentType("application/json").content(POLICY_BODY), 0);

            // ⑤ ⚠⚠ **这一步是全套里最要紧的一条断言。**
            //
            //    授权只发了 param-policy 一项,而 URL 层收「policy 或 monthly 任一」——
            //    所以此刻 MONTHLY_BODY **过得了 URL 那道门**,能不能挡住全看
            //    ParamService 里按 cfg_key 的细分判定(PermissionGuard)。
            //
            //    那道细分判定曾经**只写在注释里没有实现**(2026-08-22 发现):当时任何
            //    拿到其中一档的人都能改另一档的所有键。这条挂掉 = 那个洞回来了,
            //    也意味着「授权改 A」实际给了「什么都能改」。
            //
            //    断言文案是为了钉住「挡它的是细分门而不是 URL 门」—— 只断言 403 的话,
            //    哪天有人把 /api/params 的登记改严,这条会依旧绿,而细分门早已失效。
            String stillDenied = body(mvc.perform(put("/api/params").header("Authorization", hdr(ct))
                .contentType("application/json").content(MONTHLY_BODY)).andReturn());
            assertThat((int) JsonPath.read(stillDenied, "$.code")).isEqualTo(403);
            assertThat((String) JsonPath.read(stillDenied, "$.message"))
                .as("必须是 ParamService 细分门的文案,不是通用 403")
                .contains("月度计费录入");

            // ⑥ 审计记了两个人。这条挂掉就等于整个功能白做
            String log = body(mvc.perform(get("/api/system/logs").param("actor", clerk).param("size", "50")
                .header("Authorization", hdr(a))).andExpect(status().isOk()).andReturn());
            List<String> authorizers = JsonPath.read(log,
                "$.data.rows[?(@.target =~ /.*park_share_div.*/)].authorizer");
            assertThat(authorizers).as("提权改口径必须查得出授权人").contains(boss);

            // ⑦ 结束授权 → 立刻回到 403(不必等 30 分钟)
            mvc.perform(delete("/api/auth/elevate").header("Authorization", hdr(ct))).andExpect(status().isOk());
            assertCode(put("/api/params").header("Authorization", hdr(ct))
                .contentType("application/json").content(POLICY_BODY), 403);
        } finally {
            cleanup(clerk); cleanup(boss); cleanupParams();
        }
    }

    // ══════════ 不可提权名单:提权系统不能成为权限系统的后门 ══════════

    @Test
    void systemPermsCanNeverBeElevated() throws Exception {
        String a = admin();
        String clerk = mkUser(a, "it-elev-sys", "finance_clerk");
        try {
            String ct = login(clerk, PASS);
            // admin 本人是有 system:edit 的 —— 所以拒绝理由只能是「这一项不可提权」,
            // 不是「授权人没有」。这条防的是有人图省事把 system:* 从名单里拿掉。
            String r = body(mvc.perform(post("/api/auth/elevate").header("Authorization", hdr(ct))
                .contentType("application/json")
                .content("{\"perms\":[\"system:edit\"],\"authorizer\":\"admin\",\"password\":\"admin123\"}")
            ).andReturn());
            assertThat((int) JsonPath.read(r, "$.code")).isEqualTo(403);
            assertThat((String) JsonPath.read(r, "$.message")).contains("不能靠当场授权获得");

            // 而且真的没拿到:system 段仍然进不去
            mvc.perform(get("/api/system/users").header("Authorization", hdr(ct)))
               .andExpect(status().isForbidden());
        } finally { cleanup(clerk); }
    }

    @Test
    void viewerCannotEvenAskForElevation() throws Exception {
        // 只读账号与园区股东没有 elevate:request —— 连提权窗口都不该有。
        // 挡在 PermissionRegistry(URL 层),所以是 HTTP 403 而不是信封里的 403。
        String v = login("viewer", "viewer123");
        mvc.perform(post("/api/auth/elevate").header("Authorization", hdr(v))
            .contentType("application/json")
            .content("{\"perms\":[\"master:edit\"],\"authorizer\":\"admin\",\"password\":\"admin123\"}"))
           .andExpect(status().isForbidden());
    }

    // ══════════ 授权人这一侧 ══════════

    @Test
    void authorizerMustActuallyHoldThePermission() throws Exception {
        String a = admin();
        String clerk = mkUser(a, "it-elev-c2", "finance_clerk");
        String peer  = mkUser(a, "it-elev-peer", "finance_clerk");   // 同级,也没有 param-policy
        try {
            String ct = login(clerk, PASS);
            String r = body(mvc.perform(post("/api/auth/elevate").header("Authorization", hdr(ct))
                .contentType("application/json")
                .content("{\"perms\":[\"param-policy:edit\"],\"authorizer\":\"" + peer + "\",\"password\":\"" + PASS + "\"}")
            ).andReturn());
            assertThat((int) JsonPath.read(r, "$.code")).isEqualTo(403);
            assertThat((String) JsonPath.read(r, "$.message")).contains("本人也没有");
            // 没拿到就是没拿到
            assertCode(put("/api/params").header("Authorization", hdr(ct))
                .contentType("application/json").content(POLICY_BODY), 403);
        } finally { cleanup(clerk); cleanup(peer); cleanupParams(); }
    }

    @Test
    void wrongPasswordIsRejectedAndAudited() throws Exception {
        String a = admin();
        String clerk = mkUser(a, "it-elev-c3", "finance_clerk");
        String boss  = mkUser(a, "it-elev-b3", "finance_manager");
        try {
            String ct = login(clerk, PASS);
            String r = body(mvc.perform(post("/api/auth/elevate").header("Authorization", hdr(ct))
                .contentType("application/json")
                .content("{\"perms\":[\"param-policy:edit\"],\"authorizer\":\"" + boss + "\",\"password\":\"nope-nope\"}")
            ).andReturn());
            assertThat((int) JsonPath.read(r, "$.code")).isEqualTo(401);

            // 「有人在反复试主管的密码」必须查得出来 —— 这是这条端点存在的最大风险
            String log = body(mvc.perform(get("/api/system/logs").param("actor", clerk).param("size", "50")
                .header("Authorization", hdr(a))).andReturn());
            List<String> actions = JsonPath.read(log, "$.data.rows[*].action");
            assertThat(actions).contains("elevate.deny");
        } finally { cleanup(clerk); cleanup(boss); }
    }

    @Test
    void cannotAuthorizeYourself() throws Exception {
        String a = admin();
        String boss = mkUser(a, "it-elev-self", "finance_manager");
        try {
            String bt = login(boss, PASS);
            // 他有 param-policy,走不到这个弹窗;但从 API 直接调是可达的。
            // 放行的话审计里会出现「张三授权张三」—— 看似有责任人,实则没有。
            String r = body(mvc.perform(post("/api/auth/elevate").header("Authorization", hdr(bt))
                .contentType("application/json")
                .content("{\"perms\":[\"param-policy:edit\"],\"authorizer\":\"" + boss + "\",\"password\":\"" + PASS + "\"}")
            ).andReturn());
            assertThat((int) JsonPath.read(r, "$.code")).isEqualTo(409);
            assertThat((String) JsonPath.read(r, "$.message")).contains("不能给自己授权");
        } finally { cleanup(boss); }
    }

    // ══════════ 授权不得比账号活得长 ══════════

    @Test
    void disablingTheUserKillsHisGrants() throws Exception {
        String a = admin();
        String clerk = mkUser(a, "it-elev-c4", "finance_clerk");
        String boss  = mkUser(a, "it-elev-b4", "finance_manager");
        try {
            String ct = login(clerk, PASS);
            mvc.perform(post("/api/auth/elevate").header("Authorization", hdr(ct))
                .contentType("application/json")
                .content("{\"perms\":[\"param-policy:edit\"],\"authorizer\":\"" + boss + "\",\"password\":\"" + PASS + "\"}"))
               .andExpect(status().isOk());
            assertCode(put("/api/params").header("Authorization", hdr(ct))
                .contentType("application/json").content(POLICY_BODY), 0);

            // 停用 → cache.reload() → 授权一并清空。
            // 不清的话「停用立刻踢」就有个 30 分钟的洞。
            cleanup(clerk);
            mvc.perform(put("/api/params").header("Authorization", hdr(ct))
                .contentType("application/json").content(POLICY_BODY))
               .andExpect(status().isUnauthorized());
        } finally { cleanup(clerk); cleanup(boss); cleanupParams(); }
    }

    // ══════════ helpers ══════════

    private String login(String user, String pass) throws Exception {
        String b = body(mvc.perform(post("/api/auth/login").contentType("application/json")
            .content("{\"username\":\"" + user + "\",\"password\":\"" + pass + "\"}")).andReturn());
        return JsonPath.read(b, "$.data.token");
    }

    private String admin() throws Exception { return login("admin", "admin123"); }
    private String hdr(String t) { return "Bearer " + t; }

    private String body(MvcResult r) throws Exception {
        return new String(r.getResponse().getContentAsByteArray(), StandardCharsets.UTF_8);
    }

    private void assertCode(org.springframework.test.web.servlet.RequestBuilder rb, int expected) throws Exception {
        String b = body(mvc.perform(rb).andReturn());
        assertThat((int) JsonPath.read(b, "$.code")).as("响应体:%s", b).isEqualTo(expected);
    }

    /** 建号并返回用户名。名字带 nanoTime —— 用例之间不能互相看见对方的账号。 */
    private String mkUser(String adminToken, String prefix, String roleCode) throws Exception {
        String uname = prefix + "-" + System.nanoTime();
        int roleId = roleIdOf(adminToken, roleCode);
        mvc.perform(post("/api/system/users").header("Authorization", hdr(adminToken))
            .contentType("application/json")
            .content("{\"username\":\"" + uname + "\",\"displayName\":\"提权测试\","
                   + "\"password\":\"" + PASS + "\",\"roleIds\":[" + roleId + "]}"))
           .andExpect(status().isOk());
        return uname;
    }

    private int roleIdOf(String token, String code) throws Exception {
        String b = body(mvc.perform(get("/api/system/roles").header("Authorization", hdr(token))).andReturn());
        List<Integer> ids = JsonPath.read(b, "$.data[?(@.code=='" + code + "')].id");
        assertThat(ids).as("预置角色 %s 应存在", code).hasSize(1);
        return ids.get(0);
    }

    /**
     * ⚠ 清掉本类写下的参数行与变更日志。
     *
     * 容器是**全 JVM 共享**的(AbstractMysqlIT 单例启动,类之间不重置),而本类不能用
     * @Transactional —— 建号后要立刻用新账号登录,权限缓存 reload 走的是另一条路径。
     * 不清的话这两行会被后面每一个断言 pendingChanges 的用例算进去:
     * 初版就因此让 ParamApiIT 期望 6 实得 8、PriceCfgApiIT 期望 3 实得 5。
     * 日志行也要删 —— pendingChanges 数的正是它。
     */
    private void cleanupParams() {
        jdbc.update("DELETE FROM tenant_price_cfg WHERE cfg_key = 'elec_flat' AND scope = 'p1' AND acct_month = '2025-01'");
        jdbc.update("DELETE FROM alloc_cfg WHERE cfg_key = 'park_share_div' AND scope = 'p1' AND acct_month = '2025-01'");
        jdbc.update("DELETE FROM param_change_log WHERE cfg_key IN ('elec_flat', 'park_share_div') AND scope = 'p1'");
    }

    private void cleanup(String username) throws Exception {
        String t = admin();
        String b = body(mvc.perform(get("/api/system/users").param("q", username)
            .header("Authorization", hdr(t))).andReturn());
        List<Integer> ids = JsonPath.read(b, "$.data[*].id");
        for (Integer id : ids) {
            mvc.perform(post("/api/system/users/" + id + "/status").header("Authorization", hdr(t))
                .contentType("application/json").content("{\"status\":0}"));
        }
    }
}
