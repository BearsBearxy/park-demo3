package com.park.demo3.api;

import com.jayway.jsonpath.JsonPath;
import com.park.demo3.AbstractMysqlIT;
import com.park.demo3.security.Perm;
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
 * 系统管理分级(RBAC-SPEC §12,用户 2026-10-04 拍板「系统管理不分级反正我需要一个超级管理员的账号都能调试整个软件」)。
 *
 * 「只管账号的人」= 自建角色只有用户管理与角色权限两屏的查看 / 编辑(v4,RBAC-SPEC §15)。安全审计里他能走的四条升级路
 * (F39 给自己的角色勾满 / F86 建一个系统管理员账号 / F38 重置管理员密码 / 停用管理员)这里逐条打一遍。
 *
 * 整类 @Transactional:建的角色、账号、改的状态全部回滚;快照不随库回滚,@AfterTransaction 重载一次(同 SystemApiIT)。
 */
@AutoConfigureMockMvc
@Transactional
class SystemTieringIT extends AbstractMysqlIT {
    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;
    @Autowired com.park.demo3.security.UserPermissionCache cache;

    private static final String PASS = "init-pass-123";

    @org.springframework.test.context.transaction.AfterTransaction
    void reloadCacheAfterRollback() { cache.reload(); }

    @Test
    void itAdmin_theFourEscalationsFromTheAudit_allFail() throws Exception {
        String a = admin();
        int adminRole = roleIdOf(a, "admin");
        int adminId = userIdOf(a, "admin");
        int itRole = mkRole(a, "it_sysadm", "[\"sys-users:view\",\"sys-users:edit\",\"sys-roles:view\",\"sys-roles:edit\"]");
        String t = login(mkUser(a, "it-sysadm", itRole), PASS);
        // 第二个系统管理员:让「最后一个」那条不先出手,这里量的是分级本身
        mkUser(a, "it-adm2", adminRole);

        // ① 改自己挂的角色,给自己勾满全部权限(F39)
        String r1 = body(mvc.perform(put("/api/system/roles/" + itRole).header("Authorization", hdr(t))
            .contentType("application/json")
            .content("{\"name\":\"只管账号\",\"navLayers\":[\"data\"],\"perms\":" + json(Perm.ALL) + "}")).andReturn());
        assertThat(codeOf(r1)).isEqualTo(403);
        assertThat(msgOf(r1)).startsWith("角色里有你没有的权限：").contains("本月出账 · 查看");
        assertThat(jdbc.queryForList("SELECT perm FROM auth_role_perm WHERE role_id=?", String.class, itRole))
            .as("角色没被改").containsExactlyInAnyOrder("sys-users:view", "sys-users:edit", "sys-roles:view", "sys-roles:edit");

        // ② 建一个挂系统管理员角色的账号(F86)
        String uname = "it-sneak-" + System.nanoTime();
        String r2 = body(mvc.perform(post("/api/system/users").header("Authorization", hdr(t))
            .contentType("application/json")
            .content("{\"username\":\"" + uname + "\",\"displayName\":\"偷建\",\"password\":\"" + PASS
                   + "\",\"roleIds\":[" + adminRole + "]}")).andReturn());
        assertThat(codeOf(r2)).isEqualTo(403);
        assertThat(msgOf(r2)).isEqualTo("系统管理员角色只有系统管理员能分配");
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM auth_user WHERE username=?", Integer.class, uname)).isZero();

        // ③ 重置 admin 的密码(F38)
        String hash = jdbc.queryForObject("SELECT password_hash FROM auth_user WHERE id=?", String.class, adminId);
        String r3 = body(mvc.perform(post("/api/system/users/" + adminId + "/password").header("Authorization", hdr(t))
            .contentType("application/json").content("{\"password\":\"taken-over-1\"}")).andReturn());
        assertThat(codeOf(r3)).isEqualTo(403);
        assertThat(msgOf(r3)).endsWith("是系统管理员账号，只有系统管理员能改");
        assertThat(jdbc.queryForObject("SELECT password_hash FROM auth_user WHERE id=?", String.class, adminId))
            .as("密码没被换").isEqualTo(hash);

        // ④ 停用 admin
        String r4 = body(mvc.perform(post("/api/system/users/" + adminId + "/status").header("Authorization", hdr(t))
            .contentType("application/json").content("{\"status\":0}")).andReturn());
        assertThat(codeOf(r4)).isEqualTo(403);
        assertThat(msgOf(r4)).endsWith("是系统管理员账号，只有系统管理员能改");
        assertThat(jdbc.queryForObject("SELECT status FROM auth_user WHERE id=?", Integer.class, adminId)).isEqualTo(1);
    }

