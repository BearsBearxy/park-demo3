package com.park.demo3.mapper;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.park.demo3.entity.MeterBookSeen;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Param;
import java.util.Collection;
public interface MeterBookSeenMapper extends BaseMapper<MeterBookSeen> {
    /**
     * 多行一条;调用方(MeterService.importRows)每 500 行调一次 —— 整年一册一条约 1.3MB,超测试库 max_allowed_packet 的 1MB
     * (「两个都按你建议」2026-10-05 提速时量出)。同一个事务,整批照样一起成、一起回滚(SPEC §10.2)。rows 调用方保证非空。
     */
    @Insert("<script>INSERT INTO meter_book_seen (meter_id, ym, batch_id, file_name, seen_at) VALUES"
          + "<foreach collection='rows' item='r' separator=','>(#{r.meterId}, #{r.ym}, #{r.batchId}, #{r.fileName}, #{r.seenAt})</foreach></script>")
    int insertAll(@Param("rows") Collection<MeterBookSeen> rows);
}
