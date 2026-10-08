package com.park.demo3.api;

import com.jayway.jsonpath.JsonPath;
import com.park.demo3.AbstractMysqlIT;
import com.park.demo3.security.UserPermissionCache;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.stream.Collectors;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;

/**
 * 角色屏「本角色成员」(RBAC-SPEC §15.9,用户 2026-10-09 拍板②):成员增减跟角色保存走同一个请求,
 * 与用户管理里改角色同一条路径(SystemService.changeRoles)—— 守卫、审计、铃铛、快照刷新一样不少。
 * 整类 @Transactional:建的角色、账号、改的成员全部回滚;快照 @AfterTransaction 重载。
 */
@AutoConfigureMockMvc
@Transactional
class RoleMembersIT extends AbstractMysqlIT {
    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;
    @Autowired UserPermissionCache cache;

    private static final String PASS = "init-pass-123";

    @org.springframework.test.context.transaction.AfterTransaction
    void reloadCacheAfterRollback() { cache.reload(); }

    /**
     * 加 / 移出走 PUT;被改的人下一个请求就按新权限判、收到一条铃铛;审计记在被改的账号上。
     * 破坏验证:updateRole 不调 joinRole / leaveRole → 第一条 200 红;changeRoles 不写审计 → 「加入角色」红;
     *          notifyRoleChanged 不去重(角色权限也变了的同一次保存里)→ 「一人一条」红;保存后不 reload → 移出后仍 200,红。
     */
    @Test
    void addAndRemoveMembers_takeEffectOnNextRequest_withBellAndAudit() throws Exception {
        String a = admin();
        int r = role(a, "it_mem", "[\"ledger:view\"]", "");
        String roleName = jdbc.queryForObject("SELECT name FROM auth_role WHERE id=?", String.class, r);
        String u1 = user(a, ""), u2 = user(a, "");
        int id1 = idOf(u1), id2 = idOf(u2);
        String t1 = login(u1);
        assertThat(status(t1, "/api/ledger/companies/1/years")).isEqualTo(403);

        // 加两个人,同时改权限(加编辑):两个人都是「角色或权限变了的人」,一人只发一条
        String saved = save(a, r, "[\"ledger:view\",\"ledger:edit\"]", "[" + id1 + "," + id2 + "]", "[]");
        assertThat((int) JsonPath.read(saved, "$.code")).as(saved).isZero();
        assertThat((int) JsonPath.read(saved, "$.data.userCount")).isEqualTo(2);
        assertThat(status(t1, "/api/ledger/companies/1/years")).as("同一张令牌,下一个请求就按新权限判").isEqualTo(200);
        assertThat(bells(u1)).as("一人一条").isEqualTo(1);
        assertThat(bells(u2)).isEqualTo(1);
        assertThat(audit(u1)).containsExactly("加入角色「" + roleName + "」");

        // 再加一遍已经在里面的人:什么都不做,不算错,不发铃铛
        assertThat((int) JsonPath.read(save(a, r, "[\"ledger:view\",\"ledger:edit\"]", "[" + id2 + "]", "[]"), "$.code")).isZero();
        assertThat(bells(u2)).isEqualTo(1);

        // 只移出(权限不动):被移出的人下一个请求就 403,一条铃铛;不写 role.update
        assertThat((int) JsonPath.read(save(a, r, "[\"ledger:view\",\"ledger:edit\"]", "[]", "[" + id1 + "]"), "$.code")).isZero();
        assertThat(status(t1, "/api/ledger/companies/1/years")).as("被移出的人下一个请求就 403").isEqualTo(403);
        assertThat(bells(u1)).isEqualTo(2);
        assertThat(audit(u1)).containsExactly("加入角色「" + roleName + "」", "移出角色「" + roleName + "」");

        // 改权限的同时把持有人 u2 移出:他既是「权限变了的持有人」又是「被移出的人」,同一次保存里只发一条
        assertThat((int) JsonPath.read(save(a, r, "[\"ledger:view\"]", "[]", "[" + id2 + "]"), "$.code")).isZero();
        assertThat(bells(u2)).as("一人一条").isEqualTo(2);
        assertThat(jdbc.queryForList("SELECT action FROM auth_audit_log WHERE target=? ORDER BY id", String.class,
            "role:" + jdbc.queryForObject("SELECT code FROM auth_role WHERE id=?", String.class, r)))
            .as("只改成员的两次不写 role.update").containsExactly("role.create", "role.update", "role.update");
    }

