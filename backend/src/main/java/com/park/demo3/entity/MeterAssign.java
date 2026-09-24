package com.park.demo3.entity;
import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
// 表归属按月分段(METER-TIMELINE-SPEC §1.2,V128):uk(meter_id, from_ym),只记起始月。
// 看某月 = from_ym ≤ 该月的最后一行(MeterTimeline.assignAt)。写只走 MeterTimelineService.writeAssign。
// 可空列一律 ALWAYS:writeAssign 是整行覆盖写,清空要真落 NULL(MP 默认 NOT_NULL 会把 null 从 UPDATE 里剔掉)。
@Data @TableName("meter_assign")
public class MeterAssign {
    @TableId(type = IdType.AUTO) private Long id;
    private Integer meterId;
    private String fromYm;
    @TableField(updateStrategy = FieldStrategy.ALWAYS) private Integer tenantId;
    @TableField(updateStrategy = FieldStrategy.ALWAYS) private String tenantName;
    @TableField(updateStrategy = FieldStrategy.ALWAYS) private Integer buildingId;
    private String ownership;
    @TableField(updateStrategy = FieldStrategy.ALWAYS) private String area;
    @TableField(updateStrategy = FieldStrategy.ALWAYS) private String spot;
    @TableField(updateStrategy = FieldStrategy.ALWAYS) private String floorLabel;
    @TableField(updateStrategy = FieldStrategy.ALWAYS) private String side;
    @TableField(updateStrategy = FieldStrategy.ALWAYS) private String roomNo;
    @TableField(updateStrategy = FieldStrategy.ALWAYS) private String subName;
    @TableField(updateStrategy = FieldStrategy.ALWAYS) private Integer contractId;   // 人工钉的合同,只对这一段有效
    private Integer tenantManual;   // 人工标记只锁这一段(SPEC §3.2 G2)
    private Integer ownerManual;
    private Integer locManual;      // 位掩码同 V78:bit0 楼层 / bit1 方位 / bit2 房号
    private String src;             // import / manual / migrate / contract
    @TableField(updateStrategy = FieldStrategy.ALWAYS) private String batchId;
}