    @Test
    void superAdmin_isNotTiered_andTheLoginSaysSo() throws Exception {
        String a = admin();
        int adminRole = roleIdOf(a, "admin");
        int itRole = mkRole(a, "it_sysadm", "[\"sys-users:view\",\"sys-users:edit\",\"sys-roles:view\",\"sys-roles:edit\"]");
        String it = mkUser(a, "it-sysadm", itRole);

        // 屏上置灰靠这两个字段:系统管理员 true,只管账号的人 false
        assertThat((boolean) JsonPath.read(body(mvc.perform(get("/api/auth/me").header("Authorization", hdr(a))).andReturn()),
            "$.data.superAdmin")).isTrue();
        String itLogin = body(mvc.perform(post("/api/auth/login").contentType("application/json")
            .content("{\"username\":\"" + it + "\",\"password\":\"" + PASS + "\"}")).andReturn());
        assertThat((boolean) JsonPath.read(itLogin, "$.data.superAdmin")).isFalse();
        assertThat((boolean) JsonPath.read(body(mvc.perform(get("/api/auth/me")
            .header("Authorization", hdr(JsonPath.read(itLogin, "$.data.token")))).andReturn()), "$.data.superAdmin")).isFalse();

        // 系统管理员:建系统管理员账号、重置它的密码、停用它、给别的角色勾满 —— 全部放行
        String adm2 = mkUser(a, "it-adm2", adminRole);
        int adm2Id = userIdOf(a, adm2);
        assertThat(codeOf(body(mvc.perform(post("/api/system/users/" + adm2Id + "/password").header("Authorization", hdr(a))
            .contentType("application/json").content("{\"password\":\"another-pass-1\"}")).andReturn()))).isZero();
        assertThat(codeOf(body(mvc.perform(post("/api/system/users/" + adm2Id + "/status").header("Authorization", hdr(a))
            .contentType("application/json").content("{\"status\":0}")).andReturn()))).isZero();
        assertThat(codeOf(body(mvc.perform(put("/api/system/roles/" + itRole).header("Authorization", hdr(a))
            .contentType("application/json")
            .content("{\"name\":\"只管账号\",\"navLayers\":[\"data\"],\"perms\":" + json(Perm.ALL) + "}")).andReturn()))).isZero();
        // 系统管理员看什么都能动
        assertThat(JsonPath.<List<Boolean>>read(body(mvc.perform(get("/api/system/roles").header("Authorization", hdr(a))).andReturn()),
            "$.data[*].manageable")).containsOnly(true);
    }

