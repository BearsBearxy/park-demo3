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
           .andExpect(jsonPath("$.message").value("无查看权限：需要「用户管理 · 查看」或「角色权限 · 查看」其中一项，请联系系统管理员在角色里勾上"));
        mvc.perform(get("/api/system/roles").header("Authorization", hdr(v)))
           .andExpect(status().isForbidden());
        // 写被拒写明缺的是「管理」那一项;不说「仅对系统管理员开放」—— 这一段按权限点放行,不按角色
        mvc.perform(post("/api/system/users").header("Authorization", hdr(v)).contentType("application/json").content("{}"))
           .andExpect(status().isForbidden())
           .andExpect(jsonPath("$.message").value("无修改权限：需要「用户管理 · 编辑」，请联系系统管理员在角色里勾上"));
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
        assertThat(keys).as("字典必须覆盖 Perm.ALL 全部 107 项").containsExactlyElementsOf(Perm.ALL);
        // v4:每项带所属屏(跨屏三项为 null),前端按 fpNav 挂树
        List<String> screens = JsonPath.read(body, "$.data.perms[*].screen");
        assertThat(screens).containsExactlyElementsOf(Perm.META.stream().map(Perm.Meta::screen).toList());
        List<String> kinds = JsonPath.read(body, "$.data.perms[*].kind");
        assertThat(kinds).containsOnly("view", "edit", "action", "other");
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
        // 把 admin 角色的权限改成"楼栋编辑 + 用户管理编辑" → 等于摘掉自己的「角色权限 · 编辑」，保存后改不了角色
        String body = utf8(mvc.perform(put("/api/system/roles/" + adminRoleId)
                .header("Authorization", hdr(t)).contentType("application/json")
                .content("{\"name\":\"系统管理员\",\"navLayers\":[\"data\"],\"perms\":[\"buildings:edit\",\"sys-users:edit\"]}")
        ).andExpect(status().isOk()).andReturn());
        assertThat((int) JsonPath.read(body, "$.code")).isEqualTo(409);
        assertThat((String) JsonPath.read(body, "$.message")).contains("「角色权限 · 编辑」").contains("不能再改角色");
        // 守的是角色权限编辑这一项(有它就能把别的都改回来):留着它、摘掉别的照样放行(本用例事务回滚)
        // 破坏验证:guardSelfKeepsRolesEdit 改守用户管理编辑 → 这条 409
        String keep = utf8(mvc.perform(put("/api/system/roles/" + adminRoleId)
                .header("Authorization", hdr(t)).contentType("application/json")
                .content("{\"name\":\"系统管理员\",\"navLayers\":[\"data\"],\"perms\":[\"sys-roles:edit\"]}")
        ).andExpect(status().isOk()).andReturn());
        assertThat((int) JsonPath.read(keep, "$.code")).as(keep).isZero();
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
                       + "\"perms\":[\"income-statement:edit\",\"ledger:edit\"]}")
        ).andExpect(status().isOk()).andReturn());
        assertThat((int) JsonPath.read(upd, "$.code")).isEqualTo(0);
        List<String> perms = JsonPath.read(upd, "$.data.perms");
        assertThat(perms).as("按 Perm.ALL 的顺序回").containsExactly("ledger:edit", "income-statement:edit");
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
                       + "\"perms\":[\"ledger:edit\",\"god-mode:edit\",\"entry:edit\"]}")
        ).andExpect(status().isOk()).andReturn());
        List<String> perms = JsonPath.read(body, "$.data.perms");
        assertThat(perms).as("不认识的键与 v3 旧键都静默丢掉").containsExactly("ledger:edit");
        assertThat(jdbc.queryForList("SELECT perm FROM auth_role_perm WHERE role_id=?", String.class, clerkRole))
            .as("整组替换:这个角色的旧键行随之删掉").containsExactly("ledger:edit");
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
            // 带着初始密码时业务接口一律 428(RBAC-SPEC §13.4);当他已改过 —— 放在上面那条之后,它 reload 不掩盖建号漏 reload
            passwordAlreadyChanged(uname);

            // 而且真能用:按财务专员的权限判
            mvc.perform(post("/api/tenants").header("Authorization", hdr(nt))
                    .contentType("application/json").content("{}"))
               .andExpect(status().isForbidden());          // 没有租户管理编辑 → 403
            mvc.perform(get("/api/tenants").header("Authorization", hdr(nt)))
               .andExpect(status().isOk());                 // V140 给专员的租户管理查看
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
            // 没挂角色 = 零权限,v3 起业务 GET 一律 403(读也默认拒绝);用任何已登录都能读的 /auth/me 当靶子
            mvc.perform(get("/api/auth/me").header("Authorization", hdr(victim)))
               .andExpect(status().isOk());

            mvc.perform(post("/api/system/users/" + id + "/status").header("Authorization", hdr(t))
                    .contentType("application/json").content("{\"status\":0}"))
               .andExpect(status().isOk());

            // 同一个令牌，仍在有效期内 → 401
            mvc.perform(get("/api/auth/me").header("Authorization", hdr(victim)))
               .andExpect(status().isUnauthorized());
        } finally {
            cleanup(uname);
        }
    }

    // ══════════ 铃铛:角色被改 / 账号停用(V133,画布 06-E) ══════════

    @Test
    @Transactional
    void roleChangeNotifiesHoldersNotTheActor() throws Exception {
        String t = admin();
        String code = "it_bell_" + (System.nanoTime() % 1_000_000_000L);
        String role = utf8(mvc.perform(post("/api/system/roles").header("Authorization", hdr(t))
                .contentType("application/json")
                .content("{\"code\":\"" + code + "\",\"name\":\"铃铛测试\",\"navLayers\":[\"data\"],\"perms\":[]}")).andReturn());
        int rid = JsonPath.read(role, "$.data.id");
        // admin 自己也挂上 R:这样「发给操作人自己的跳过」才真被走到(他不持 R 的话本来就不在名单里)
        jdbc.update("INSERT INTO auth_user_role (user_id, role_id) SELECT id, ? FROM auth_user WHERE username = 'admin'", rid);
        String uname = "it-bell-" + System.nanoTime();
        int uid = JsonPath.read(utf8(mvc.perform(post("/api/system/users").header("Authorization", hdr(t))
                .contentType("application/json")
                .content("{\"username\":\"" + uname + "\",\"displayName\":\"铃铛测试人\","
                       + "\"password\":\"init-pass-123\",\"roleIds\":[" + rid + "]}")).andReturn()), "$.data.id");
        passwordAlreadyChanged(uname);
        String u = login(uname, "init-pass-123");
        int adminBefore = noticeCount("admin");

        // admin 给角色加一项权限 → 持该角色的 U 收到 1 条,admin 自己没有
        String roleBody = "{\"name\":\"铃铛测试\",\"navLayers\":[\"data\"],\"perms\":[\"ledger:edit\"]}";
        mvc.perform(put("/api/system/roles/" + rid).header("Authorization", hdr(t))
                .contentType("application/json").content(roleBody)).andExpect(status().isOk());
        List<String> kinds = JsonPath.read(utf8(mvc.perform(get("/api/notices").header("Authorization", hdr(u))).andReturn()),
                "$.data[*].kind");
        assertThat(kinds).containsExactly("perms_changed");
        assertThat(noticeCount("admin")).as("发给操作人自己的跳过").isEqualTo(adminBefore);

        // U 手上是改之前登录的令牌,/auth/me 要给出改后的权限 —— 「刷新后生效」靠它说实话
        List<String> perms = JsonPath.read(utf8(mvc.perform(get("/api/auth/me").header("Authorization", hdr(u)))
                .andExpect(status().isOk()).andReturn()), "$.data.permissions");
        assertThat(perms).contains("ledger:edit", "ledger:view");

        // 原样再存一次:什么都没改,不许写「你的权限被改了」
        mvc.perform(put("/api/system/roles/" + rid).header("Authorization", hdr(t))
                .contentType("application/json").content(roleBody)).andExpect(status().isOk());
        assertThat(noticeCount(uname)).as("没改的保存不发通知").isEqualTo(1);

        // 只改导航层:持有人看到的侧栏会变 → 也算改了;只改角色名 → 也算(标题里写的就是它)
        mvc.perform(put("/api/system/roles/" + rid).header("Authorization", hdr(t)).contentType("application/json")
                .content("{\"name\":\"铃铛测试\",\"navLayers\":[\"data\",\"analysis\"],\"perms\":[\"ledger:edit\"]}"))
            .andExpect(status().isOk());
        assertThat(noticeCount(uname)).as("只改导航层也发").isEqualTo(2);
        mvc.perform(put("/api/system/roles/" + rid).header("Authorization", hdr(t)).contentType("application/json")
                .content("{\"name\":\"铃铛测试改名\",\"navLayers\":[\"data\",\"analysis\"],\"perms\":[\"ledger:edit\"]}"))
            .andExpect(status().isOk());
        assertThat(noticeCount(uname)).as("只改角色名也发").isEqualTo(3);

        // 改 U 本人的角色 → 再 1 条;只改显示名、角色不变 → 不发
        mvc.perform(put("/api/system/users/" + uid).header("Authorization", hdr(t)).contentType("application/json")
                .content("{\"displayName\":\"铃铛测试人\",\"roleIds\":[]}")).andExpect(status().isOk());
        assertThat(noticeCount(uname)).isEqualTo(4);
        mvc.perform(put("/api/system/users/" + uid).header("Authorization", hdr(t)).contentType("application/json")
                .content("{\"displayName\":\"改个名\",\"roleIds\":[]}")).andExpect(status().isOk());
        assertThat(noticeCount(uname)).as("角色没变不发").isEqualTo(4);
    }

    @Test
    @Transactional
    void disabledAccountIsToldWhyButOnlyWithTheRightPassword() throws Exception {
        String t = admin();
        String uname = "it-off-" + System.nanoTime();
        int id = JsonPath.read(utf8(mvc.perform(post("/api/system/users").header("Authorization", hdr(t))
                .contentType("application/json")
                .content("{\"username\":\"" + uname + "\",\"displayName\":\"待停用\","
                       + "\"password\":\"init-pass-123\",\"roleIds\":[]}")).andReturn()), "$.data.id");
        String victim = login(uname, "init-pass-123");
        mvc.perform(post("/api/system/users/" + id + "/status").header("Authorization", hdr(t))
                .contentType("application/json").content("{\"status\":0}")).andExpect(status().isOk());

        // 旧令牌下一个请求 401,并说清楚是停用 —— 不然被踢回登录页的人不知道为什么
        mvc.perform(get("/api/tenants").header("Authorization", hdr(victim)))
           .andExpect(status().isUnauthorized())
           .andExpect(header().string("X-Auth-Reason", "disabled"));

        // 登录口:密码对了才说停用;密码错照旧一句,分不出停用还是不存在
        String ok = utf8(mvc.perform(post("/api/auth/login").contentType("application/json")
                .content("{\"username\":\"" + uname + "\",\"password\":\"init-pass-123\"}")).andReturn());
        assertThat((int) JsonPath.read(ok, "$.code")).isEqualTo(403);
        assertThat((String) JsonPath.read(ok, "$.message")).isEqualTo("账号已停用，请联系管理员");
        String bad = utf8(mvc.perform(post("/api/auth/login").contentType("application/json")
                .content("{\"username\":\"" + uname + "\",\"password\":\"wrong-pass-9\"}")).andReturn());
        assertThat((int) JsonPath.read(bad, "$.code")).isEqualTo(401);
        assertThat((String) JsonPath.read(bad, "$.message")).isEqualTo("用户名或密码错误");
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

            // 当前密码错 → 401(与提权口令错同一道门 ElevationService.verifyOwnPassword)
            String wrong = utf8(mvc.perform(post("/api/auth/change-password").header("Authorization", hdr(tok))
                    .contentType("application/json")
                    .content("{\"currentPassword\":\"nope-nope-1\",\"newPassword\":\"brand-new-123\"}")
            ).andExpect(status().isOk()).andReturn());
            assertThat((int) JsonPath.read(wrong, "$.code")).isEqualTo(401);
            assertThat((String) JsonPath.read(wrong, "$.message")).isEqualTo("当前密码不正确");

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

    /**
     * 改密校验旧口令要限流、要留痕(安全审计 F03)。原来直接 enc.matches:一张令牌就能不限次猜口令,
     * 「新密码不能与当前相同」那句还会告诉他猜中了,库里一行痕迹都没有。
     * 破坏验证:① SystemService 改回 enc.matches → 第 6 次拿到的不是 429,红;
     *          ② 去掉 changeOwnPassword 上的 noRollbackFor → .deny 审计随回滚消失,条数断言红。
     */
    @Test
    void changeOwnPassword_wrongCurrent_isRateLimitedAndAudited() throws Exception {
        String t = admin();
        String uname = "it-pwdlock-" + System.nanoTime();
        mvc.perform(post("/api/system/users").header("Authorization", hdr(t)).contentType("application/json")
                .content("{\"username\":\"" + uname + "\",\"displayName\":\"改密限流\","
                       + "\"password\":\"init-pass-123\",\"roleIds\":[]}")).andReturn();
        try {
            String tok = login(uname, "init-pass-123");
            // 猜中的那一下用的就是「新旧相同」:锁之前它回「新密码不能与当前相同」,锁之后一律 429
            for (int i = 1; i <= 5; i++) {
                String r = utf8(mvc.perform(post("/api/auth/change-password").header("Authorization", hdr(tok))
                        .contentType("application/json")
                        .content("{\"currentPassword\":\"guess-" + i + "-xx\",\"newPassword\":\"guess-" + i + "-xx\"}"))
                        .andReturn());
                assertThat((int) JsonPath.read(r, "$.code")).as("第 %d 次猜错", i).isEqualTo(401);
            }
            String locked = utf8(mvc.perform(post("/api/auth/change-password").header("Authorization", hdr(tok))
                    .contentType("application/json")
                    .content("{\"currentPassword\":\"init-pass-123\",\"newPassword\":\"init-pass-123\"}"))
                    .andReturn());
            assertThat((int) JsonPath.read(locked, "$.code")).as("锁住后连猜中的也不回答").isEqualTo(429);
            assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM auth_audit_log WHERE actor = ? AND action = ?",
                Integer.class, uname, "user.change-password.deny")).isEqualTo(5);
        } finally {
            cleanup(uname);
        }
    }

    // ══════════ helpers ══════════

    @Autowired org.springframework.jdbc.core.JdbcTemplate jdbc;
    @Autowired com.park.demo3.security.UserPermissionCache cache;

    /**
     * @Transactional 用例回滚的是库,不是内存快照:不重载的话,回滚掉的角色挂载(admin 挂 R)
     * 会留在快照里,影响同一 JVM 里后面读 admin 角色名的用例。
     */
    @org.springframework.test.context.transaction.AfterTransaction
    void reloadCacheAfterRollback() { cache.reload(); }

    private int noticeCount(String username) {
        return jdbc.queryForObject("SELECT COUNT(*) FROM user_notice WHERE username = ? AND kind = 'perms_changed'",
            Integer.class, username);
    }

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
