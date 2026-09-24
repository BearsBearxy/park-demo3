package com.park.demo3.entity;
import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;

/**
 * 楼栋损耗备注(V127__loss_note.sql):独立于 alloc_loss_result,重算(先删后插)不丢。
 * 键=(ym, head_building_id);清空备注=删行,表里不存空串行。
 * updated_at 由 DB 维护,实体不映射(同 BillNoteOverride)。
 */
@Data @TableName("alloc_loss_note")
public class AllocLossNote {
    @TableId(type = IdType.AUTO) private Integer id;
    private String ym;
    private Integer headBuildingId;
    private String note;
}
