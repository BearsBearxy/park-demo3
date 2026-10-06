package com.park.demo3.mapper;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.park.demo3.entity.ValueChangeLog;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Param;
import java.util.List;
public interface ValueChangeLogMapper extends BaseMapper<ValueChangeLog> {
    /** 一次存一整批(一次保存改了几百格时不逐行往返);调用方按 500 一批切。 */
    @Insert("<script>INSERT INTO value_change_log (at, actor, authorizer, tbl, row_ref, field, old_val, new_val, note) VALUES "
          + "<foreach collection='list' item='r' separator=','>"
          + "(#{r.at}, #{r.actor}, #{r.authorizer}, #{r.tbl}, #{r.rowRef}, #{r.field}, #{r.oldVal}, #{r.newVal}, #{r.note})"
          + "</foreach></script>")
    int insertBatch(@Param("list") List<ValueChangeLog> list);
}
