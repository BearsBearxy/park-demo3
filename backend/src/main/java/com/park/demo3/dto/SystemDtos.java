package com.park.demo3.dto;
import java.time.LocalDateTime;
import com.park.demo3.dto.AuditRowDTO;
import java.util.List;
import jakarta.validation.constraints.*;

/** 系统管理屏(P1)的全部出入参。集中一个文件,免得为十来个小 record 各开一个文件。 */
public final class SystemDtos {
    private SystemDtos() {}

    // ── 权限点字典(角色矩阵屏渲染用;前端不硬编码) ──
    // group / kind 原样转自 Perm.Meta(v3):角色屏矩阵按模块分行、按「查看 / 编辑」分列
    public record PermMeta(String key, String label, String hint, String group, String kind) {}
    public record NavLayerMeta(String id, String label) {}
    public record PermCatalog(List<PermMeta> perms, List<NavLayerMeta> navLayers) {}

    // ── 角色 ──
    // manageable = 当前操作人能不能改它(系统管理分级,2026-10-04):守卫用的同一个判据算出来,屏上据此置灰
    public record RoleDTO(Integer id, String code, String name, boolean builtin,
                          List<String> navLayers, List<String> perms,
                          long userCount, String remark, boolean manageable) {}

    public record RoleCreateReq(
        @NotBlank @Pattern(regexp = "^[a-z][a-z0-9_]{1,31}$",
            message = "标识只能用小写字母/数字/下划线,字母开头,2-32 位") String code,
        @NotBlank @Size(max = 32) String name,
        List<String> navLayers, List<String> perms,
        @Size(max = 128) String remark) {}

    /** code 建后不可改 —— 代码里可能引用它。 */
    public record RoleUpdateReq(@NotBlank @Size(max = 32) String name,
                                List<String> navLayers, List<String> perms,
                                @Size(max = 128) String remark) {}

    // ── 用户 ──
    public record UserRoleBrief(Integer id, String code, String name) {}
    public record UserDTO(Integer id, String username, String displayName, int status,
                          boolean mustChangePassword, List<UserRoleBrief> roles,
                          LocalDateTime createdAt, boolean manageable) {}

    public record UserCreateReq(
        @NotBlank @Pattern(regexp = "^[A-Za-z0-9_.@-]{3,64}$",
            message = "用户名只能用字母/数字/下划线/点/@/连字符,3-64 位") String username,
        @NotBlank @Size(max = 64) String displayName,
        @NotBlank @Size(min = 8, max = 72, message = "初始密码至少 8 位") String password,
        List<Integer> roleIds) {}

    /** 用户名不可改 —— 它是审计记录里的身份锚点(param_change_log.actor / import_log.operator 存的都是它)。 */
    public record UserUpdateReq(@NotBlank @Size(max = 64) String displayName,
                                List<Integer> roleIds) {}

    public record UserStatusReq(@Min(0) @Max(1) int status) {}

    public record PasswordResetReq(
        @NotBlank @Size(min = 8, max = 72, message = "密码至少 8 位") String password) {}

    // ── 操作日志时间线 ──
    /** tables:这个查看者看得见哪几张表的数据修改记录(ChangeLogService.Tbl#code),给「按表筛」的下拉用。
     *  sources:看得见哪几路(param / import / auth / review / meter / change),来源下拉只列这些 —— 看不见的一路选了只会是 0 条。 */
    public record AuditPageDTO(List<AuditRowDTO> rows, long total, int page, int size,
                               List<String> actors, List<String> tables, List<String> sources) {}

    // ── 本人改密 ──
    public record ChangePasswordReq(
        @NotBlank String currentPassword,
        @NotBlank @Size(min = 8, max = 72, message = "新密码至少 8 位") String newPassword) {}

    /** 改了自己的密码(本人改密 / 在用户管理里给自己重置)之后这台设备接着用的新令牌;重置别人的密码时为 null。 */
    public record PasswordChangedResp(String token) {}
}
