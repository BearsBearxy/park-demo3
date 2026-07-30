package com.park.demo3.entity;
import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
@Data @TableName("alloc_rule_link")
public class AllocRuleLink {
    @TableId(type = IdType.AUTO) private Integer id;
    private Integer srcRuleId;
    private Integer dstRuleId;
    private String linkType;      // fold_price / fold_qty(POOL-ENGINE-SPEC §2)
}
