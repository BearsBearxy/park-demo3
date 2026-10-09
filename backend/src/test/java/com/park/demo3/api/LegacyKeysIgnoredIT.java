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

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;

/**
 * V140 只增不删,库里留着 v3 的旧键行(回滚到 0.32 时旧代码照常用)。新代码一律当它们不存在(RBAC-SPEC §15.8):
 * 不进快照、不进 /auth/me、不在角色屏出现、不参与分级比较和「权限变没变」;角色在 0.33 存一次,旧键行就没了。
 * 整类 @Transactional。⚠ 旧键行用 jdbc 直接插,要排在任何一次快照 reload 之前:同一事务里 MyBatis 会话会缓存 reload 的查询,
 * 先 reload 再用 jdbc 插的行,下一次 reload 读不到(AbstractMysqlIT.passwordAlreadyChanged 的注释)。
 */
@AutoConfigureMockMvc
@Transactional
class LegacyKeysIgnoredIT extends AbstractMysqlIT {
    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;
    @Autowired UserPermissionCache cache;

    private static final String PASS = "init-pass-123";

    @org.springframework.test.context.transaction.AfterTransaction
    void reloadCacheAfterRollback() { cache.reload(); }

    /**
     * 破坏验证:UserPermissionCache 不滤 Perm.exists → /auth/me 那条红;SystemService.knownPermsOf 不滤 → 角色回包那条红;
     *          permDiff 的「改前」不滤 → 日志里出现「（旧版）」,红。
     */
    @Test
    void oldOnlyRole_isEmptyEverywhere_andOneSaveDropsTheOldRows() throws Exception {
        int r = jdbcRole("it_legacy_only", "entry:view", "entry:edit", "master:view");
        String a = admin();
        String u = user(a, r);
        String t = login(u);

        assertThat(JsonPath.<List<String>>read(get(a, "/api/system/roles"), "$.data[?(@.id==" + r + ")].perms[*]")).isEmpty();
        assertThat(JsonPath.<List<String>>read(get(t, "/api/auth/me"), "$.data.permissions")).isEmpty();
        assertThat(status(t, "/api/ledger/companies/1/years")).isEqualTo(403);

        String saved = body(mvc.perform(put("/api/system/roles/" + r).header("Authorization", hdr(a)).contentType("application/json")
            .content("{\"name\":\"旧键角色\",\"navLayers\":[\"data\"],\"perms\":[\"ledger:view\"]}")).andReturn());
        assertThat((int) JsonPath.read(saved, "$.code")).as(saved).isZero();
        assertThat(jdbc.queryForList("SELECT perm FROM auth_role_perm WHERE role_id=?", String.class, r))
            .as("整组替换,旧键行没了").containsExactly("ledger:view");
        String code = jdbc.queryForObject("SELECT code FROM auth_role WHERE id=?", String.class, r);
        assertThat(jdbc.queryForList("SELECT detail FROM auth_audit_log WHERE target=? AND action='role.update'", String.class,
            "role:" + code)).containsExactly("加：月度台账（查看）；现共 1 项");
    }

    /**
     * V140 跑完的样子:旧键 + 新键都有的自建角色 X。一个非系统管理员、新键覆盖 X 的操作人:
     * 保存 X(只改备注)得 200、X 的成员收不到铃铛;用户列表里挂 X 的账号与角色列表里的 X 都是 manageable。
     * 破坏验证:updateRole 的 before 原样读 → 403「角色里有你没有的权限:…(旧版)」;changed 恒真 → 铃铛那条红;
     *          listUsers 原样读 → manageable=false 两条红。
     */
    @Test
    void mixedRole_nonSuperOperatorWhoCoversTheNewKeys_isNotBlockedByOldRows() throws Exception {
        int x = jdbcRole("it_legacy_mixed", "entry:view", "entry:edit", "ledger:view", "ledger:edit");
        int ops = jdbcRole("it_legacy_ops", "sys-roles:edit", "sys-users:edit", "ledger:edit");
        String a = admin();
        String holder = user(a, x);
        String op = login(user(a, ops));

        String saved = body(mvc.perform(put("/api/system/roles/" + x).header("Authorization", hdr(op)).contentType("application/json")
            .content("{\"name\":\"旧键角色\",\"navLayers\":[\"data\"],\"perms\":[\"ledger:view\",\"ledger:edit\"],\"remark\":\"只改备注\"}"))
            .andReturn());
        assertThat((int) JsonPath.read(saved, "$.code")).as(saved).isZero();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM user_notice WHERE username=? AND kind='perms_changed'", Integer.class, holder))
            .as("权限没变、只改了备注:不发铃铛").isZero();

        // 重新放一份「V140 跑完」的旧键,看列表的判据(上面那次保存把旧键删了)
        jdbc.update("INSERT INTO auth_role_perm (role_id, perm) VALUES (?, 'entry:view'), (?, 'entry:edit')", x, x);
        passwordAlreadyChanged(holder);   // 走一次 MyBatis 写,清掉会话缓存 —— 不然下面读到的是插旧键之前缓存的那份,怎么判都是 true
        assertThat(JsonPath.<List<Boolean>>read(get(op, "/api/system/users"), "$.data[?(@.username=='" + holder + "')].manageable"))
            .containsExactly(true);
        assertThat(JsonPath.<List<Boolean>>read(get(op, "/api/system/roles"), "$.data[?(@.id==" + x + ")].manageable"))
            .containsExactly(true);
    }

    // ══════════ helpers ══════════

    private int jdbcRole(String prefix, String... perms) {
        String code = prefix + "_" + System.nanoTime() % 100000;
        jdbc.update("INSERT INTO auth_role (code, name, builtin, nav_layers) VALUES (?, '旧键角色', 0, 'data')", code);
        int id = jdbc.queryForObject("SELECT id FROM auth_role WHERE code=?", Integer.class, code);
        for (String p : perms) jdbc.update("INSERT INTO auth_role_perm (role_id, perm) VALUES (?, ?)", id, p);
        return id;
    }

    private String user(String token, int roleId) throws Exception {
        String u = "it-legacy-" + System.nanoTime();
        String r = body(mvc.perform(post("/api/system/users").header("Authorization", hdr(token)).contentType("application/json")
            .content("{\"username\":\"" + u + "\",\"displayName\":\"旧键\",\"password\":\"" + PASS + "\",\"roleIds\":[" + roleId + "]}"))
            .andReturn());
        assertThat((int) JsonPath.read(r, "$.code")).as(r).isZero();
        passwordAlreadyChanged(u);
        return u;
    }

    private String get(String token, String path) throws Exception {
        return body(mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get(path)
            .header("Authorization", hdr(token))).andReturn());
    }

    private int status(String token, String path) throws Exception {
        return mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get(path)
            .header("Authorization", hdr(token))).andReturn().getResponse().getStatus();
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
