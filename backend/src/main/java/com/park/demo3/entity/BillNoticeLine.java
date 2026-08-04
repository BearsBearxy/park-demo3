package com.park.demo3.entity;
import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.math.BigDecimal;
// 催缴单明细行(V89);price_scope+price_month+rule_branch 构成取价审计链
@Data @TableName("bill_notice_line")
public class BillNoticeLine {
    @TableId(type = IdType.AUTO) private Integer id;
    private Integer noticeId;
    private Integer lineNo;            // uk(notice_id,line_no);场地段→表序→段序稳定排序
    private String feeKey;             // elec/mgmt_fee/capacity/water/water_pipe/share_elec_*/share_green_water
    private String premise;            // 场地段(A座602室)
    private Integer meterId;           // 公摊/容量费行 NULL
    private String meterLabel;         // 「电表①」=sub_name 或顺位补号,不回写档案
    private Integer contractId;        // 出账时表→合同归属快照(resolveBinding 命中)
    private String seg;                // sharp/peak/flat/valley;单一价表 NULL
    private BigDecimal prevRead;
    private BigDecimal currRead;
    private BigDecimal factorSnap;
    private BigDecimal qty;
    private BigDecimal priceSnap;      // 实收单价快照(尖段按峰价时存实收价)
    private String priceKey;
    private String priceScope;
    private String priceMonth;
    private String ruleBranch;         // tou/resident/commercial/tenant_override/pool/fixed
    private Integer poolRuleId;
    private String shareSrc;           // member/area/floor
    private BigDecimal baseSnap;       // 该户份额基数快照(层数/面积/weight)
    private BigDecimal amount;         // 允许负值
    private String note;
}
