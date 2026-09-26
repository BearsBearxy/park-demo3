package com.park.demo3.entity;
import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
// V131 公摊池版本组登记:part=meter(绑定表,按池)/link(入向折入链,按 dst 池);主键三列,无自增 id。
// 取版本时的候选月 = 行表的 acct_month ∪ 这里的 acct_month —— 空组(一行都没有)只能靠这里存在。
@Data @TableName("alloc_rule_version")
public class AllocRuleVersion {
    private Integer ruleId;
    private String part;
    private String acctMonth;
}
