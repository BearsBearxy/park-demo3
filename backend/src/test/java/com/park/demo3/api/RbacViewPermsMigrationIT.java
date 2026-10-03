package com.park.demo3.api;

import com.park.demo3.AbstractMysqlIT;
import com.park.demo3.security.Perm;
import com.park.demo3.security.UserPermissionCache;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.init.ResourceDatabasePopulator;

import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

// V134(RBAC v3 查看点)迁移本身的行为验证 —— 照 ReviewMigrationIT 的形状:把
// db/migration/V134__rbac_view_perms.sql 从 classpath **原样重放**,验的是那个文件,不抄 SQL。
//
// ⚠ 断言前先把 Flyway 启动时种下的 9 个查看点删掉(system:view 不动)。不删的话,本次重放什么都没插
//   也照样绿 —— 验到的是容器启动那趟迁移的成果,不是这次重放的。
// ⚠ 不带 @Transactional,靠 @AfterEach 再重放一次把种子原样种回去(重放幂等,兜底零代价);
//   不兜的话中途炸掉,复用容器里的查看点就永久没了,别的 IT 会红在一个和自己毫无关系的地方。
class RbacViewPermsMigrationIT extends AbstractMysqlIT {

    @Autowired JdbcTemplate jdbc;
    @Autowired UserPermissionCache cache;

    private static final List<String> EIGHT = List.of(Perm.MASTER_VIEW, Perm.CONTRACT_VIEW, Perm.PARAM_VIEW,
        Perm.METER_VIEW, Perm.BILLING_VIEW, Perm.ENTRY_VIEW, Perm.REPORT_VIEW, Perm.ANALYSIS_VIEW);

    private void applyMigration() {
        ResourceDatabasePopulator populator = new ResourceDatabasePopulator(
                new ClassPathResource("db/migration/V134__rbac_view_perms.sql"),
                new ClassPathResource("db/migration/V135__role_remark_system_view.sql"));   // V135 只改 V134 写下的三句备注
        populator.setSqlScriptEncoding("UTF-8");   // 理由见 ReviewMigrationIT 同一行
        populator.execute(jdbc.getDataSource());
    }

    @AfterEach
    void reseed() {
        jdbc.update("DELETE FROM auth_role WHERE code = 'it_v134_custom'");
        jdbc.update("UPDATE auth_role SET remark = '只读;除工资明细外都能看' WHERE code = 'viewer' AND remark = '客户自己写的'");
        applyMigration();
        cache.reload();
    }

    private List<String> viewsOf(String code) {
        return jdbc.queryForList("SELECT p.perm FROM auth_role_perm p JOIN auth_role r ON r.id = p.role_id "
            + "WHERE r.code = ? AND p.perm LIKE '%:view' AND p.perm <> 'system:view'", String.class, code);
    }

    private String remarkOf(String code) {
        return jdbc.queryForObject("SELECT remark FROM auth_role WHERE code = ?", String.class, code);
    }

    private int rows() { return jdbc.queryForObject("SELECT COUNT(*) FROM auth_role_perm", Integer.class); }

    /**
     * 设计第 7 条:每个角色(内置与自建)8 个查看点,工资除外;salary:view 只给 admin 与财务主管;
     * 园区股东只给 analysis:view + report:view,导航层 'analysis,reports'。重放一遍不出重复行。
     * 破坏验证:把第 ① 段的 WHERE r.code <> 'shareholder' 去掉 → 股东那条红;
     *          第 ② 段去掉 NOT EXISTS → 重放那步主键冲突报错。
     */
    @Test
    void v134_seedsViewPermsPerRule7_andReplayAddsNoRows() {
        jdbc.update("INSERT INTO auth_role (code, name, builtin, nav_layers) VALUES ('it_v134_custom', '自建', 0, 'data')");
        jdbc.update("DELETE FROM auth_role_perm WHERE perm LIKE '%:view' AND perm <> 'system:view'");
        jdbc.update("UPDATE auth_role SET nav_layers = 'analysis' WHERE code = 'shareholder'");
        // 备注退回 V101 / V124 种的原句(第 ④ 段只改原句);再给一个客户改过的,验它不被冲掉
        jdbc.update("UPDATE auth_role SET remark = '只读;导航只有经营分析' WHERE code = 'shareholder'");
        jdbc.update("UPDATE auth_role SET remark = '只审不录:只有 review:approve,零 :edit' WHERE code = 'reviewer'");
        jdbc.update("UPDATE auth_role SET remark = '只读;导航全部可见' WHERE code = 'gm'");
        jdbc.update("UPDATE auth_role SET remark = '客户自己写的' WHERE code = 'viewer'");

        applyMigration();

        for (String code : List.of("finance_clerk", "gm", "viewer", "reviewer", "it_v134_custom")) {
            assertThat(viewsOf(code)).as(code + ":8 个查看点,不含工资").containsExactlyInAnyOrderElementsOf(EIGHT);
        }
        List<String> withSalary = new ArrayList<>(EIGHT);
        withSalary.add(Perm.SALARY_VIEW);
        for (String code : List.of("admin", "finance_manager")) {
            assertThat(viewsOf(code)).as(code + ":8 个查看点 + 工资").containsExactlyInAnyOrderElementsOf(withSalary);
        }
        assertThat(viewsOf("shareholder")).containsExactlyInAnyOrder(Perm.ANALYSIS_VIEW, Perm.REPORT_VIEW);
        assertThat(jdbc.queryForObject("SELECT nav_layers FROM auth_role WHERE code = 'shareholder'", String.class))
            .isEqualTo("analysis,reports");
        // 破坏验证:第 ④ 段删掉 → 前三条红;去掉 AND remark = 原句 → 最后一条红
        assertThat(remarkOf("shareholder")).isEqualTo("只读;导航有经营分析、账簿与报表");
        assertThat(remarkOf("reviewer")).isEqualTo("只审不录:能看除工资、系统管理外的各模块,不能改");
        assertThat(remarkOf("gm")).isEqualTo("只读;除工资明细和系统管理外都能看");
        assertThat(remarkOf("viewer")).as("客户改过的备注不动").isEqualTo("客户自己写的");

        int before = rows();
        applyMigration();
        assertThat(rows()).as("重放不出重复行").isEqualTo(before);
    }
}
