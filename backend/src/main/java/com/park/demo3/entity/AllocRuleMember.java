package com.park.demo3.entity;
import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.math.BigDecimal;
@Data @TableName("alloc_rule_member")
public class AllocRuleMember {
    @TableId(type = IdType.AUTO) private Integer id;
    private Integer ruleId;
    private Integer tenantId;
    // floor=层份额(默认1/对半0.5/NULL=层内按面积二拆);area=忽略;direct=单行整笔
    @TableField(updateStrategy = FieldStrategy.ALWAYS) private BigDecimal weight;
    private String acctMonth;   // V69 ''=默认长期行(初始版);'YYYY-MM'=版本组(自该月起前滚,S14)
}
