package com.park.demo3.api;

import com.park.demo3.AbstractMysqlIT;
import com.park.demo3.config.LegacyPermBackfill;
import com.park.demo3.security.Perm;
import com.park.demo3.security.UserPermissionCache;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.init.ResourceDatabasePopulator;
import org.springframework.transaction.annotation.Transactional;

import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * V140(RBAC-SPEC §15.8)本身的行为:从 classpath **原样重放** db/common/V140__rbac_screen_perms.sql,验的是那个文件,不抄 SQL。
 * ⚠ 断言前先把 V140 种下的新键删掉(新旧同名的五个键不动)—— 不删的话本次重放什么都没插也照样绿。
 * V140 只有 INSERT 没有 DDL:整类 @Transactional,删的、插的、建的角色全部回滚;快照 @AfterTransaction 重载。
 */
@Transactional
class RbacScreenPermsMigrationIT extends AbstractMysqlIT {

    @Autowired JdbcTemplate jdbc;
    @Autowired UserPermissionCache cache;
    @Autowired LegacyPermBackfill backfill;

    /** 新旧同名、不靠 V140 映射的五个键。 */
    private static final Set<String> SAME_NAME = Set.of("salary:view", "salary:edit",
        Perm.REVIEW_APPROVE, Perm.LOCK_TAKEOVER, Perm.ELEVATE_REQUEST);

    @org.springframework.test.context.transaction.AfterTransaction
    void reloadCacheAfterRollback() { cache.reload(); }

    private void applyV140() {
        ResourceDatabasePopulator p = new ResourceDatabasePopulator(new ClassPathResource("db/common/V140__rbac_screen_perms.sql"));
        p.setSqlScriptEncoding("UTF-8");
        p.execute(jdbc.getDataSource());
    }

    private void dropNewKeys() {
        List<String> fresh = Perm.ALL.stream().filter(k -> !SAME_NAME.contains(k)).toList();
        jdbc.update("DELETE FROM auth_role_perm WHERE perm IN (" + fresh.stream().map(k -> "'" + k + "'")
            .collect(Collectors.joining(",")) + ")");
    }

    private Set<String> known(String code) {
        return jdbc.queryForList("SELECT p.perm FROM auth_role_perm p JOIN auth_role r ON r.id = p.role_id WHERE r.code = ?",
            String.class, code).stream().filter(Perm::exists).collect(Collectors.toSet());
    }

    private Set<String> legacy(String code) {
        return jdbc.queryForList("SELECT p.perm FROM auth_role_perm p JOIN auth_role r ON r.id = p.role_id WHERE r.code = ?",
            String.class, code).stream().filter(Perm.LEGACY_LABELS::containsKey).collect(Collectors.toSet());
    }

    private int rows() { return jdbc.queryForObject("SELECT COUNT(*) FROM auth_role_perm", Integer.class); }

    private void role(String code, String... perms) {
        jdbc.update("INSERT INTO auth_role (code, name, builtin, nav_layers) VALUES (?, '自建', 0, 'data')", code);
        int id = jdbc.queryForObject("SELECT id FROM auth_role WHERE code = ?", Integer.class, code);
        for (String p : perms) jdbc.update("INSERT INTO auth_role_perm (role_id, perm) VALUES (?, ?)", id, p);
    }

    /**
     * §15.4:七个预置角色迁移后逐屏的有效权限与 v3 完全一致(表逐格写在 PresetRolesV4)。
     * 旧键行原样保留;重放一遍什么都不变。
     * 破坏验证:① 段删掉 report:view → import 那一行 → 园区股东红;② 段删掉 billing-run:edit → params:recalc → 财务专员红;
     *          ① 段去掉 NOT EXISTS → 重放那步主键冲突。
     */
    @Test
    void presetRolesEqualSpecTable_oldRowsKept_replayIsANoOp() {
        Map<String, Set<String>> legacyBefore = new java.util.HashMap<>();
        for (String code : com.park.demo3.security.PresetRolesV4.EXPECTED.keySet()) legacyBefore.put(code, legacy(code));
        dropNewKeys();
        assertThat(known("finance_clerk")).as("前提:新键删干净了(同名的可请求提权留着)").containsExactly(Perm.ELEVATE_REQUEST);

        applyV140();

        com.park.demo3.security.PresetRolesV4.EXPECTED.forEach((code, want) ->
            assertThat(known(code)).as(code).containsExactlyInAnyOrderElementsOf(want));
        legacyBefore.forEach((code, was) -> assertThat(legacy(code)).as(code + " 的旧键行原样保留").isEqualTo(was));
        assertThat(legacyBefore.get("admin")).as("前提:种子里有旧键").isNotEmpty();

        int before = rows();
        applyV140();
        assertThat(rows()).as("重放什么都不变").isEqualTo(before);
    }

