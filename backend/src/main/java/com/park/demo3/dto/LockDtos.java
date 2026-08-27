package com.park.demo3.dto;

/** 编辑锁的传输对象（CONCURRENCY-SPEC §4.4）。 */
public final class LockDtos {
    private LockDtos() {}

    /**
     * 锁被谁占着。
     *
     * heldMs / idleMs **由服务端算**：客户端的钟不可信，而且各算各的会出现
     * 「A 的屏幕说空闲 19 分钟、B 的说 21 分钟」——而这两个数决定接管要不要叫主管。
     */
    public record HolderDTO(String user, String displayName, long heldMs, long idleMs, boolean idle) {}

    /** 占锁/接管的回答。granted=false 时 holder 必非空。 */
    public record LockDTO(boolean granted, HolderDTO holder) {
        public static LockDTO ok() { return new LockDTO(true, null); }
    }

    /** 心跳的回答。evicted 非空 = 你被接管了，当场退回浏览态。 */
    public record HeartbeatDTO(EvictionDTO evicted) {}

    public record EvictionDTO(String scope, String by, String byDisplayName, String authorizerName) {}

    /** 接管请求。空闲态两个字段都可空；活跃态必须都带。 */
    public record TakeoverReq(String authorizer, String password) {}

    /** 心跳请求。lastActivityAt = 前端记的最后一次键鼠时刻（epoch ms）。 */
    public record HeartbeatReq(Long lastActivityAt) {}
}
