package com.park.demo3.entity;
import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
@Data @TableName("alloc_rule_link")
public class AllocRuleLink {
    @TableId(type = IdType.AUTO) private Integer id;
    private Integer srcRuleId;
    private Integer dstRuleId;
    private String linkType;      // fold_price / fold_qty(POOL-ENGINE-SPEC §2)
    private String acctMonth;     // V131 ''=初始版;'YYYY-MM'=版本组(按 dst 池分组,自该月起前滚)
}
