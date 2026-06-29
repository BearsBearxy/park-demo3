package com.park.demo3.entity;
import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.math.BigDecimal;
@Data @TableName("pv_phase")
public class PvPhase {
    @TableId(type = IdType.INPUT) private String id;   // p1 / p2 / p3(指定主键)
    private String name;
    @TableField("`short`") private String shortName;
    private String online;
    private BigDecimal cost;       // 供 P3,本页不显
    private BigDecimal capacity;   // 供 P3
    private String capNote;
    private Integer sortNo;
}
