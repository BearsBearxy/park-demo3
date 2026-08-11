package com.park.demo3.dto;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Pattern;
import java.util.List;

// 催缴单交付状态流转(S20 §1.3)的请求与两个结果封装。
public final class BillDeliveryDTO {
    private BillDeliveryDTO() {}

    /** 户级批量流转请求:该月这些租户的全部单 */
    public record Req(@Pattern(regexp = "\\d{4}-\\d{2}") String ym,
                      @NotEmpty List<Integer> tenantIds) {}

    /** confirm 结果:confirmed=draft→confirmed 的单数;skipped=非 draft(已确认/已导出/已作废)未动的单数 */
    public record Confirm(int confirmed, int skipped) {}

    /** markExported 结果:marked=落 exported 的单数(已作废单不计) */
    public record Export(int marked) {}
}
