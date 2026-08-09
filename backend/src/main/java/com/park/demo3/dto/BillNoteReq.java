package com.park.demo3.dto;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/**
 * 催缴单备注覆盖 upsert 请求(V92)。键三列可空=空串(无场地/无表/非分时行);
 * note 必填非空——清空恢复引擎备注走 DELETE,不走空串覆盖。
 */
public record BillNoteReq(
    @NotBlank @Pattern(regexp = "\\d{4}-\\d{2}") String ym,
    @NotNull Integer tenantId,
    @NotBlank @Size(max = 32) String feeKey,
    @Size(max = 64) String premiseKey,
    @Size(max = 16) String meterKey,
    @Size(max = 8) String segKey,
    @NotBlank @Size(max = 255) String note
) {}
