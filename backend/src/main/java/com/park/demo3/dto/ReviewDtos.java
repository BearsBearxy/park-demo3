package com.park.demo3.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

import java.time.LocalDateTime;
import java.util.List;

/** 审核机制(SIDEBAR-UX-REDESIGN §7.4)的全部出入参。 */
public final class ReviewDtos {
    private ReviewDtos() {}

    /**
     * 一把审核键的当前态。
     *
     * status 四个取值:entered(**派生态** —— review_state 里没这行) / submitted / approved / returned。
     * blockedBy:通过前置未满足时列出缺的上游人话名(如「计费参数」);满足或本就没有前置时是空 list,
     * **不是 null** —— 前端 R2 直接 length 判,少一个 null 分支。
     */
    public record ReviewRowDTO(String key, String kind, String scope, String status,
                               String submittedBy, LocalDateTime submittedAt,
                               String reviewedBy, LocalDateTime reviewedAt,
                               String reason, List<String> blockedBy) {}

    /** 退回 / 撤销的理由,必填(§7.4:空则 400)。 */
    public record ReasonReq(
        @NotBlank(message = "必须写明理由") @Size(max = 255) String reason) {}
}
