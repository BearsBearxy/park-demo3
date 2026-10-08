package com.park.demo3.service;

import com.park.demo3.entity.ValueChangeLog;
import com.park.demo3.mapper.ValueChangeLogMapper;
import com.park.demo3.security.ElevationStore;
import com.park.demo3.security.Perm;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.function.Function;

/**
 * 数据修改记录(V138,用户 2026-10-05 拍板「2按你建议，3，4一起做」第 4 条):台账、抄表读数、工资、三大报表、
 * 损益附表、经营分析目标与阈值 —— 每一次**手改**记谁、什么时候、哪张表哪一行哪一格、改前、改后。
 * 导入不逐格记(import_log 已经记了谁、何时、哪个文件、多少行)。
 *
 * 用法:保存前读出旧值,保存时把每一格(行, 列, 旧, 新)交给 {@link #record} —— 没变的格这里自己跳过
 * (数值按显示比,1.0 和 1.00 算没变),调用方不用先比一遍。整批动作(删整个公司、清本期导入)用 {@link #summary} 记一行。
 *
 * ⚠ **写在调用方的事务里,写不进去就让保存一起失败。** 和 AuditLogService 反着来:那边是旁路、吞错;
 *   这里是钱的旧值唯一的去处 —— 数改了旧值却没留下,正是用户要堵的洞。保存被拒(锁账、校验)回滚时,记录跟着回滚。
 * ⚠ 只传表格里的数和人看得懂的定位,不传口令、令牌 —— 有「系统管理 · 查看」的人翻得到这张表。
 * ⚠ row_ref / field 传**人话**(「一号公司 · 2025-06 · 张三」「厂房租金」):屏上原样显示,前端没有各表的列名字典。
 */
@Service
public class ChangeLogService {

    /**
     * 记哪张表,以及谁能看它的记录:跟那张表本身所在屏的查看走(用户拍板:看得到操作日志不等于看得到工资)。
     * viewPerms 任一即可(RBAC-SPEC §15.6);report_amount、pnl_row 一张表管好几屏,再按行定位过滤({@link #REF_PREFIX_VIEW})。
     * 判定在 SystemService.auditLogs,下推进 SQL。顺序 = 操作日志筛选下拉里的顺序。
     */
    public enum Tbl {
        LEDGER("monthly_ledger", List.of("ledger:view")),
        METER_READING("meter_reading", List.of(Perm.METERS_VIEW)),
        SALARY("salary_record", List.of("salary:view")),
        REPORT("report_amount", List.of("income-statement:view", "balance-sheet:view", "trial-balance:view")),
        PNL("pnl_row", List.of("rent-pnl:view", "elec-pnl:view", "water-pnl:view", "ops-pnl:view", "expense-pnl:view")),
        // 20 个分析屏都看得到这份设置
        ANALYSIS_SETTING("analysis_setting", Perm.SCREENS.stream().filter(x -> "analysis".equals(x.layer()))
            .map(x -> x.value() + ":view").toList());

        public final String code;
        public final List<String> viewPerms;
        Tbl(String code, List<String> viewPerms) { this.code = code; this.viewPerms = viewPerms; }
    }

    /**
     * report_amount / pnl_row 的行按行定位前缀分屏:「利润表 · 」开头的要利润表查看……「附表1 」开头的要附表1 查看。
     * 行定位由 ReportService / PnlService 写(报表名 · 公司 · 年月 · 行;附表名 · 年 · 行),删公司那条摘要也按报表分条写(CompanyService)。
     */
    public static final Map<String, String> REF_PREFIX_VIEW = new LinkedHashMap<>();
    static {
        REF_PREFIX_VIEW.put("利润表 · ", "income-statement:view");
        REF_PREFIX_VIEW.put("资产负债表 · ", "balance-sheet:view");
        REF_PREFIX_VIEW.put("科目余额表 · ", "trial-balance:view");
        REF_PREFIX_VIEW.put("附表1 ", "rent-pnl:view");
        REF_PREFIX_VIEW.put("附表2 ", "elec-pnl:view");
        REF_PREFIX_VIEW.put("附表3 ", "water-pnl:view");
        REF_PREFIX_VIEW.put("附表4 ", "ops-pnl:view");
        REF_PREFIX_VIEW.put("附表5 ", "expense-pnl:view");
    }

