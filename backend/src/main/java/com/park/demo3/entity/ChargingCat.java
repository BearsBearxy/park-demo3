package com.park.demo3.entity;
import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
@Data @TableName("charging_cat")
public class ChargingCat {
    private Integer scheduleNo;   // 7 / 8;与 catId 组成复合主键(MyBatis-Plus 无原生复合主键,查询用 QueryWrapper)
    private String catId;         // dc/ac/shed/smart
    private String name;
    @TableField("`short`") private String shortName;
    private String tint;          // slate/blue/cyan
    private Integer sortNo;
}
