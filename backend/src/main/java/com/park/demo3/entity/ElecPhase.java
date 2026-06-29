package com.park.demo3.entity;
import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
@Data @TableName("elec_phase")
public class ElecPhase {
    @TableId(type = IdType.INPUT) private String id;   // p1 / p2 / p3(指定主键)
    private String name;
    @TableField("`short`") private String shortName;
    private Integer sortNo;
}
