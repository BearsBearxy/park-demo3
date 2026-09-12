package com.park.demo3.api;

import com.jayway.jsonpath.JsonPath;
import com.park.demo3.AbstractMysqlIT;
import com.park.demo3.security.Perm;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.test.context.transaction.TestTransaction;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * 系统管理（RBAC-SPEC P1）。
 *
 * 重点在**自锁防护**与**缓存刷新**两件事上 —— 它们出错不会报错，只会让人某天进不来，
 * 而这个系统没有第二条进门的路（只能去数据库里手改）。
 */
@AutoConfigureMockMvc
class SystemApiIT extends AbstractMysqlIT {
    @Autowired MockMvc mvc;

    private String login(String user, String pass) throws Exception {
        String body = mvc.perform(post("/api/auth/login").contentType("application/json")
                .content("{\"username\":\"" + user + "\",\"password\":\"" + pass + "\"}"))
                .andReturn().getResponse().getContentAsString();
        return JsonPath.read(body, "$.data.token");
    }

    private String admin() throws Exception { return login("admin", "admin123"); }
    private String hdr(String t) { return "Bearer " + t; }

    private String utf8(org.springframework.test.web.servlet.MvcResult r) throws Exception {
        return new String(r.getResponse().getContentAsByteArray(), java.nio.charset.StandardCharsets.UTF_8);
    }

    // ══════════ 读权限：全站唯一"读也管"的一段 ══════════

    @Test
    void systemReadRequiresSystemView() throws Exception {
        // viewer 零权限 → 连列表都看不到（其余业务 GET 他都是 200，这一段是例外）
        String v = login("viewer", "viewer123");
        // 文案必须与通用 403 分开:通用那句是「不能改,但可查看」,对这一段是反的 ——
        // 被拦的人恰恰是不该看到账号与角色配置的
        mvc.perform(get("/api/system/users").header("Authorization", hdr(v)))
           .andExpect(status().isForbidden())
           .andExpect(jsonPath("$.message").value("无访问权限：账号与角色管理仅对系统管理员开放"));
        mvc.perform(get("/api/system/roles").header("Authorization", hdr(v)))
           .andExpect(status().isForbidden());
        // 对照：业务数据他读得到，证明挡住的是 system 段而不是他整个账号
        mvc.perform(get("/api/tenants").header("Authorization", hdr(v)))
           .andExpect(status().isOk());
    }

    @Test
    void permCatalogCoversEveryPermissionPoint() throws Exception {
        // 角色矩阵屏按这个字典渲染。少一条 = 那个权限点在界面上永远勾不上，且没人会发现。
        String body = utf8(mvc.perform(get("/api/system/perms").header("Authorization", hdr(admin())))
                .andExpect(status().isOk()).andReturn());
        List<String> keys = JsonPath.read(body, "$.data.perms[*].key");
        assertThat(keys).as("字典必须覆盖 Perm.ALL 全部 14 项").containsExactlyElementsOf(Perm.ALL);
        List<String> labels = JsonPath.read(body, "$.data.perms[*].label");
        assertThat(labels).allSatisfy(l -> assertThat(l).isNotBlank());
        List<String> layers = JsonPath.read(body, "$.data.navLayers[*].id");
        assertThat(layers).containsExactly("data", "reports", "analysis");
    }

    // ══════════ 自锁防护 ══════════

    @Test
    @Transactional
    void cannotDisableSelf() throws Exception {
        String t = admin();
        int meId = adminId(t);
        // 停用自己 = 当场把自己踢出去，且再也进不来
        String body = utf8(mvc.perform(post("/api/system/users/" + meId + "/status")
                .header("Authorization", hdr(t)).contentType("application/json").content("{\"status\":0}")
        ).andExpect(status().isOk()).andReturn());   // BizException → HTTP200 + 信封
        assertThat((int) JsonPath.read(body, "$.code")).isEqualTo(409);
        assertThat((String) JsonPath.read(body, "$.message")).contains("不能停用自己");
    }