    /** 范围内的照常管;编辑隐含本屏查看算进「我有的」(只勾了两屏编辑的人也有两屏查看)。 */
    @Test
    void itAdmin_managesWhatIsWithinRange_butNotBiggerRoles() throws Exception {
        String a = admin();
        int itRole = mkRole(a, "it_sysedit", "[\"sys-users:edit\",\"sys-roles:edit\"]");
        String t = login(mkUser(a, "it-sysedit", itRole), PASS);

        // 他的两屏查看是两屏编辑隐含的(角色里没勾)—— 只带用户管理查看的角色照样能建、能派、能重置、能停用
        int small = JsonPath.read(body(mvc.perform(post("/api/system/roles").header("Authorization", hdr(t))
            .contentType("application/json")
            .content("{\"code\":\"it_sysview_" + System.nanoTime() % 100000 + "\",\"name\":\"只看账号\",\"navLayers\":[\"data\"],"
                   + "\"perms\":[\"sys-users:view\"]}")).andReturn()), "$.data.id");
        String u = "it-small-" + System.nanoTime();
        String created = body(mvc.perform(post("/api/system/users").header("Authorization", hdr(t))
            .contentType("application/json")
            .content("{\"username\":\"" + u + "\",\"displayName\":\"小号\",\"password\":\"" + PASS
                   + "\",\"roleIds\":[" + small + "]}")).andReturn());
        assertThat(codeOf(created)).as(created).isZero();
        int uid = JsonPath.read(created, "$.data.id");
        assertThat(codeOf(body(mvc.perform(post("/api/system/users/" + uid + "/password").header("Authorization", hdr(t))
            .contentType("application/json").content("{\"password\":\"another-pass-1\"}")).andReturn()))).isZero();
        assertThat(codeOf(body(mvc.perform(post("/api/system/users/" + uid + "/status").header("Authorization", hdr(t))
            .contentType("application/json").content("{\"status\":0}")).andReturn()))).isZero();

        // 财务专员角色比他大:派不出去、改不了(往小里改也不行 —— 改前那份就超了)、自建的大角色也删不了,
        // 挂着它的账号也碰不了
        int clerk = roleIdOf(a, "finance_clerk");
        int clerkUid = userIdOf(a, mkUser(a, "it-clerk", clerk));
        String r0 = body(mvc.perform(post("/api/system/users/" + clerkUid + "/password").header("Authorization", hdr(t))
            .contentType("application/json").content("{\"password\":\"taken-over-1\"}")).andReturn());
        assertThat(codeOf(r0)).isEqualTo(403);
        assertThat(msgOf(r0)).contains("有你没有的权限：").endsWith("只有系统管理员能改这个账号");
        String r1 = body(mvc.perform(post("/api/system/users").header("Authorization", hdr(t))
            .contentType("application/json")
            .content("{\"username\":\"it-big-" + System.nanoTime() + "\",\"displayName\":\"大号\",\"password\":\"" + PASS
                   + "\",\"roleIds\":[" + clerk + "]}")).andReturn());
        assertThat(codeOf(r1)).isEqualTo(403);
        assertThat(msgOf(r1)).startsWith("要分配的角色里有你没有的权限：");
        String r2 = body(mvc.perform(put("/api/system/roles/" + clerk).header("Authorization", hdr(t))
            .contentType("application/json")
            .content("{\"name\":\"财务专员\",\"navLayers\":[\"data\"],\"perms\":[]}")).andReturn());
        assertThat(codeOf(r2)).isEqualTo(403);
        assertThat(msgOf(r2)).startsWith("角色里有你没有的权限：");
        int big = mkRole(a, "it_big", "[\"ledger:edit\"]");
        assertThat(codeOf(body(mvc.perform(delete("/api/system/roles/" + big).header("Authorization", hdr(t))).andReturn())))
            .isEqualTo(403);
        // 系统管理员角色:哪怕只改名
        int adminRole = roleIdOf(a, "admin");
        String r3 = body(mvc.perform(put("/api/system/roles/" + adminRole).header("Authorization", hdr(t))
            .contentType("application/json").content("{\"name\":\"改个名\",\"navLayers\":[\"data\"],\"perms\":[]}")).andReturn());
        assertThat(msgOf(r3)).isEqualTo("系统管理员角色只有系统管理员能改");

        // 屏上据此置灰:同一条判据
        String roles = body(mvc.perform(get("/api/system/roles").header("Authorization", hdr(t))).andReturn());
        assertThat(JsonPath.<List<Boolean>>read(roles, "$.data[?(@.id==" + clerk + ")].manageable")).containsExactly(false);
        assertThat(JsonPath.<List<Boolean>>read(roles, "$.data[?(@.id==" + adminRole + ")].manageable")).containsExactly(false);
        assertThat(JsonPath.<List<Boolean>>read(roles, "$.data[?(@.id==" + small + ")].manageable")).containsExactly(true);
        String users = body(mvc.perform(get("/api/system/users").header("Authorization", hdr(t))).andReturn());
        assertThat(JsonPath.<List<Boolean>>read(users, "$.data[?(@.username=='admin')].manageable")).containsExactly(false);
        assertThat(JsonPath.<List<Boolean>>read(users, "$.data[?(@.id==" + uid + ")].manageable")).containsExactly(true);
        assertThat(JsonPath.<List<Boolean>>read(users, "$.data[?(@.id==" + clerkUid + ")].manageable")).containsExactly(false);
    }

