package com.park.demo3.mapper;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.park.demo3.entity.AllocLossNote;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Param;
import java.util.LinkedHashMap;
import java.util.Map;

public interface AllocLossNoteMapper extends BaseMapper<AllocLossNote> {
    // upsert:业务键(uk_loss_note)命中即改 note(MySQL 原生,免查改两跳;同 BillNoteOverrideMapper 手法)
    @Insert("INSERT INTO alloc_loss_note (ym, head_building_id, note) VALUES (#{ym}, #{headBuildingId}, #{note}) "
          + "ON DUPLICATE KEY UPDATE note = #{note}")
    int upsertNote(@Param("ym") String ym, @Param("headBuildingId") Integer headBuildingId,
                   @Param("note") String note);

    default Map<Integer, String> noteByHead(String ym) {
        Map<Integer, String> out = new LinkedHashMap<>();
        for (AllocLossNote n : selectList(new QueryWrapper<AllocLossNote>().eq("ym", ym)))
            out.put(n.getHeadBuildingId(), n.getNote());
        return out;
    }

    default void deleteNote(String ym, Integer headBuildingId) {
        delete(new QueryWrapper<AllocLossNote>().eq("ym", ym).eq("head_building_id", headBuildingId));
    }
}
