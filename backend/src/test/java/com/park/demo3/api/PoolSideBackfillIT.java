package com.park.demo3.api;

import com.park.demo3.AbstractMysqlIT;
import com.park.demo3.service.AllocService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.init.ResourceDatabasePopulator;

import static org.assertj.core.api.Assertions.assertThat;

// F4a(V115 迁移)· 方位回填的 WHERE 子句本身的行为验证。
//
// ⚠ 不能按"插入候选行 → 触发迁移 → 断言"的顺序写:Flyway 迁移只在 Spring 容器启动时跑一次,
//   早于本类任何 @Test 方法执行——真正的存量池(59/60/69/70/78/79/88)早被迁移(或没被迁移,
//   取决于本容器有没有见过 V115)处理过,测试时刻再插入的合成行永远赶不上那趟迁移。
//   改为把 db/migration/V115__pool_side_backfill.sql **从 classpath 原样重放**到本用例自己
//   插入的合成行上:验证的是文件里那两条 UPDATE 的真实行为("只认 name 里紧跟 floor_label
//   之后的方位词,不做模糊匹配"),不依赖存量池具体是哪个 id ——本仓库复用的 Testcontainers 库
//   跑了很多年份的历史用例,存量 id 的字段可能已被其它非事务用例污染过,断言真实 id 的当前值
//   不可靠(demo3-mysql 那份真实 dev 库才是本迁移最终要生效的地方,由手动验收:启动一次后端 +
//   docker exec 查询确认,不进本自动化测试)。
// ⚠ 复审 Finding(Important):第一版这里把 V115 的两条 UPDATE 抄成了 Java 字符串常量——
//   改迁移文件、测试原样绿,等于没测到真实产物。改为从 classpath 加载并执行 .sql 文件本身
//   (ResourceDatabasePopulator,Spring 自带,不必自己写解析器),字符串常量与迁移文件之间
//   不再有第二个可以各自漂移的副本。
@org.springframework.transaction.annotation.Transactional
class PoolSideBackfillIT extends AbstractMysqlIT {

    @Autowired JdbcTemplate jdbc;

    /** 从 classpath 加载 db/migration/{filename} 并原样执行——不解析、不复制,执行的就是那个文件。 */
    private void applyMigration(String filename) {
        ResourceDatabasePopulator populator =
                new ResourceDatabasePopulator(new ClassPathResource("db/migration/" + filename));
        // ⚠ 不显式指定编码,populator 用平台默认字符集读文件——Windows 默认不是 UTF-8,
        // 迁移文件里的中文注释/中点会被读错,进而打乱按 ';' 切语句的边界,UPDATE 整条静默失效。
        populator.setSqlScriptEncoding("UTF-8");
        populator.execute(jdbc.getDataSource());
    }

    // sort_no 的 MAX+1 子查询套一层派生表(FROM (SELECT ...) t):MySQL 不许在同一语句里
    // 直接对目标表做子查询(错误 1093),套一层派生表是该限制的标准绕法。
    private int insertRule(String name, String floorLabel) {
        jdbc.update("INSERT INTO alloc_rule (zone, name, method, fee_key, floor_label, sort_no) "
                + "VALUES ('p1', ?, 'none', 'share_elec_floor', ?, "
                + "(SELECT n FROM (SELECT COALESCE(MAX(sort_no), 0) + 1 AS n FROM alloc_rule) t))",
                name, floorLabel);
        return jdbc.queryForObject("SELECT LAST_INSERT_ID()", Integer.class);
    }

    @Test
    void backfill_onlyTrailingDirectionRightAfterFloorLabel_noFuzzyMatch() {
        int east = insertRule("一期 IT座·天面东侧·货梯", "天面");
        int west = insertRule("一期 IT座·天面西侧·货梯", "天面");
        // 池 25 型:floor_label 有值,但 name 里不含"floor_label+方位"子串——不该被误回填
        int noDirectionInName = insertRule("一期园区·IT路灯", "一楼");
        // 不做模糊匹配:方位词没有紧跟在 floor_label 后面(中间夹了别的字符)不该命中
        int notAdjacent = insertRule("一期 IT座·天面·东侧货梯", "天面");

        applyMigration("V115__pool_side_backfill.sql");

        assertThat(jdbc.queryForObject("select side from alloc_rule where id=?", String.class, east)).isEqualTo("东侧");
        assertThat(jdbc.queryForObject("select side from alloc_rule where id=?", String.class, west)).isEqualTo("西侧");
        assertThat(jdbc.queryForObject("select side from alloc_rule where id=?", String.class, noDirectionInName)).isNull();
        assertThat(jdbc.queryForObject("select side from alloc_rule where id=?", String.class, notAdjacent)).isNull();

        // 回填后按 poolName 同规则复算,须与现名全等(否则说明回填的方位与原名对不上)
        assertThat(AllocService.poolName("p1", "一期 IT座", "天面", "东侧", "货梯"))
                .isEqualTo("一期 IT座·天面东侧·货梯");
        assertThat(AllocService.poolName("p1", "一期 IT座", "天面", "西侧", "货梯"))
                .isEqualTo("一期 IT座·天面西侧·货梯");
    }

    @Test
    void backfill_alreadyHasSide_notOverwritten() {
        // 迁移只填 side IS NULL 的行;已经手填过 side 的池(全库仅 51/52,这里造一个同型样本)不该被覆盖
        jdbc.update("INSERT INTO alloc_rule (zone, name, method, fee_key, floor_label, side, sort_no) "
                + "VALUES ('p1', '一期 IT座·一楼东侧', 'none', 'share_elec_floor', '一楼', '西侧', "
                + "(SELECT n FROM (SELECT COALESCE(MAX(sort_no), 0) + 1 AS n FROM alloc_rule) t))");
        Integer id = jdbc.queryForObject(
                "select id from alloc_rule where name='一期 IT座·一楼东侧'", Integer.class);

        applyMigration("V115__pool_side_backfill.sql");

        // name 里其实是"东侧"字样,但既有 side='西侧' 不该被迁移按 name 反推着改回去
        assertThat(jdbc.queryForObject("select side from alloc_rule where id=?", String.class, id)).isEqualTo("西侧");
    }
}