    /** 一格:行定位、列名、改前、改后。before = null 是新加的格,after = null 是删掉的格。值可以是数值或文字。 */
    public record Cell(String rowRef, String field, Object before, Object after) {}

    /** 一列:屏上的列名 + 从一行里取值。 */
    public record Col<T>(String label, Function<T, ?> get) {}

    /**
     * 一行写前写后逐列比,每列一格加进 out(没变的格由 {@link #record} 跳过)。
     * before = null 是新加的行、after = null 是删掉的行:这两种情况下值为 0 的格不算 ——
     * 台账、工资的钱列默认就是 0,那是没录过数,不是「改成了 0」,记下来满屏「— → 0」。
     * ponytail: 抄表读数为 0 的格新增 / 删除时也一并不记(新表底数 0),要记再按表加开关。
     */
    public static <T> void diff(List<Cell> out, String rowRef, List<Col<T>> cols, T before, T after) {
        boolean whole = before == null || after == null;
        for (Col<T> c : cols) {
            Object o = before == null ? null : c.get().apply(before);
            Object n = after == null ? null : c.get().apply(after);
            if (whole && isZero(o)) o = null;
            if (whole && isZero(n)) n = null;
            out.add(new Cell(rowRef, c.label(), o, n));
        }
    }

    private static boolean isZero(Object v) {
        return v instanceof BigDecimal b ? b.signum() == 0 : v instanceof Integer i && i == 0;
    }

    private static final int BATCH = 500;
    private final ValueChangeLogMapper logs;
    public ChangeLogService(ValueChangeLogMapper logs) { this.logs = logs; }

    public void record(Tbl tbl, String rowRef, String field, Object before, Object after) {
        record(tbl, List.of(new Cell(rowRef, field, before, after)), null);
    }

    /** 逐格记;改前改后显示成一样的格跳过,一格都没变就什么都不写。note 记在这一批的每一行上(如「复制上月」)。 */
    public void record(Tbl tbl, List<Cell> cells, String note) {
        LocalDateTime now = LocalDateTime.now();
        String actor = AuditLogService.actor();
        List<ValueChangeLog> rows = new ArrayList<>();
        for (Cell c : cells) {
            String o = show(c.before()), n = show(c.after());
            if (!Objects.equals(o, n)) rows.add(row(now, actor, tbl, c.rowRef(), c.field(), o, n, note));
        }
        insert(rows);
    }

    /** 整行 / 整批的动作记一行摘要,不逐格(删整个公司的台账、清本期导入的工资……)。 */
    public void summary(Tbl tbl, String rowRef, String note) {
        insert(List.of(row(LocalDateTime.now(), AuditLogService.actor(), tbl, rowRef, "", null, null, note)));
    }

    /** 屏上怎么显示就怎么存:数值去掉尾零(1200.00 → 1200,0.50 → 0.5)。 */
    static String show(Object v) {
        if (v == null) return null;
        if (v instanceof BigDecimal b) return b.stripTrailingZeros().toPlainString();
        if (v instanceof Double || v instanceof Float) return show(new BigDecimal(v.toString()));
        return v.toString();
    }

    private static ValueChangeLog row(LocalDateTime at, String actor, Tbl tbl, String rowRef, String field,
                                      String oldVal, String newVal, String note) {
        ValueChangeLog l = new ValueChangeLog();
        l.setAt(at);
        l.setActor(cut(actor, 64));
        // 借了别人的编辑权做的改动记上授权人(V139),同 AuditLogService:屏上那一行写「由 X 授权」
        l.setAuthorizer(ElevationStore.currentAuthorizer());
        l.setTbl(tbl.code);
        // 截到列宽(V138),截了带「…」:不截的话超长的一格让整次保存失败(本类不吞错)
        l.setRowRef(cut(rowRef == null ? "" : rowRef, 255));
        l.setField(cut(field == null ? "" : field, 64));
        l.setOldVal(cut(oldVal, 255));
        l.setNewVal(cut(newVal, 255));
        l.setNote(cut(note, 255));
        return l;
    }

    private void insert(List<ValueChangeLog> rows) {
        for (int i = 0; i < rows.size(); i += BATCH) logs.insertBatch(rows.subList(i, Math.min(rows.size(), i + BATCH)));
    }

    private static String cut(String s, int max) {
        return s == null || s.length() <= max ? s : s.substring(0, max - 1) + "…";
    }
}
