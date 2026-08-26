package com.park.demo3.dto;

/** 在场（PRESENCE 设计稿 §03/§04）。 */
public final class PresenceDtos {
    private PresenceDtos() {}

    /**
     * 客户端上报的那一半。
     *
     * ⚠ **身份不在这里。** user / displayName / role 一律由服务端从令牌与权限快照取 ——
     *   让客户端报自己是谁，头像组就成了随便谁都能冒名的地方。
     *   这里只有「我在哪一屏、是看还是改」，那是客户端唯一知道而服务端不知道的事。
     *
     * @param sid  本标签页的会话 id（前端随机生成）。按会话而不是按人 —— 一个人开两个标签页看两个屏是常态
     * @param label 给人看的一句话（「月度台账 · 一泽 2025-06」）。**客户端供给的展示文本**，
     *              服务端不解释它、只截断长度；渲染侧靠 Vue 的默认转义
     */
    public record PingReq(String sid, String scope, String label, String mode, Long lastActivityAt) {}

    /** 在线的一个人。heldMs 之类由服务端算，客户端的钟不可信。 */
    public record SeatDTO(String sid, String user, String displayName, String role,
                          String scope, String label, String mode,
                          long sinceMs, long idleMs, boolean self) {}

    /**
     * ping 的回答。**一条通道四件事** —— 全站唯一的轮询：
     *   users     谁在线、在哪一屏
     *   evicted   你的编辑权被接管了（当面提示）
     *   approvals 等你批的授权请求（顶栏通知的红点靠它）
     *   outcome   你请的那次远程授权批了没有
     *
     * 每加一条通道就多一份「谁跟谁不同步」的可能，所以宁可让这个响应体宽一点。
     */
    public record PingResp(java.util.List<SeatDTO> users, LockDtos.EvictionDTO evicted,
                           java.util.List<ApprovalDtos.PendingDTO> approvals,
                           ApprovalDtos.OutcomeDTO outcome) {}
}
