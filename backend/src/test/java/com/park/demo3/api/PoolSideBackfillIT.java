package com.park.demo3.api;

import com.park.demo3.AbstractMysqlIT;
import com.park.demo3.service.AllocService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;

import static org.assertj.core.api.Assertions.assertThat;

// F4a(V115 迁移)· 方位回填的 WHERE 子句本身的行为验证。
//
// ⚠ 不能按"插入候选行 → 触发迁移 → 断言"的顺序写:Flyway 迁移只在 Spring 容器启动时跑一次,
//   早于本类任何 @Test 方法执行——真正的存量池(59/60/69/70/78/79/88)早被迁移(或没被迁移,
//   取决于本容器有没有见过 V115)处理过,测试时刻再插入的合成行永远赶不上那趟迁移。
//   改为把 V115 里那两条 UPDATE 原文重放到本用例自己插入的合成行上:验证的是 WHERE 子句
//   "只认 name 里紧跟 floor_label 之后的方位词,不做模糊匹配"这条逻辑,不依赖存量池具体是哪个 id
//   ——本仓库复用的 Testcontainers 库跑了很多年份的历史用例,存量 id 的字段可能已被其它非事务用例
//   污染过,断言真实 id 的当前值不可靠(demo3-mysql 那份真实 dev 库才是本迁移最终要生效的地方,
//   由随手动验收:启动一次后端 + docker exec 查询确认,不进本自动化测试)。
@org.springframework.transaction.annotation.Transactional
class PoolSideBackfillIT extends AbstractMysqlIT {

    @Autowired JdbcTemplate jdbc;

    private static final String UPDATE_EAST = "UPDATE alloc_rule SET side = '东侧' "
            + "WHERE side IS NULL AND floor_label IS NOT NULL AND name LIKE CONCAT('%', floor_label, '东侧%')";
    private static final String UPDATE_WEST = "UPDATE alloc_rule SET side = '西侧' "
            + "WHERE side IS NULL AND floor_label IS NOT NULL AND name LIKE CONCAT('%', floor_label, '西侧%')";

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

        jdbc.update(UPDATE_EAST);
        jdbc.update(UPDATE_WEST);

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
        jdbc.update(UPDATE_EAST);
        jdbc.update(UPDATE_WEST);
        // name 里其实是"东侧"字样,但既有 side='西侧' 不该被迁移按 name 反推着改回去
        assertThat(jdbc.queryForObject("select side from alloc_rule where id=?", String.class, id)).isEqualTo("西侧");
    }
}
