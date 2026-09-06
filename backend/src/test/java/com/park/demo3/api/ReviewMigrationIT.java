package com.park.demo3.api;

import com.park.demo3.AbstractMysqlIT;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.init.ResourceDatabasePopulator;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

// V124(审核机制)迁移本身的行为验证 —— 照 PoolSideBackfillIT 的形状:把
// db/migration/V124__review.sql 从 classpath **原样重放**,验的是那个文件。
// 不许把 SQL 抄成 Java 字符串:抄一份就有两个各自漂移的副本,改了迁移测试照绿 = 没测到真实产物。
//
// ⚠ 断言前先把 Flyway 启动时已经种进去的那两行删掉。不删的话,本次重放什么都没插进去
//   也照样绿 —— 验到的是容器启动那趟迁移的成果,不是这次重放的。
// ⚠ 类上的 @Transactional 挡不住这里:MySQL 的 CREATE TABLE 会隐式提交,删行跟着一起提交。
//   本用例不靠回滚收场,靠「重放把删掉的两行原样种回去」—— 跑完的库态与跑之前等价。
@org.springframework.transaction.annotation.Transactional
class ReviewMigrationIT extends AbstractMysqlIT {

    @Autowired JdbcTemplate jdbc;

    /** 从 classpath 加载 V124 并原样执行——不解析、不复制,执行的就是那个文件。 */
    private void applyMigration() {
        ResourceDatabasePopulator populator = new ResourceDatabasePopulator(
                new ClassPathResource("db/migration/V124__review.sql"));
        // ⚠ 不显式指定编码,populator 用平台默认字符集读文件 —— 本机 Java 17 的 file.encoding=GBK。
        // 实测拿掉这行:按 ';' 切语句不受影响,两条 INSERT 照样成功,但中文串全成乱码
        // ('审核员' 落库成 '瀹℃牳鍛')。所以下面断言 2 必须连 name 一起验,只验 ASCII 列是假绿。
        populator.setSqlScriptEncoding("UTF-8");
        populator.execute(jdbc.getDataSource());
    }

    /**
     * 无论用例走到哪一步失败,都把种子原样种回去。
     *
     * 本用例开头的两条 DELETE 会被随后 CREATE TABLE 的**隐式提交**带着一起落库,类上的
     * @Transactional 挡不住;若 applyMigration 中途炸掉,复用容器(testcontainers.reuse.enable=true)
     * 里的 reviewer 种子就永久没了 —— 下一次跑 RoleApiIT 会红在一个和它自己毫无关系的地方,
     * 正是 AbstractMysqlIT 头注释里那个「单跑绿、连跑红」。重放是幂等的,兜底零代价。
     */
    @org.junit.jupiter.api.AfterEach
    void reseed() {
        applyMigration();
    }

    private List<String> columnsOf(String table) {
        return jdbc.queryForList("SELECT column_name FROM information_schema.columns "
                + "WHERE table_schema = DATABASE() AND table_name = ?", String.class, table);
    }

    private int reviewerRoles() {
        return jdbc.queryForObject("SELECT COUNT(*) FROM auth_role WHERE code = 'reviewer'", Integer.class);
    }

    private int approvePerms() {
        return jdbc.queryForObject(
                "SELECT COUNT(*) FROM auth_role_perm WHERE perm = 'review:approve'", Integer.class);
    }

    @Test
    void v124_buildsBothTables_seedsReviewerRole_andReplaysIdempotently() {
        jdbc.update("DELETE FROM auth_role_perm WHERE perm = 'review:approve'");
        jdbc.update("DELETE FROM auth_role WHERE code = 'reviewer'");

        applyMigration();

        // 1. 两张表列齐:列名集合**恰好**等于 DDL 里那 10 列 / 6 列,多一列少一列都红
        assertThat(columnsOf("review_state")).containsExactlyInAnyOrder(
                "review_key", "kind", "period", "scope", "status",
                "submitted_by", "submitted_at", "reviewed_by", "reviewed_at", "reason");
        assertThat(columnsOf("review_log")).containsExactlyInAnyOrder(
                "id", "review_key", "action", "actor", "at", "reason");

        // 2. 第 7 个预置角色,恰好一行。name 一并验:见 applyMigration 里的编码坑
        assertThat(reviewerRoles()).isEqualTo(1);
        Map<String, Object> reviewer = jdbc.queryForMap(
                "SELECT name, builtin, nav_layers FROM auth_role WHERE code = 'reviewer'");
        assertThat(reviewer.get("name")).isEqualTo("审核员");
        assertThat(((Number) reviewer.get("builtin")).intValue()).isEqualTo(1);
        assertThat(reviewer.get("nav_layers")).isEqualTo("data,reports,analysis");

        // 3. review:approve 恰好两行,授给 admin 与 reviewer
        assertThat(approvePerms()).isEqualTo(2);
        assertThat(jdbc.queryForList("SELECT r.code FROM auth_role r "
                + "JOIN auth_role_perm p ON p.role_id = r.id WHERE p.perm = 'review:approve'", String.class))
                .containsExactlyInAnyOrder("admin", "reviewer");

        // 4. 幂等:同一份文件再放一遍,两处行数一个都不许多(靠两条 INSERT 的 NOT EXISTS 守卫)
        applyMigration();
        assertThat(reviewerRoles()).isEqualTo(1);
        assertThat(approvePerms()).isEqualTo(2);
    }
}