    @Test
    @Transactional
    void cannotEditOwnRoles() throws Exception {
        // 只拦**角色**：清空自己的角色 = 当场把自己关在门外
        String t = admin();
        int meId = adminId(t);
        String body = utf8(mvc.perform(put("/api/system/users/" + meId)
                .header("Authorization", hdr(t)).contentType("application/json")
                .content("{\"displayName\":\"周明\",\"roleIds\":[]}")
        ).andExpect(status().isOk()).andReturn());
        assertThat((int) JsonPath.read(body, "$.code")).isEqualTo(409);
        assertThat((String) JsonPath.read(body, "$.message")).contains("不能修改自己的角色");
    }

    @Test
    @Transactional
    void canRenameSelf() throws Exception {
        // 改自己的显示名是无害的，不该被自锁守卫一起拦掉（初版一刀切拦了整个 updateUser，
        // 结果管理员连自己的名字都改不了 —— 2026-08-22 用户反馈）。
        String t = admin();
        int meId = adminId(t);
        List<Integer> myRoles = JsonPath.read(utf8(mvc.perform(get("/api/system/users").param("q", "admin")
                .header("Authorization", hdr(t))).andReturn()), "$.data[?(@.username=='admin')].roles[*].id");

        String body = utf8(mvc.perform(put("/api/system/users/" + meId)
                .header("Authorization", hdr(t)).contentType("application/json")
                .content("{\"displayName\":\"我\",\"roleIds\":" + myRoles + "}")
        ).andExpect(status().isOk()).andReturn());
        assertThat((int) JsonPath.read(body, "$.code")).as("角色没变、只改名 → 放行").isEqualTo(0);
        assertThat((String) JsonPath.read(body, "$.data.displayName")).isEqualTo("我");

        // 名字改了，角色一个没少 —— 别把「不动角色」实现成「清空角色」
        List<Integer> after = JsonPath.read(body, "$.data.roles[*].id");
        assertThat(after).containsExactlyInAnyOrderElementsOf(myRoles);
    }

    @Test
    @Transactional
    void cannotStripOwnSystemEdit() throws Exception {
        String t = admin();
        int adminRoleId = roleIdOf(t, "admin");
        // 把 admin 角色的权限改成"只剩一项主数据" → 等于摘掉自己的 system:edit，保存后进不了这个页面
        String body = utf8(mvc.perform(put("/api/system/roles/" + adminRoleId)
                .header("Authorization", hdr(t)).contentType("application/json")
                .content("{\"name\":\"系统管理员\",\"navLayers\":[\"data\"],\"perms\":[\"master:edit\"]}")
        ).andExpect(status().isOk()).andReturn());
        assertThat((int) JsonPath.read(body, "$.code")).isEqualTo(409);
        assertThat((String) JsonPath.read(body, "$.message")).contains("再也进不了这个页面");
    }

    @Test
    @Transactional
    void builtinRoleCannotBeDeletedButItsPermsCanChange() throws Exception {
        String t = admin();
        int clerkRole = roleIdOf(t, "finance_clerk");

        String del = utf8(mvc.perform(delete("/api/system/roles/" + clerkRole).header("Authorization", hdr(t)))
                .andExpect(status().isOk()).andReturn());
        assertThat((int) JsonPath.read(del, "$.code")).isEqualTo(409);
        assertThat((String) JsonPath.read(del, "$.message")).contains("预置角色不可删除");

        // 但权限可改 —— 这是「交付后客户自己调」的核心，不能因为是预置就锁死
        String upd = utf8(mvc.perform(put("/api/system/roles/" + clerkRole)
                .header("Authorization", hdr(t)).contentType("application/json")
                .content("{\"name\":\"财务专员\",\"navLayers\":[\"data\",\"analysis\"],"
                       + "\"perms\":[\"entry:edit\",\"report:edit\"]}")
        ).andExpect(status().isOk()).andReturn());
        assertThat((int) JsonPath.read(upd, "$.code")).isEqualTo(0);
        List<String> perms = JsonPath.read(upd, "$.data.perms");
        assertThat(perms).containsExactlyInAnyOrder("entry:edit", "report:edit");
        List<String> layers = JsonPath.read(upd, "$.data.navLayers");
        assertThat(layers).containsExactly("data", "analysis");
    }