    /**
     * 增量不冲掉用户管理那边同时加的人;新建角色时就能带成员;同一个账号同时加入和移出 400;账号不存在 404。
     * 破坏验证:成员改成整份名单覆盖 → 「用户管理加的人还在」红;createRole 忽略 addUserIds → 新建那条红。
     */
    @Test
    void incrementsDoNotClobberConcurrentChanges_andCreateTakesMembers() throws Exception {
        String a = admin();
        String u1 = user(a, ""), u2 = user(a, ""), u3 = user(a, "");
        int id1 = idOf(u1), id2 = idOf(u2), id3 = idOf(u3);
        int r = role(a, "it_inc", "[\"ledger:view\"]", "[" + id1 + "]");
        assertThat(members(r)).as("新建时直接挑成员").containsExactly(id1);
        // 角色屏打开之后,别人在用户管理里把 u2 也加进来了
        assertThat((int) JsonPath.read(body(mvc.perform(put("/api/system/users/" + id2).header("Authorization", hdr(a))
            .contentType("application/json").content("{\"displayName\":\"成员\",\"roleIds\":[" + r + "]}")).andReturn()), "$.code"))
            .isZero();
        // 角色屏照它打开时的样子加 u3 —— 带的是增量
        assertThat((int) JsonPath.read(save(a, r, "[\"ledger:view\"]", "[" + id3 + "]", "[]"), "$.code")).isZero();
        assertThat(members(r)).containsExactlyInAnyOrder(id1, id2, id3);
        assertThat(audit(u2)).containsExactly("角色：加「" + jdbc.queryForObject("SELECT name FROM auth_role WHERE id=?", String.class, r) + "」");

        String both = save(a, r, "[\"ledger:view\"]", "[" + id1 + "]", "[" + id1 + "]");
        assertThat((int) JsonPath.read(both, "$.code")).isEqualTo(400);
        assertThat((String) JsonPath.read(both, "$.message")).isEqualTo("同一个账号不能同时加入和移出");
        String ghost = save(a, r, "[\"ledger:view\"]", "[999999999]", "[]");
        assertThat((int) JsonPath.read(ghost, "$.code")).isEqualTo(404);
        assertThat((String) JsonPath.read(ghost, "$.message")).isEqualTo("账号不存在");
    }

    /**
     * 守卫与用户管理同一套:改自己 409;非系统管理员动比自己大的账号 403、碰不了系统管理员角色;任一条拦下整次回滚。
     * 这一条不在测试事务里跑(整次回滚要真提交 / 真回滚才验得出来),建的东西 finally 里删。
     * 破坏验证:changeRoles 去掉 self 判断 → 第一条红;去掉 guardUserInRange → 「比自己大」那条红;
     *          updateRole 去掉 @Transactional → 「权限没改」那条红(权限先写、成员守卫后拦)。
     */
    @Test
    @Transactional(propagation = org.springframework.transaction.annotation.Propagation.NOT_SUPPORTED)
    void guards_self_tiering_andWholeSaveRollsBack() throws Exception {
        String a = admin();
        List<String> users = new java.util.ArrayList<>();
        List<Integer> roles = new java.util.ArrayList<>();
        try {
            int adminId = idOf("admin");
            int r = role(a, "it_self", "[\"ledger:view\"]", "");
            roles.add(r);
            String self = save(a, r, "[\"ledger:view\"]", "[" + adminId + "]", "[]");
            assertThat((int) JsonPath.read(self, "$.code")).isEqualTo(409);
            assertThat((String) JsonPath.read(self, "$.message")).isEqualTo("不能修改自己的角色，请另一位管理员操作");
            assertThat(members(r)).isEmpty();

            // 只管角色和账号、外加月度台账查看的人
            int small = role(a, "it_small", "[\"sys-roles:edit\",\"sys-users:edit\",\"ledger:view\"]", "");
            roles.add(small);
            String opName = user(a, String.valueOf(small));
            users.add(opName);
            String op = login(opName);
            String clerkName = user(a, String.valueOf(roleId("finance_clerk")));
            users.add(clerkName);
            int clerk = idOf(clerkName);
            int mine = role(a, "it_mine", "[\"ledger:view\"]", "");
            roles.add(mine);
            // 同一次保存:去掉台账查看(他管得了)+ 加一个比他大的账号(他管不了)
            String big = save(op, mine, "[]", "[" + clerk + "]", "[]");
            assertThat((int) JsonPath.read(big, "$.code")).isEqualTo(403);
            assertThat((String) JsonPath.read(big, "$.message")).contains("有你没有的权限").endsWith("只有系统管理员能改这个账号");
            assertThat(jdbc.queryForList("SELECT perm FROM auth_role_perm WHERE role_id=?", String.class, mine))
                .as("成员守卫拦下,同一次保存里先写的权限一起回滚").containsExactly("ledger:view");
            assertThat(members(mine)).isEmpty();

            String adminRole = save(op, roleId("admin"), "[]", "[]", "[" + adminId + "]");
            assertThat((int) JsonPath.read(adminRole, "$.code")).isEqualTo(403);
            assertThat((String) JsonPath.read(adminRole, "$.message")).isEqualTo("系统管理员角色只有系统管理员能改");
            assertThat(members(roleId("admin"))).contains(adminId);
        } finally {
            for (String u : users) {
                jdbc.update("DELETE FROM auth_session WHERE username=?", u);
                jdbc.update("DELETE FROM user_notice WHERE username=?", u);
                jdbc.update("DELETE FROM auth_audit_log WHERE actor=? OR target=?", u, "user:" + u);
                jdbc.update("DELETE aur FROM auth_user_role aur JOIN auth_user x ON x.id=aur.user_id WHERE x.username=?", u);
                jdbc.update("DELETE FROM auth_user WHERE username=?", u);
            }
            for (Integer id : roles) jdbc.update("DELETE FROM auth_role WHERE id=?", id);
            cache.reload();
        }
    }

