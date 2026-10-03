package com.park.demo3.dto;

import java.time.LocalDateTime;

/** 铃铛「有结果了」与系统类「看过」(PAGE-BEHAVIOR-SPEC §5.1 / §5.3)。 */
public final class NoticeDtos {
    private NoticeDtos() {}

    /**
     * 一条消息。actorName 是造成它的人的显示名(系统到期回调为 null),
     * 面板第二行「李审：理由 · 时刻」要它;seen=false 的行挂小蓝点。
     */
    public record NoticeDTO(long id, String kind, String title, String detail, String ref,
                            String actor, String actorName, LocalDateTime createdAt, boolean seen) {}

    /** 系统类看过。读:都可能为 null(从没记过);写:传 null 的那一项保持原值。 */
    public record SystemSeenDTO(@jakarta.validation.constraints.Size(max = 32) String changelogVersion,
                                @jakarta.validation.constraints.Size(max = 128) String bellKey) {}
}
