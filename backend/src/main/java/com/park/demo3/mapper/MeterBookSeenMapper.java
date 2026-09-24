package com.park.demo3.mapper;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.park.demo3.entity.MeterBookSeen;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Param;
import java.util.Collection;
public interface MeterBookSeenMapper extends BaseMapper<MeterBookSeen> {
    /** 一批导入一条语句落完(SPEC §10.2 整批一次写入);rows 调用方保证非空。 */
    @Insert("<script>INSERT INTO meter_book_seen (meter_id, ym, batch_id, file_name, seen_at) VALUES"
          + "<foreach collection='rows' item='r' separator=','>(#{r.meterId}, #{r.ym}, #{r.batchId}, #{r.fileName}, #{r.seenAt})</foreach></script>")
    int insertAll(@Param("rows") Collection<MeterBookSeen> rows);
}
