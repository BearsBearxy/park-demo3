package com.park.demo3.mapper;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.park.demo3.entity.MeterStatus;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Options;
import org.apache.ibatis.annotations.Param;
import java.util.List;
public interface MeterStatusMapper extends BaseMapper<MeterStatus> {
    /** 整册导入攒批写(MeterTimelineService.Batch):多行一条,按 rows 顺序回填自增 id;rows 调用方保证非空。 */
    @Insert("<script>INSERT INTO meter_status (meter_id, from_ym, status, src, batch_id) VALUES"
          + "<foreach collection='rows' item='r' separator=','>(#{r.meterId}, #{r.fromYm}, #{r.status}, #{r.src}, #{r.batchId})</foreach></script>")
    @Options(useGeneratedKeys = true, keyProperty = "rows.id", keyColumn = "id")
    int insertAll(@Param("rows") List<MeterStatus> rows);
}
