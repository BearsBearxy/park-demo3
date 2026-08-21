package com.park.demo3.mapper;

import com.park.demo3.dto.AuditRowDTO;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import java.util.List;

/**
 * 操作日志时间线:三张来源表 union 后按时间倒序（RBAC-SPEC §7.2）。
 *
 * **分页与筛选都在 SQL 里做**,不是捞进内存再切。param_change_log 随每次改参数增长,
 * 全捞正是 QueryHygieneTest 防的那种「返回行数只涨不跌」。
 * 时间范围与 actor 下推到每个分支(两张表都有 (actor, ts) / (ts) 索引),
 * source 筛选直接跳过整个分支。
 *
 * ⚠ 两条写这段 SQL 时踩过的坑，都被 AuditLogApiIT 抓到了:
 *
 *  1. **每个分支都要写全列别名。** UNION 的结果列名取自**第一个** SELECT ——
 *     只在 param 分支写别名的话，src=import 单独跑时外层 ORDER BY u.ts 直接
 *     「Unknown column」500。别名不是可选的美观问题。
 *
 *  2. **ORDER BY 必须是全序。** 只按 (ts, source) 排不够:种子日志是批量插的，
 *     一秒里几十行,MySQL 对并列行的顺序不保证 —— LIMIT/OFFSET 翻页时同一行
 *     可能在两页都出现、另一行谁也没见着。所以带上来源表的 id 做末位键。
 */
public interface AuditQueryMapper {

    String BRANCHES = """
        <if test="src == null or src == 'param'">
          SELECT 'param' AS source, id AS rid, ts AS ts, actor AS actor,
                 action AS action,
                 CONCAT(scope, IF(cfg_key='', '', CONCAT(' · ', cfg_key)),
                        IF(acct_month='', '', CONCAT(' · ', acct_month))) AS target,
                 CONCAT(IFNULL(CONCAT(old_value, ' → '), ''), IFNULL(new_value, ''),
                        IFNULL(CONCAT('  ', note), '')) AS detail,
                 NULL AS authorizer
          FROM param_change_log
          <where>
            <if test="actor != null and actor != ''">actor = #{actor}</if>
            <if test="from != null">AND ts &gt;= #{from}</if>
            <if test="to != null">AND ts &lt; #{to}</if>
          </where>
        </if>
        <if test="src == null">UNION ALL</if>
        <if test="src == null or src == 'import'">
          SELECT 'import' AS source, id AS rid, created_at AS ts, operator AS actor,
                 status AS action,
                 CONCAT(type_label, IFNULL(CONCAT(' · ', target), '')) AS target,
                 CONCAT(file_name, '  ', ok, '/', `rows`, ' 行',
                        IF(warn &gt; 0, CONCAT(' · ', warn, ' 警告'), '')) AS detail,
                 NULL AS authorizer
          FROM import_log
          <where>
            <if test="actor != null and actor != ''">operator = #{actor}</if>
            <if test="from != null">AND created_at &gt;= #{from}</if>
            <if test="to != null">AND created_at &lt; #{to}</if>
          </where>
        </if>
        <if test="src == null">UNION ALL</if>
        <if test="src == null or src == 'auth'">
          SELECT 'auth' AS source, id AS rid, ts AS ts, actor AS actor, action AS action,
                 target AS target, detail AS detail, authorizer AS authorizer
          FROM auth_audit_log
          <where>
            <if test="actor != null and actor != ''">actor = #{actor}</if>
            <if test="from != null">AND ts &gt;= #{from}</if>
            <if test="to != null">AND ts &lt; #{to}</if>
          </where>
        </if>
        """;

    /** 末位键 rid 让排序成为全序 —— 见类注释第 2 条，没有它翻页会重复/漏行。 */
    @Select("<script>SELECT source, ts, actor, action, target, detail, authorizer FROM (" + BRANCHES
          + ") u ORDER BY u.ts DESC, u.source, u.rid DESC LIMIT #{size} OFFSET #{offset}</script>")
    List<AuditRowDTO> page(@Param("src") String src, @Param("actor") String actor,
                           @Param("from") java.time.LocalDateTime from, @Param("to") java.time.LocalDateTime to,
                           @Param("size") int size, @Param("offset") int offset);

    @Select("<script>SELECT COUNT(*) FROM (" + BRANCHES + ") u</script>")
    long count(@Param("src") String src, @Param("actor") String actor,
               @Param("from") java.time.LocalDateTime from, @Param("to") java.time.LocalDateTime to);

    /** 筛选下拉用:出现过的操作人（三表并集，去重）。 */
    @Select("""
        SELECT DISTINCT a FROM (
          SELECT actor a FROM param_change_log
          UNION SELECT operator FROM import_log
          UNION SELECT actor FROM auth_audit_log
        ) x WHERE a IS NOT NULL AND a <> '' ORDER BY a
        """)
    List<String> actors();
}
