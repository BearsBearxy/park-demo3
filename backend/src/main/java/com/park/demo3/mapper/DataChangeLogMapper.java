package com.park.demo3.mapper;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.park.demo3.entity.DataChangeLog;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Param;
import java.time.LocalDateTime;
import java.util.Collection;
public interface DataChangeLogMapper extends BaseMapper<DataChangeLog> {
    /** 一条语句落多月(一次写可能影响一整段链尾);months 调用方保证非空。 */
    @Insert("<script>INSERT INTO data_change_log (ym, source, changed_at) VALUES"
          + "<foreach collection='months' item='m' separator=','>(#{m}, #{source}, #{at})</foreach></script>")
    int insertMonths(@Param("months") Collection<String> months, @Param("source") String source,
                     @Param("at") LocalDateTime at);
}
