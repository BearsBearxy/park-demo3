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

// V132(催缴单月份改为收费月,2026-09-28)迁移本身的行为验证 —— 照 ReviewMigrationIT 的形状,
// 把 db/migration/V132__bill_notice_month_shift.sql 从 classpath 原样重放,验的是那个文件。
// V132 全是 DML(没有 DDL 的隐式提交),类上的 @Transactional 回滚得掉;populator 走 DataSourceUtils,
// 用的就是本事务那条连接。重放会把库里所有单挪一个月,回滚后原样。独占 2077 年。
@org.springframework.transaction.annotation.Transactional
class BillNoticeMonthShiftMigrationIT extends AbstractMysqlIT {

    @Autowired JdbcTemplate jdbc;

    private void applyMigration() {
        ResourceDatabasePopulator populator = new ResourceDatabasePopulator(
                new ClassPathResource("db/migration/V132__bill_notice_month_shift.sql"));
        populator.setSqlScriptEncoding("UTF-8");
        populator.execute(jdbc.getDataSource());
    }

    private int tenant() {
        jdbc.update("INSERT INTO tenant(company_name, business_type) VALUES('IT月份迁移户', 'factory')");
        return jdbc.queryForObject("SELECT MAX(id) FROM tenant", Integer.class);
    }

    @Test
    void v132_shiftsNoticesUtilityNotesAndReviewKeysByOneMonth_rentNotesStay() {
        int t = tenant();
        // 同一户相邻两个月:逐行挪时 2077-03 → 2077-04 会先撞上还没挪走的 2077-04,靠 ORDER BY ym DESC 避开
        for (String[] n : List.of(new String[]{"2077-03", "draft"}, new String[]{"2077-04", "exported"}))
            jdbc.update("INSERT INTO bill_notice(ym, tenant_id, notice_kind, total_amount, prev_due, status, generated_at) "
                    + "VALUES(?, ?, 'combined', 0, 0, ?, NOW())", n[0], t, n[1]);
        jdbc.update("INSERT INTO bill_note_override(ym, tenant_id, fee_key, premise_key, meter_key, seg_key, note) "
                + "VALUES('2077-03', ?, 'elec', '', '11', '', 'IT电费备注')", t);
        jdbc.update("INSERT INTO bill_note_override(ym, tenant_id, fee_key, premise_key, meter_key, seg_key, note) "
                + "VALUES('2077-03', ?, 'rent_factory', 'A座101', '', '', 'IT租金备注')", t);
        jdbc.update("INSERT INTO review_state(review_key, kind, period, status) VALUES('bill-notices:2077-04', 'bill-notices', '2077-04', 'approved')");
        jdbc.update("INSERT INTO review_state(review_key, kind, period, status) VALUES('alloc:2077-04', 'alloc', '2077-04', 'approved')");
        jdbc.update("INSERT INTO review_log(review_key, action, actor) VALUES('bill-notices:2077-04', 'approve', 'IT')");

        applyMigration();

        assertThat(jdbc.queryForList("SELECT ym, status FROM bill_notice WHERE tenant_id = ? ORDER BY ym", t))
            .containsExactly(Map.of("ym", "2077-04", "status", "draft"), Map.of("ym", "2077-05", "status", "exported"));
        // 水电行的备注跟着单挪;租金行的备注留在原月 —— N 月的单仍收 N 月租金
        assertThat(jdbc.queryForList("SELECT fee_key, ym FROM bill_note_override WHERE tenant_id = ? ORDER BY fee_key", t))
            .containsExactly(Map.of("fee_key", "elec", "ym", "2077-04"), Map.of("fee_key", "rent_factory", "ym", "2077-03"));
        // 键和 period 同挪一个月(破坏验证:把 review_state 那条 SET 的两项换回先改 period → 键成 2077-06,本行红)
        assertThat(jdbc.queryForList("SELECT review_key, period FROM review_state WHERE period LIKE '2077-%' ORDER BY review_key"))
            .containsExactly(Map.of("review_key", "alloc:2077-04", "period", "2077-04"),
                             Map.of("review_key", "bill-notices:2077-05", "period", "2077-05"));
        assertThat(jdbc.queryForList("SELECT review_key FROM review_log WHERE actor = 'IT' AND review_key LIKE '%2077-%'", String.class))
            .containsExactly("bill-notices:2077-05");
    }
}
