package com.park.demo3.entity;
import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
@Data @TableName("alloc_rule_meter")
public class AllocRuleMeter {
    @TableId(type = IdType.AUTO) private Integer id;
    private Integer ruleId;
    private Integer meterId;
}