    @Test
    @Transactional
    void unknownPermIsDroppedNotStored() throws Exception {
        // 客户配不出系统里没有的权限 —— RBAC-SPEC 那条「权限点由开发定义」的分工线
        String t = admin();
        int clerkRole = roleIdOf(t, "finance_clerk");
        String body = utf8(mvc.perform(put("/api/system/roles/" + clerkRole)
                .header("Authorization", hdr(t)).contentType("application/json")
                .content("{\"name\":\"财务专员\",\"navLayers\":[\"data\"],"
                       + "\"perms\":[\"entry:edit\",\"god-mode:edit\"]}")
        ).andExpect(status().isOk()).andReturn());
        List<String> perms = JsonPath.read(body, "$.data.perms");
        assertThat(perms).containsExactly("entry:edit");
    }

    // ══════════ 新建账号 → 缓存刷新 → 立刻可用 ══════════

    @Test
    void newUserIsUsableImmediately() throws Exception {
        // ⚠ 这条防的是 P1 最容易犯的错：写完 DB 忘了 cache.reload()。
        //    那样新账号登得进，但每个请求都 401（缓存里没它），而且没有任何报错指向真正的原因。
        //    dev 上实测过这个现象，所以钉一条。
        String t = admin();
        int clerkRole = roleIdOf(t, "finance_clerk");
        String uname = "it-newuser-" + System.nanoTime();

        String created = utf8(mvc.perform(post("/api/system/users").header("Authorization", hdr(t))
                .contentType("application/json")
                .content("{\"username\":\"" + uname + "\",\"displayName\":\"集成测试账号\","
                       + "\"password\":\"init-pass-123\",\"roleIds\":[" + clerkRole + "]}")
        ).andExpect(status().isOk()).andReturn());
        assertThat((int) JsonPath.read(created, "$.code")).isEqualTo(0);
        assertThat((boolean) JsonPath.read(created, "$.data.mustChangePassword"))
            .as("管理员设的是初始密码，本人首次登录必须改").isTrue();

        try {
            // 立刻登录 —— 不重启、不等任何东西。
            // V125 单会话:同一账号登两次会把第一张令牌挤掉 —— 改前这里真登了两次
            // (一次取令牌、一次取权限清单),于是拿着已作废的第一张去请求,得到 401 而不是 403。
            // 一次登录把两样一起取回来。
            String me = utf8(mvc.perform(post("/api/auth/login").contentType("application/json")
                    .content("{\"username\":\"" + uname + "\",\"password\":\"init-pass-123\"}")
                    ).andReturn());
            String nt = JsonPath.read(me, "$.data.token");
            List<String> perms = JsonPath.read(me, "$.data.permissions");
            assertThat(perms).as("缓存已刷新，新账号拿到 finance_clerk 的权限").isNotEmpty();

            // 而且真能用：他有 entry:edit，写台账不该 403
            mvc.perform(post("/api/tenants").header("Authorization", hdr(nt))
                    .contentType("application/json").content("{}"))
               .andExpect(status().isForbidden());          // 没有 master:edit → 403
            mvc.perform(get("/api/tenants").header("Authorization", hdr(nt)))
               .andExpect(status().isOk());                 // 读全开
        } finally {
            cleanup(uname);
        }
    }

    @Test
    void disableTakesEffectOnNextRequest() throws Exception {
        // 停用不必等令牌过期（120 分钟）—— 这是「权限不烤进令牌」换来的能力
        String t = admin();
        String uname = "it-disable-" + System.nanoTime();
        String created = utf8(mvc.perform(post("/api/system/users").header("Authorization", hdr(t))
                .contentType("application/json")
                .content("{\"username\":\"" + uname + "\",\"displayName\":\"待停用\","
                       + "\"password\":\"init-pass-123\",\"roleIds\":[]}")
        ).andReturn());
        int id = JsonPath.read(created, "$.data.id");
        try {
            String victim = login(uname, "init-pass-123");
            mvc.perform(get("/api/tenants").header("Authorization", hdr(victim)))
               .andExpect(status().isOk());

            mvc.perform(post("/api/system/users/" + id + "/status").header("Authorization", hdr(t))
                    .contentType("application/json").content("{\"status\":0}"))
               .andExpect(status().isOk());

            // 同一个令牌，仍在有效期内 → 401
            mvc.perform(get("/api/tenants").header("Authorization", hdr(victim)))
               .andExpect(status().isUnauthorized());
        } finally {
            cleanup(uname);
        }
    }

