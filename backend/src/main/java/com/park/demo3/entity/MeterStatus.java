package com.park.demo3.entity;
import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
// 表的存在与状态按月分段(METER-TIMELINE-SPEC §1.3,V128):uk(meter_id, from_ym)。
// active 在用 / retired 停用(在册不计)/ removed 已拆(不在册);早于第一行 = 不在册。
@Data @TableName("meter_status")
public class MeterStatus {
    @TableId(type = IdType.AUTO) private Long id;
    private Integer meterId;
    private String fromYm;
    private String status;
    private String src;
    @TableField(updateStrategy = FieldStrategy.ALWAYS) private String batchId;
}
