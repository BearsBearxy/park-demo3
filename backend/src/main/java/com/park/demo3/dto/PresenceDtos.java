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
    /** mode 是旧页签(发布前已打开的 SPA)还在发的旧字段 —— 只喂给垫层,新客户端不发。 */
    public record PingReq(String sid, String scope, String label, Long lastActivityAt,
                          java.util.List<String> editScopes, String mode) {}

    /** 在线的一个人。heldMs 之类由服务端算，客户端的钟不可信。editScopes = 这个会话握着的全部锁。 */
    public record SeatDTO(String sid, String user, String displayName, String role,
                          String scope, String label, String mode, java.util.List<String> editScopes,
                          long sinceMs, long idleMs, boolean self) {}

    /**
     * ping 的回答。**一条通道六件事** —— 全站唯一的轮询：
     *   users          谁在线、在哪一屏
     *   evicted        你的编辑权被接管了（当面提示）
     *   approvals      等你批的授权请求（顶栏通知的红点靠它）
     *   outcome        你请的那次远程授权批了没有
     *   pendingReviews 等你审的键有几把（SIDEBAR-UX-REDESIGN §7.4；没有 review:approve 的人恒 0）
     *   myReturned     你交的表被退回了几张（R2；**不看权限**，谁都可能被退回）
     *
     * 两个计数都**只发个数不发清单**：ping 是 3 秒一拍（前端 PING_MS = 3_000，
     * 上面那句「20 秒」是旧文案），发清单等于每 3 秒把全月审核态推一遍。要清单去 GET /api/review。
     *
     * myReturned 自清：重新交审时 submit() 把 status 翻回 submitted，这个数自己掉下去，
     * 不需要「已读位」。**撤销没有对应的字段，也做不到** —— withdraw 是删行，
     * submitted_by 随行没了（见 ReviewService.returnedCount 的头注与 spec §12）。
     *
     * 每加一条通道就多一份「谁跟谁不同步」的可能，所以宁可让这个响应体宽一点。
     */
    /** evicted 是给旧页签的兼容投递(它们只读这个单数字段)—— 取 evictions 的第一条。 */
    public record PingResp(java.util.List<SeatDTO> users,
                           java.util.List<LockDtos.EvictionDTO> evictions,
                           LockDtos.EvictionDTO evicted,
                           java.util.List<ApprovalDtos.PendingDTO> approvals,
                           ApprovalDtos.OutcomeDTO outcome,
                           int pendingReviews,
                           /** 我交的表被退回了几张(R2)。人人都可能被退回,所以不看权限,恒发。 */
                           int myReturned) {}
}
