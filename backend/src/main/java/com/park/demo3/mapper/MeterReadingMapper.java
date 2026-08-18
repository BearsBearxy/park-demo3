package com.park.demo3.mapper;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.park.demo3.entity.MeterReading;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Param;
import java.util.List;
public interface MeterReadingMapper extends BaseMapper<MeterReading> {
    default List<MeterReading> selectByYm(String ym) {
        return selectList(new QueryWrapper<MeterReading>().eq("ym", ym).orderByAsc("meter_id"));
    }
    // 某表逐月历史(抽屉用),ym 升序
    default List<MeterReading> selectByMeter(Integer meterId) {
        return selectList(new QueryWrapper<MeterReading>().eq("meter_id", meterId).orderByAsc("ym"));
    }
    default MeterReading selectByMeterAndYm(Integer meterId, String ym) {
        return selectOne(new QueryWrapper<MeterReading>().eq("meter_id", meterId).eq("ym", ym));
    }
    // 该表读数条数(删表 409 守卫 + 档案列表条数列)
    default long countByMeter(Integer meterId) {
        return selectCount(new QueryWrapper<MeterReading>().eq("meter_id", meterId));
    }
    // 有读数的 distinct 年份升序(年下拉数据驱动)
    default List<Integer> selectDistinctYears() {
        return selectObjs(new QueryWrapper<MeterReading>().select("distinct left(ym,4)"))
            .stream().map(o -> Integer.parseInt(String.valueOf(o))).sorted().toList();
    }
    // 有读数的 distinct 账期升序('YYYY-MM')。前端「最新有数月」原先靠 12→1 逐月试探,
    // 本表最新只到 2024-02 时首载要空打 11 次;这里一次给全集,前端取 max 即可。
    // ym 是零补 CHAR(7),Java 串排序与 SQL ORDER BY 结果一致;走 uk(meter_id,ym) 的松散索引扫描。
    default List<String> selectDistinctYms() {
        return selectObjs(new QueryWrapper<MeterReading>().select("distinct ym"))
            .stream().map(String::valueOf).sorted().toList();
    }

    // 导入攒批 upsert(2026-08-11 审计 P3 纯 I/O 优化):走 uk_meter_reading(meter_id,ym),
    // 一行一条顶掉原先「先 DELETE 再 INSERT」两条单发 —— 整册 1134 行 = 2268 条往返、
    // 云端 1.5ms/条 ≈ 3.4s 全压在同一个事务里。手法同 BillPayCompanyMapper / BillNoteOverrideMapper。
    // ⚠ 语义必须与「先删后插」逐格等价,故 UPDATE 分支**列全覆盖**、包括覆盖成 NULL:
    //    原路径是整行删掉再插新行,任何一列的旧值都留不下来;这里漏写哪一列,重导就会残留上次的值。
    // ⚠ factor_snap 同样必须覆盖。它的「写入时冻结」是指**不随档案改倍率回溯历史**(见 MeterService 头注),
    //    不是「不随重导刷新」—— V79 订正 220605000026 的倍率后,正是靠重导把快照刷新到 40.00 的。
    // created_at/updated_at 不入列:MP 的 @TableField(fill) 在手写 SQL 下不触发,
    //    由 DDL 的 DEFAULT / ON UPDATE CURRENT_TIMESTAMP 兜住(V45__meter.sql:42-43)。
    // 同一批里出现重复 (meter_id, ym):MySQL 对多值 INSERT 逐行处理,后行撞唯一键转 UPDATE,
    //    结果仍是「后行覆盖前行」,与原先逐行 delete+insert 一致。
    @Insert("<script>INSERT INTO meter_reading "
          + "(meter_id, ym, prev_total, curr_total, prev_sharp, prev_peak, prev_flat, prev_valley, "
          + "curr_sharp, curr_peak, curr_flat, curr_valley, factor_snap, note, source) VALUES "
          + "<foreach collection='list' item='r' separator=','>"
          + "(#{r.meterId}, #{r.ym}, #{r.prevTotal}, #{r.currTotal}, #{r.prevSharp}, #{r.prevPeak}, "
          + "#{r.prevFlat}, #{r.prevValley}, #{r.currSharp}, #{r.currPeak}, #{r.currFlat}, "
          + "#{r.currValley}, #{r.factorSnap}, #{r.note}, #{r.source})"
          + "</foreach>"
          + " ON DUPLICATE KEY UPDATE "
          + "prev_total = VALUES(prev_total), curr_total = VALUES(curr_total), "
          + "prev_sharp = VALUES(prev_sharp), prev_peak = VALUES(prev_peak), "
          + "prev_flat = VALUES(prev_flat), prev_valley = VALUES(prev_valley), "
          + "curr_sharp = VALUES(curr_sharp), curr_peak = VALUES(curr_peak), "
          + "curr_flat = VALUES(curr_flat), curr_valley = VALUES(curr_valley), "
          + "factor_snap = VALUES(factor_snap), note = VALUES(note), source = VALUES(source)</script>")
    int upsertBatch(@Param("list") List<MeterReading> list);
}
