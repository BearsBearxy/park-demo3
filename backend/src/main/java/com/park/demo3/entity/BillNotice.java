package com.park.demo3.entity;
import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.math.BigDecimal; import java.time.LocalDateTime;
// 催缴单单头(V89):一户一套账,拆票则一户多单;uk(ym,tenant,pay_company,notice_kind)
@Data @TableName("bill_notice")
public class BillNotice {
    @TableId(type = IdType.AUTO) private Integer id;
    private String ym;
    private Integer tenantId;
    private Integer payCompanyId;      // 收款主体;拆单键,可空
    private String noticeKind;         // combined/fee/maint/dorm/offbook
    private String premiseText;        // 位置原文,多场地逗号连
    private BigDecimal totalAmount;
    private BigDecimal prevDue;        // 上期欠费;催缴闭环接口点,S4 先留 0
    private String status;             // draft/issued/void;issued 不可被重跑覆盖
    private String warn;               // 门禁警告拼接
    private String genBatch;           // 派生批次;重跑幂等键
    private LocalDateTime generatedAt;
}