    // ══════════ 本人改密 ══════════

    @Test
    void changeOwnPasswordClearsTheForcedFlag() throws Exception {
        String t = admin();
        String uname = "it-pwd-" + System.nanoTime();
        mvc.perform(post("/api/system/users").header("Authorization", hdr(t)).contentType("application/json")
                .content("{\"username\":\"" + uname + "\",\"displayName\":\"改密测试\","
                       + "\"password\":\"init-pass-123\",\"roleIds\":[]}")).andReturn();
        try {
            // 同 newUserIsUsableImmediately:一次登录取回令牌与标志,不能登两次(V125 单会话)
            String before = utf8(mvc.perform(post("/api/auth/login").contentType("application/json")
                    .content("{\"username\":\"" + uname + "\",\"password\":\"init-pass-123\"}")).andReturn());
            String tok = JsonPath.read(before, "$.data.token");
            assertThat((boolean) JsonPath.read(before, "$.data.mustChangePassword")).isTrue();

            // 当前密码错 → 400
            String wrong = utf8(mvc.perform(post("/api/auth/change-password").header("Authorization", hdr(tok))
                    .contentType("application/json")
                    .content("{\"currentPassword\":\"nope-nope-1\",\"newPassword\":\"brand-new-123\"}")
            ).andExpect(status().isOk()).andReturn());
            assertThat((int) JsonPath.read(wrong, "$.code")).isEqualTo(400);

            // 新旧相同 → 400
            String same = utf8(mvc.perform(post("/api/auth/change-password").header("Authorization", hdr(tok))
                    .contentType("application/json")
                    .content("{\"currentPassword\":\"init-pass-123\",\"newPassword\":\"init-pass-123\"}")
            ).andReturn());
            assertThat((int) JsonPath.read(same, "$.code")).isEqualTo(400);

            // 正常改 → 标志清掉，新密码可登录
            mvc.perform(post("/api/auth/change-password").header("Authorization", hdr(tok))
                    .contentType("application/json")
                    .content("{\"currentPassword\":\"init-pass-123\",\"newPassword\":\"brand-new-123\"}"))
               .andExpect(status().isOk());
            String after = utf8(mvc.perform(post("/api/auth/login").contentType("application/json")
                    .content("{\"username\":\"" + uname + "\",\"password\":\"brand-new-123\"}")).andReturn());
            assertThat((int) JsonPath.read(after, "$.code")).isEqualTo(0);
            assertThat((boolean) JsonPath.read(after, "$.data.mustChangePassword")).isFalse();
        } finally {
            cleanup(uname);
        }
    }

    // ══════════ helpers ══════════

    private int adminId(String token) throws Exception {
        String body = utf8(mvc.perform(get("/api/system/users").param("q", "admin")
                .header("Authorization", hdr(token))).andExpect(status().isOk()).andReturn());
        List<Integer> ids = JsonPath.read(body, "$.data[?(@.username=='admin')].id");
        assertThat(ids).hasSize(1);
        return ids.get(0);
    }

    private int roleIdOf(String token, String code) throws Exception {
        String body = utf8(mvc.perform(get("/api/system/roles").header("Authorization", hdr(token)))
                .andExpect(status().isOk()).andReturn());
        List<Integer> ids = JsonPath.read(body, "$.data[?(@.code=='" + code + "')].id");
        assertThat(ids).as("预置角色 %s 应存在", code).hasSize(1);
        return ids.get(0);
    }

    /** 不带 @Transactional 的用例要自己清：这些账号会被别的用例的列表断言看见。 */
    private void cleanup(String username) throws Exception {
        String t = admin();
        String body = utf8(mvc.perform(get("/api/system/users").param("q", username)
                .header("Authorization", hdr(t))).andReturn());
        List<Integer> ids = JsonPath.read(body, "$.data[*].id");
        for (Integer id : ids) {
            mvc.perform(post("/api/system/users/" + id + "/status").header("Authorization", hdr(t))
                    .contentType("application/json").content("{\"status\":0}"));
        }
    }
}
