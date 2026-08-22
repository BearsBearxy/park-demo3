package com.park.demo3.entity;
import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.math.BigDecimal; import java.time.LocalDateTime;
// 计费参数变更日志(S21-PARAM-CENTER-SPEC §2.1):who/when/表/scope/key/月/mode/旧值/新值/动作。
// ts 用 DB 默认 CURRENT_TIMESTAMP(不走 MetaObjectHandler fill);tbl=price|alloc;action=set|delete|recalc|migrate。
@Data @TableName("param_change_log")
public class ParamChangeLog {
    @TableId(type = IdType.AUTO) private Long id;
    private LocalDateTime ts;
    private String actor;
    private String authorizer;   // 提权授权人；NULL = 本人有权
    private String tbl;
    private String scope;
    private String cfgKey;
    private String acctMonth;
    private String mode;
    private BigDecimal oldValue;
    private BigDecimal newValue;
    private String note;
    private String action;
    private String ym;            // recalc 动作的账期
}