    /**
     * 至少留一个启用的系统管理员。先把库里别的系统管理员都停掉(本类回滚,不留痕),
     * 只管账号的人去停用 / 摘角色 —— 拿到的是「最后一个」这句,不是分级那句:后果比范围更该先说。
     */
    @Test
    void theLastEnabledAdmin_cannotBeDisabledOrStripped() throws Exception {
        String a = admin();
        int adminRole = roleIdOf(a, "admin");
        int adminId = userIdOf(a, "admin");
        jdbc.update("UPDATE auth_user SET status=0 WHERE username<>'admin' AND id IN "
                  + "(SELECT user_id FROM auth_user_role WHERE role_id=?)", adminRole);
        int itRole = mkRole(a, "it_sysadm", "[\"sys-users:view\",\"sys-users:edit\",\"sys-roles:view\",\"sys-roles:edit\"]");
        String t = login(mkUser(a, "it-sysadm", itRole), PASS);

        String off = body(mvc.perform(post("/api/system/users/" + adminId + "/status").header("Authorization", hdr(t))
            .contentType("application/json").content("{\"status\":0}")).andReturn());
        assertThat(codeOf(off)).isEqualTo(409);
        assertThat(msgOf(off)).contains("是最后一个启用的系统管理员账号");

        String strip = body(mvc.perform(put("/api/system/users/" + adminId).header("Authorization", hdr(t))
            .contentType("application/json").content("{\"displayName\":\"系统管理员\",\"roleIds\":[]}")).andReturn());
        assertThat(codeOf(strip)).isEqualTo(409);
        assertThat(msgOf(strip)).contains("是最后一个启用的系统管理员账号");
        assertThat(jdbc.queryForObject("SELECT status FROM auth_user WHERE id=?", Integer.class, adminId)).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM auth_user_role WHERE user_id=? AND role_id=?",
            Integer.class, adminId, adminRole)).isEqualTo(1);

        // 还有别的启用管理员时,系统管理员停用另一个照常放行(他自己还在)
        int adm2 = userIdOf(a, mkUser(a, "it-adm2", adminRole));
        assertThat(codeOf(body(mvc.perform(post("/api/system/users/" + adm2 + "/status").header("Authorization", hdr(a))
            .contentType("application/json").content("{\"status\":0}")).andReturn()))).isZero();
    }

    // ══════════ helpers ══════════

    private String admin() throws Exception { return login("admin", "admin123"); }
    private String hdr(String t) { return "Bearer " + t; }

    private String login(String user, String pass) throws Exception {
        return JsonPath.read(body(mvc.perform(post("/api/auth/login").contentType("application/json")
            .content("{\"username\":\"" + user + "\",\"password\":\"" + pass + "\"}")).andReturn()), "$.data.token");
    }

    private String body(MvcResult r) {
        return new String(r.getResponse().getContentAsByteArray(), StandardCharsets.UTF_8);
    }

    private int codeOf(String body) { return JsonPath.read(body, "$.code"); }
    private String msgOf(String body) { return JsonPath.read(body, "$.message"); }

    private static String json(List<String> xs) {
        return xs.stream().map(x -> "\"" + x + "\"").collect(Collectors.joining(",", "[", "]"));
    }

    private int mkRole(String token, String codePrefix, String permsJson) throws Exception {
        String b = body(mvc.perform(post("/api/system/roles").header("Authorization", hdr(token))
            .contentType("application/json")
            .content("{\"code\":\"" + codePrefix + "_" + System.nanoTime() % 100000 + "\",\"name\":\"只管账号\","
                   + "\"navLayers\":[\"data\"],\"perms\":" + permsJson + "}")).andReturn());
        assertThat(codeOf(b)).as(b).isZero();
        return JsonPath.read(b, "$.data.id");
    }

    private String mkUser(String token, String prefix, int roleId) throws Exception {
        String uname = prefix + "-" + System.nanoTime();
        String b = body(mvc.perform(post("/api/system/users").header("Authorization", hdr(token))
            .contentType("application/json")
            .content("{\"username\":\"" + uname + "\",\"displayName\":\"分级测试\",\"password\":\"" + PASS
                   + "\",\"roleIds\":[" + roleId + "]}")).andReturn());
        assertThat(codeOf(b)).as(b).isZero();
        passwordAlreadyChanged(uname);
        return uname;
    }

    private int roleIdOf(String token, String code) throws Exception {
        List<Integer> ids = JsonPath.read(body(mvc.perform(get("/api/system/roles").header("Authorization", hdr(token))).andReturn()),
            "$.data[?(@.code=='" + code + "')].id");
        assertThat(ids).hasSize(1);
        return ids.get(0);
    }

    private int userIdOf(String token, String username) throws Exception {
        List<Integer> ids = JsonPath.read(body(mvc.perform(get("/api/system/users").param("q", username)
            .header("Authorization", hdr(token))).andReturn()), "$.data[?(@.username=='" + username + "')].id");
        assertThat(ids).hasSize(1);
        return ids.get(0);
    }
}
