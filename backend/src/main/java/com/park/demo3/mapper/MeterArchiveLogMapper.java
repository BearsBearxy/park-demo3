package com.park.demo3.mapper;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.park.demo3.entity.MeterArchiveLog;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Param;
import java.util.List;
public interface MeterArchiveLogMapper extends BaseMapper<MeterArchiveLog> {
    /** 整册导入攒批写(MeterTimelineService.Batch):多行一条,按 rows 顺序;rows 调用方保证非空。 */
    @Insert("<script>INSERT INTO meter_archive_log (meter_id, tbl, from_ym, action, before_json, after_json, src, batch_id,"
          + " file_name, row_ref, operator, at) VALUES"
          + "<foreach collection='rows' item='r' separator=','>(#{r.meterId}, #{r.tbl}, #{r.fromYm}, #{r.action}, #{r.beforeJson},"
          + " #{r.afterJson}, #{r.src}, #{r.batchId}, #{r.fileName}, #{r.rowRef}, #{r.operator}, #{r.at})</foreach></script>")
    int insertAll(@Param("rows") List<MeterArchiveLog> rows);
}
