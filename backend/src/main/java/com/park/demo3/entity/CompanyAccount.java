package com.park.demo3.entity;
import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;

/**
 * 公司收款账户(V94):一公司多账户,导出通知单的账户块取默认账户。
 * is_default 同公司唯一由 CompanyService 维护(设新默认时清旧),不是 DB 约束。
 * created_at/updated_at 由 DB 维护,实体不映射(同 BillNoteOverride)。
 */
@Data @TableName("company_account")
public class CompanyAccount {
    @TableId(type = IdType.AUTO) private Integer id;
    private Integer companyId;
    private String kind;          // bank/wechat/alipay/personal/other
    private String accountName;
    private String accountNo;
    private String bankName;
    private Integer isDefault;    // tinyint 1/0
    private Integer sortNo;
    private String remark;
}