    // ══════════ helpers ══════════

    private String save(String token, int roleId, String perms, String add, String remove) throws Exception {
        String name = jdbc.queryForObject("SELECT name FROM auth_role WHERE id=?", String.class, roleId);
        String layers = jdbc.queryForObject("SELECT nav_layers FROM auth_role WHERE id=?", String.class, roleId);
        String nav = layers.isBlank() ? "[]" : List.of(layers.split(",")).stream().map(x -> "\"" + x + "\"")
            .collect(Collectors.joining(",", "[", "]"));
        return body(mvc.perform(put("/api/system/roles/" + roleId).header("Authorization", hdr(token))
            .contentType("application/json").content("{\"name\":\"" + name + "\",\"navLayers\":" + nav + ",\"perms\":" + perms
                + ",\"addUserIds\":" + add + ",\"removeUserIds\":" + remove + "}")).andReturn());
    }

    private int role(String token, String prefix, String perms, String addIds) throws Exception {
        String r = body(mvc.perform(post("/api/system/roles").header("Authorization", hdr(token)).contentType("application/json")
            .content("{\"code\":\"" + prefix + "_" + System.nanoTime() % 100000 + "\",\"name\":\"成员测试" + System.nanoTime() % 100000
                + "\",\"navLayers\":[\"data\"],\"perms\":" + perms + (addIds.isEmpty() ? "" : ",\"addUserIds\":" + addIds) + "}"))
            .andReturn());
        assertThat((int) JsonPath.read(r, "$.code")).as(r).isZero();
        return JsonPath.read(r, "$.data.id");
    }

    /** 建一个账号(roleIds 为空串 = 不挂角色),返回用户名。 */
    private String user(String token, String roleIds) throws Exception {
        String u = "it-mem-" + System.nanoTime();
        String r = body(mvc.perform(post("/api/system/users").header("Authorization", hdr(token)).contentType("application/json")
            .content("{\"username\":\"" + u + "\",\"displayName\":\"成员\",\"password\":\"" + PASS + "\",\"roleIds\":[" + roleIds + "]}"))
            .andReturn());
        assertThat((int) JsonPath.read(r, "$.code")).as(r).isZero();
        passwordAlreadyChanged(u);
        return u;
    }

    private int idOf(String username) {
        return jdbc.queryForObject("SELECT id FROM auth_user WHERE username=?", Integer.class, username);
    }

    private int roleId(String code) {
        return jdbc.queryForObject("SELECT id FROM auth_role WHERE code=?", Integer.class, code);
    }

    private List<Integer> members(int roleId) {
        return jdbc.queryForList("SELECT user_id FROM auth_user_role WHERE role_id=? ORDER BY user_id", Integer.class, roleId);
    }

    private int bells(String username) {
        return jdbc.queryForObject("SELECT COUNT(*) FROM user_notice WHERE username=? AND kind='perms_changed'", Integer.class, username);
    }

    private List<String> audit(String username) {
        return jdbc.queryForList("SELECT detail FROM auth_audit_log WHERE action='user.update' AND target=? ORDER BY id",
            String.class, "user:" + username);
    }

    private int status(String token, String path) throws Exception {
        return mvc.perform(get(path).header("Authorization", hdr(token))).andReturn().getResponse().getStatus();
    }

    private String admin() throws Exception { return login("admin", "admin123"); }

    private String login(String u) throws Exception { return login(u, PASS); }

    private String login(String u, String p) throws Exception {
        return JsonPath.read(body(mvc.perform(post("/api/auth/login").contentType("application/json")
            .content("{\"username\":\"" + u + "\",\"password\":\"" + p + "\"}")).andReturn()), "$.data.token");
    }

    private static String hdr(String t) { return "Bearer " + t; }

    private static String body(MvcResult r) {
        return new String(r.getResponse().getContentAsByteArray(), StandardCharsets.UTF_8);
    }
}
