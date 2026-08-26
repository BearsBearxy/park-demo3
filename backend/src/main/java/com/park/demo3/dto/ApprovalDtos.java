package com.park.demo3.dto;

import java.util.List;

/** 远程授权（设计稿 §07）。 */
public final class ApprovalDtos {
    private ApprovalDtos() {}

    /**
     * 能批这几个权限点的同事。
     *
     * ⚠ 这是个**信息泄露口**：任何已登录账号都能拿它枚举「谁是主管」。
     *   所以只返回**请求的那几个权限点**的持有者，不返回全量用户表、不带任何联系方式。
     *   内部系统、几十个账号、组织架构本来也不是秘密 —— 接受，但不要放宽。
     */
    public record AuthorizerDTO(String username, String displayName, String role,
                                boolean online, long idleMs) {}

    /** 发起请求。上下文三行是**硬要求** —— 没有它主管就是在闭眼点同意。 */
    public record RequestReq(List<String> perms, String approver,
                             String page, String action, String impact) {}

    /** 待批的一条（给授权人看）。 */
    public record PendingDTO(String id, String requester, String requesterName, String requesterRole,
                             List<String> perms, List<String> permLabels,
                             String page, String action, String impact,
                             long leftMs) {}

    /** 批准/拒绝。批准要带**授权人自己的密码** —— 在他自己的电脑上输。 */
    public record DecideReq(boolean approve, String password) {}

    /** 请求的结果（回给请求者，顺着在场那条 ping）。 */
    public record OutcomeDTO(String id, boolean approved, String approverName) {}
}