    /**
     * 自建角色:动作只在这个角色已经能看那一屏时才给(§15.3 标「需本屏查看」的几行)。
     * 破坏验证:② 段去掉 WHERE EXISTS(本屏查看)→ 「只有计费口径」那条多出公摊池配置 / 系数簿 / 电价口径,红。
     */
    @Test
    void customRoles_actionsOnlyWhereTheScreenIsVisible() {
        role("it_v140_meter", "meter:view");
        role("it_v140_policy", "param-policy:edit");
        role("it_v140_company", "company:manage", "entry:view");
        role("it_v140_master", "master:edit");
        role("it_v140_master_bill", "master:edit", "billing:view");
        dropNewKeys();

        applyV140();

        assertThat(known("it_v140_meter")).as("抄表查看 → 六屏查看").containsExactlyInAnyOrder(
            "meters:view", "pv-income:view", "car-charging:view", "ebike-charging:view", "data-home:view", "import:view");
        assertThat(known("it_v140_policy"))
            .as("计费口径先折成计费参数查看(三屏),动作只给本屏的;公摊池配置、系数簿、电价口径那几屏它看不了,不给")
            .containsExactlyInAnyOrder("data-home:view", "params:view", "import:view", "params:edit");
        assertThat(known("it_v140_company")).contains("ledger:company", "ledger:view");
        assertThat(known("it_v140_master")).as("没有催缴单查看:不给收款公司").doesNotContain("bill-notices:payee")
            .contains("buildings:edit", "tenants:edit");
        assertThat(known("it_v140_master_bill")).contains("bill-notices:payee", "bill-notices:view");
    }

    /**
     * 启动补齐(LegacyPermBackfill):一个只剩旧键的角色(模拟回滚到 0.32 期间在那边存过)跑一次后,新键与 V140 的结果相同;
     * 只有新键的角色(0.33 里存过)一行不变 —— 勾了工资的也不变(salary:* 新旧同名,也在 V140 第①步的旧键表里)。
     * 破坏验证:LegacyPermBackfill.run 不执行脚本 → 第一条红;脚本执行后不 reload → 「快照里有」那条红;
     *          guardedScript 不插 JOIN(原样跑 V140)→ 「工资」两条红(每次启动多出本月出账、导入中心的查看)。
     */
    @Test
    void startupBackfill_restoresNewKeysForOldOnlyRoles_andLeavesNewOnlyRolesAlone() {
        role("it_v140_old", "entry:edit", "billing-run:edit", "billing:view");
        role("it_v140_new", "ledger:view", "ledger:edit");
        role("it_v140_salv", "salary:view");
        role("it_v140_sale", "salary:edit", "ledger:view");
        role("it_v140_old_sal", "meter:view", "salary:view");
        jdbc.update("INSERT INTO auth_user (username, password_hash, display_name, status, role, must_change_password, token_version)"
            + " VALUES ('it-v140-old', 'x', '旧键账号', 1, 'admin', 0, 0)");
        jdbc.update("INSERT INTO auth_user_role (user_id, role_id) SELECT u.id, r.id FROM auth_user u, auth_role r"
            + " WHERE u.username = 'it-v140-old' AND r.code = 'it_v140_old'");
        Set<String> newOnly = known("it_v140_new");

        backfill.run(null);

        Set<String> want = new HashSet<>(List.of("ledger:view", "sales-income:view", "pv-income:view", "car-charging:view",
            "ebike-charging:view", "elec-cost:view", "utilities:view", "data-home:view", "import:view",
            "alloc:view", "alloc-loss:view", "bill-notices:view",
            "ledger:edit", "sales-income:edit", "pv-income:edit", "car-charging:edit", "ebike-charging:edit", "elec-cost:edit",
            "utilities:edit", "import:edit", "alloc:edit", "alloc-loss:edit", "bill-notices:edit"));
        assertThat(known("it_v140_old")).as("没有计费参数查看:重算不给").containsExactlyInAnyOrderElementsOf(want);
        assertThat(known("it_v140_new")).isEqualTo(newOnly);
        assertThat(known("it_v140_salv")).as("0.33 里存过、只勾工资查看:不多出本月出账 / 导入中心").containsExactly("salary:view");
        assertThat(known("it_v140_sale")).as("0.33 里存过、勾工资编辑").containsExactlyInAnyOrder("salary:edit", "ledger:view");
        assertThat(known("it_v140_old_sal")).as("还有旧键的角色:工资照旧键推(对照,JOIN 没把它挡掉)")
            .contains("salary:view", "data-home:view", "import:view", "meters:view");
        assertThat(cache.get("it-v140-old").perms()).as("补完刷新了快照").contains("ledger:edit", "bill-notices:edit");
    }
}
