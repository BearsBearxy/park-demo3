package com.park.demo3.mapper;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.park.demo3.entity.ImportLog;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.*;
@Mapper
public interface ImportLogMapper extends BaseMapper<ImportLog> {
    // 每 data_type 最新一条(数据量小:全量按时间倒序后 Java 端按 type 取首条)
    default List<ImportLog> latestByType() {
        List<ImportLog> all = selectList(new QueryWrapper<ImportLog>().orderByDesc("created_at", "id"));
        Map<String, ImportLog> firstByType = new LinkedHashMap<>();
        for (ImportLog r : all) firstByType.putIfAbsent(r.getDataType(), r);
        return new ArrayList<>(firstByType.values());
    }
    // 近 days 天倒序,截断 limit
    default List<ImportLog> recent(int days, int limit) {
        LocalDateTime since = LocalDateTime.now().minusDays(days);
        return selectList(new QueryWrapper<ImportLog>()
            .ge("created_at", since).orderByDesc("created_at", "id").last("limit " + limit));
    }

    // 导入中心「上次导入」:每类最近一条没被拒的(被拒 = 一行没写进去,不算导过)
    @Select("SELECT l.* FROM import_log l JOIN (SELECT MAX(id) AS id FROM import_log"
          + " WHERE status <> 'rejected' GROUP BY data_type) m ON m.id = l.id")
    List<ImportLog> lastNonRejectedByType();

    // ── 导入中心「这个月有没有」(ImportCoverageService):本月出账不看的那几类各补一条 ──

    /** 这个月有读数的期区(有行就算,同本月出账「已抄 N 块」)。 */
    @Select("SELECT DISTINCT m.zone FROM meter_reading r JOIN meter m ON m.id = r.meter_id WHERE r.ym = #{ym}")
    List<String> meterZonesWithReadings(@Param("ym") String ym);

    @Select("SELECT MAX(read_date) FROM pv_reading")
    LocalDate pvReadingMaxDate();

    @Select("SELECT MAX(read_date) FROM cp_reading")
    LocalDate cpReadingMaxDate();

    /** 所选年各按月表录到几月:k = 导入类 key,v = YYYY-MM(该年一行没有为 NULL)。prefix = 'YYYY-'。
     *  口径同 DataHomeService.scheduleSources:都按记账月 acct_month;附表11 只算 energy + basic。 */
    @Select("""
        SELECT 'pv' AS k, MAX(acct_month) AS v FROM pv_record WHERE acct_month LIKE CONCAT(#{p}, '%')
        UNION ALL SELECT 'charging_7', MAX(acct_month) FROM charging_record WHERE schedule_no = 7 AND acct_month LIKE CONCAT(#{p}, '%')
        UNION ALL SELECT 'charging_8', MAX(acct_month) FROM charging_record WHERE schedule_no = 8 AND acct_month LIKE CONCAT(#{p}, '%')
        UNION ALL SELECT 'elec', MAX(acct_month) FROM elec_record WHERE type IN ('energy', 'basic') AND acct_month LIKE CONCAT(#{p}, '%')
        UNION ALL SELECT 'elecCost', MAX(acct_month) FROM elec_cost_entry WHERE acct_month LIKE CONCAT(#{p}, '%')
        UNION ALL SELECT 'office_13', MAX(acct_month) FROM office_record WHERE schedule_no = 13 AND acct_month LIKE CONCAT(#{p}, '%')
        UNION ALL SELECT 'office_14', MAX(acct_month) FROM office_record WHERE schedule_no = 14 AND acct_month LIKE CONCAT(#{p}, '%')
        """)
    List<Map<String, Object>> monthUpTo(@Param("p") String prefix);

    /** 五张损益附表该年明细行填到几月(m1..m12 非空的最大月;屏上「填入」派生的格子也算,PnlService:47)。 */
    @Select("""
        SELECT schedule, MAX(CASE WHEN m12 IS NOT NULL THEN 12 WHEN m11 IS NOT NULL THEN 11 WHEN m10 IS NOT NULL THEN 10
                                 WHEN m9 IS NOT NULL THEN 9 WHEN m8 IS NOT NULL THEN 8 WHEN m7 IS NOT NULL THEN 7
                                 WHEN m6 IS NOT NULL THEN 6 WHEN m5 IS NOT NULL THEN 5 WHEN m4 IS NOT NULL THEN 4
                                 WHEN m3 IS NOT NULL THEN 3 WHEN m2 IS NOT NULL THEN 2 WHEN m1 IS NOT NULL THEN 1 END) AS mon
          FROM pnl_row WHERE year = #{y} AND kind = 'detail' GROUP BY schedule
        """)
    List<Map<String, Object>> pnlUpTo(@Param("y") int year);

    /** 该年有没有预算数:同一导入会写往年只有实际数的行(importBudget.ts),那种不算。 */
    @Select("SELECT EXISTS(SELECT 1 FROM budget_row WHERE year = #{y} AND amount_budget IS NOT NULL)")
    boolean budgetHasYear(@Param("y") int year);
}
