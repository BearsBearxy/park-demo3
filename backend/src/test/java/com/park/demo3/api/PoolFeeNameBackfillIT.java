package com.park.demo3.api;

import com.park.demo3.AbstractMysqlIT;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.init.ResourceDatabasePopulator;

import static org.assertj.core.api.Assertions.assertThat;

// F4 补丁(V116 迁移)· fee_name 回填 + 池 23 更正的 WHERE 子句行为验证。
//
// F4 只顾了 side(V115),同一个失效模式在 fee_name 上原样重演(docs/superpowers/specs/
// 2026-08-29-pool-entry-coverage-audit.md:61,原计划漏掉这半边——复审 Finding(Critical))。
// 与 PoolSideBackfillIT 同款手法:从 classpath 加载 db/migration/V116__pool_fee_name_backfill.sql
// 原样执行,不抄成 Java 字符串常量(改迁移文件、测试要跟着红,而不是自己抄一份各自漂移)。
// 对合成数据放,不断言存量池 92/96/97/98/99/23 的具体现值——理由同 PoolSideBackfillIT 文件头:
// Testcontainers 复用库里这批 id 的字段已经被污染过,断言不可靠;真实数据的回填结果由
// demo3-mysql 直接查询核实(本迁移的手动验收步骤)。
@org.springframework.transaction.annotation.Transactional
class PoolFeeNameBackfillIT extends AbstractMysqlIT {

    @Autowired JdbcTemplate jdbc;

    private void applyMigration(String filename) {
        ResourceDatabasePopulator populator =
                new ResourceDatabasePopulator(new ClassPathResource("db/migration/" + filename));
        // ⚠ 不显式指定编码,populator 用平台默认字符集读文件——Windows 默认不是 UTF-8,
        // 迁移文件里的中文注释/中点会被读错,进而打乱按 ';' 切语句的边界,UPDATE 整条静默失效
        // (PoolSideBackfillIT 复审时踩过一次)。
        populator.setSqlScriptEncoding("UTF-8");
        populator.execute(jdbc.getDataSource());
    }

    private Integer buildingId(String name) {
        return jdbc.queryForObject("select id from building where name=?", Integer.class, name);
    }

    private int insertRule(String name, Integer buildingId, String floorLabel, String side, String feeName) {
        jdbc.update("INSERT INTO alloc_rule (zone, name, method, fee_key, building_id, floor_label, side, "
                + "fee_name, sort_no) VALUES ('p1', ?, 'none', 'share_elec_floor', ?, ?, ?, ?, "
                + "(SELECT n FROM (SELECT COALESCE(MAX(sort_no), 0) + 1 AS n FROM alloc_rule) t))",
                name, buildingId, floorLabel, side, feeName);
        return jdbc.queryForObject("SELECT LAST_INSERT_ID()", Integer.class);
    }

    @Test
    void safeLift_onlyWhenReconstructionMatchesExactly() {
        Integer aZuo = buildingId("一期 A座");

        // (a) 干净情形:fee_name NULL,name = building·floor·末段,原样lift
        int clean = insertRule("一期 A座·一楼·IT联塑精铟", aZuo, "一楼", null, null);
        // 已经有 fee_name 的行不该被覆盖
        int alreadySet = insertRule("一期 A座·一楼·IT大堂", aZuo, "一楼", null, "别的费项");
        // 重构对不上(name 多了一段/顺序不对)不该被误 lift——floor_label 与 name 中的段不一致
        int mismatch = insertRule("一期 A座·二楼·IT大堂", aZuo, "一楼", null, null);
        // 没有 building(building_id NULL)天然被 JOIN 排除——池 25 型
        int noBuilding = insertRule("一期园区·IT路灯", null, "一楼", null, null);

        applyMigration("V116__pool_fee_name_backfill.sql");

        assertThat(jdbc.queryForObject("select fee_name from alloc_rule where id=?", String.class, clean))
                .isEqualTo("IT联塑精铟");
        assertThat(jdbc.queryForObject("select fee_name from alloc_rule where id=?", String.class, alreadySet))
                .isEqualTo("别的费项");
        assertThat(jdbc.queryForObject("select fee_name from alloc_rule where id=?", String.class, mismatch)).isNull();
        assertThat(jdbc.queryForObject("select fee_name from alloc_rule where id=?", String.class, noBuilding)).isNull();
    }

    @Test
    void poolTwentyThreeFix_isScopedToThatLiteralId_notContentMatch() {
        // 与池 23 逐字相同的 fee_name/name 内容("招商中心"/"一期 招商中心·净电"),但 id 不是 23——
        // V116 那条更正语句用 WHERE id = 23 锁死,那条 WHERE 不看 building 表,只看 alloc_rule
        // 自己的 id/fee_name/name 三列,所以这里 building_id 挂哪栋楼无所谓,故意随便挂一栋
        // (已确认存在的"一期 A座")。真正要证明的是:即使内容与池 23 逐字相同,id 对不上就不该动——
        // 否则将来随便一条同类错误数据都会被这条本该只管一行的更正语句误伤。
        Integer aZuo = buildingId("一期 A座");
        int lookalike = insertRule("一期 招商中心·净电", aZuo, "四楼", null, "招商中心");

        applyMigration("V116__pool_fee_name_backfill.sql");

        var row = jdbc.queryForMap("select fee_name, name from alloc_rule where id=?", lookalike);
        assertThat(row.get("fee_name")).as("同型但非 id=23 的行不该被这条只认字面 id 的更正语句碰").isEqualTo("招商中心");
        assertThat(row.get("name")).isEqualTo("一期 招商中心·净电");
    }
}
