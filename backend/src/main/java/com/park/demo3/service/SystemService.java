package com.park.demo3.service;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.park.demo3.security.NoReviewGuard;
import com.park.demo3.common.BizException;
import com.park.demo3.common.ResultCode;
import com.park.demo3.dto.AuditRowDTO;
import com.park.demo3.dto.SystemDtos.*;
import com.park.demo3.entity.*;
import com.park.demo3.mapper.*;
import java.time.LocalDate;
import java.time.LocalDateTime;
import com.park.demo3.security.Perm;
import com.park.demo3.security.UserPermissionCache;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.*;
import java.util.stream.Collectors;

/**
 * 用户与角色管理（RBAC-SPEC P1）。
 *
 * ⚠ **每一个写方法收尾都必须 {@link UserPermissionCache#reload()}**。
 *    缓存是授权判定的唯一来源：不刷新的话，新建的账号登得进但任何请求都 401（缓存里没它），
 *    改了角色的人还揣着旧权限直到下次重启。这条已在 dev 上实测确认过。
 *
 * ⚠ **自锁防护**（{@code guardSelf*}）：管理员改自己会把自己关在门外，而这个系统里
 *    没有第二条进门的路 —— 只能去数据库里手改。所以宁可挡住，也不能让它发生。
 */
@Service
public class SystemService {

    private final AuthUserMapper users;
    private final AuthRoleMapper roles;
    private final AuthRolePermMapper rolePerms;
    private final AuthUserRoleMapper userRoles;
    private final PasswordEncoder enc;
    private final UserPermissionCache cache;
    private final AuditLogService audit;
    private final AuditQueryMapper auditQuery;

    public SystemService(AuthUserMapper users, AuthRoleMapper roles, AuthRolePermMapper rolePerms,
                         AuthUserRoleMapper userRoles, PasswordEncoder enc,
                         UserPermissionCache cache, AuditLogService audit, AuditQueryMapper auditQuery) {
        this.users = users; this.roles = roles; this.rolePerms = rolePerms;
        this.userRoles = userRoles; this.enc = enc; this.cache = cache;
        this.audit = audit; this.auditQuery = auditQuery;
    }

    // ══════════ 操作日志时间线（RBAC-SPEC §7.2） ══════════

    /**
     * 三张来源表 union 后按时间倒序。**分页在 SQL 里做** —— param_change_log 随每次
     * 改参数增长，全捞进内存再切正是 QueryHygieneTest 防的那种「返回行数只涨不跌」。
     *
     * @param src  param / import / auth / review，null=全部
     * @param to   传日期时按「当天含全天」处理（前端给的是 2026-08-22，用户的意思是含这一天）
     */
    public AuditPageDTO auditLogs(String src, String actor, LocalDate from, LocalDate to,
                                  int page, int size) {
        String s = (src == null || src.isBlank()) ? null : src.trim();
        if (s != null && !List.of("param", "import", "auth", "review").contains(s))
            throw new BizException(ResultCode.BAD_REQUEST, "未知的日志来源：" + s);
        String a = (actor == null || actor.isBlank()) ? null : actor.trim();
        LocalDateTime f = from == null ? null : from.atStartOfDay();
        LocalDateTime t = to == null ? null : to.plusDays(1).atStartOfDay();   // 含结束当天

        int p = Math.max(1, page);
        int sz = Math.min(200, Math.max(1, size));
        long total = auditQuery.count(s, a, f, t);
        List<AuditRowDTO> rows = auditQuery.page(s, a, f, t, sz, (p - 1) * sz);
        return new AuditPageDTO(rows, total, p, sz, auditQuery.actors());
    }

    // ══════════ 字典 ══════════

    public PermCatalog catalog() {
        return new PermCatalog(
            Perm.META.stream().map(m -> new PermMeta(m.key(), m.label(), m.hint())).toList(),
            List.of(new NavLayerMeta("data", "数据中心"),
                    new NavLayerMeta("reports", "账簿与报表"),
                    new NavLayerMeta("analysis", "经营分析")));
    }

    // ══════════ 角色 ══════════

    public List<RoleDTO> listRoles() {
        Map<Integer, List<String>> permsByRole = rolePerms.selectList(null).stream()
            .collect(Collectors.groupingBy(AuthRolePerm::getRoleId,
                     Collectors.mapping(AuthRolePerm::getPerm, Collectors.toList())));
        Map<Integer, Long> countByRole = userRoles.selectList(null).stream()
            .collect(Collectors.groupingBy(AuthUserRole::getRoleId, Collectors.counting()));
        return roles.selectList(Wrappers.<AuthRole>lambdaQuery().orderByAsc(AuthRole::getId))
            .stream().map(r -> toDto(r, permsByRole, countByRole)).toList();
    }

    private RoleDTO toDto(AuthRole r, Map<Integer, List<String>> permsByRole, Map<Integer, Long> countByRole) {
        List<String> ps = new ArrayList<>(permsByRole.getOrDefault(r.getId(), List.of()));
        // 按 Perm.ALL 的顺序回，前端矩阵才不会每次刷新跳来跳去
        ps.sort(Comparator.comparingInt(Perm.ALL::indexOf));
        return new RoleDTO(r.getId(), r.getCode(), r.getName(), r.getBuiltin() != null && r.getBuiltin() == 1,
            splitLayers(r.getNavLayers()), ps, countByRole.getOrDefault(r.getId(), 0L), r.getRemark());
    }

        @NoReviewGuard(reason = "角色权限配置,不是期间数据。它是**元权限** —— 改这里能改谁有 entry:edit,进审核会自锁(要改权限先请人审,而审核权本身也在这张表里)")
@Transactional
    public RoleDTO createRole(RoleCreateReq req) {
        if (roles.selectOne(Wrappers.<AuthRole>lambdaQuery().eq(AuthRole::getCode, req.code())) != null)
            throw new BizException(ResultCode.CONFLICT, "角色标识「" + req.code() + "」已存在");
        AuthRole r = new AuthRole();
        r.setCode(req.code());
        r.setName(req.name());
        r.setBuiltin(0);
        r.setNavLayers(joinLayers(req.navLayers()));
        r.setRemark(req.remark());
        roles.insert(r);
        replacePerms(r.getId(), req.perms());
        audit.log("role.create", "role:" + r.getCode(), "权限 " + validPerms(req.perms()).size() + " 项");
        cache.reload();
        return oneRole(r.getId());
    }

        @NoReviewGuard(reason = "同 createRole:元权限配置,进审核会自锁")
@Transactional
    public RoleDTO updateRole(Integer id, RoleUpdateReq req) {
        AuthRole r = mustRole(id);
        // 预置角色的**权限与导航层可改**（「交付后客户自己调」的核心），只有 code 和"能不能删"是固定的
        List<String> next = validPerms(req.perms());
        guardSelfKeepsSystemEdit(id, next);
        r.setName(req.name());
        r.setNavLayers(joinLayers(req.navLayers()));
        r.setRemark(req.remark());
        roles.updateById(r);
        replacePerms(id, next);
        audit.log("role.update", "role:" + r.getCode(), "权限 " + next.size() + " 项");
        cache.reload();
        return oneRole(id);
    }

        @NoReviewGuard(reason = "同 createRole:元权限配置,进审核会自锁")
@Transactional
    public void deleteRole(Integer id) {
        AuthRole r = mustRole(id);
        if (r.getBuiltin() != null && r.getBuiltin() == 1)
            throw new BizException(ResultCode.CONFLICT, "预置角色不可删除（权限和导航层可以改）");
        long n = count(userRoles.selectCount(Wrappers.<AuthUserRole>lambdaQuery().eq(AuthUserRole::getRoleId, id)));
        if (n > 0)
            throw new BizException(ResultCode.CONFLICT, "该角色下还有 " + n + " 个账号，请先把他们改派到别的角色");
        rolePerms.delete(Wrappers.<AuthRolePerm>lambdaQuery().eq(AuthRolePerm::getRoleId, id));
        roles.deleteById(id);
        audit.log("role.delete", "role:" + r.getCode(), null);
        cache.reload();
    }

    // ══════════ 用户 ══════════

    public List<UserDTO> listUsers(String q, Integer status, Integer roleId) {
        Map<Integer, AuthRole> roleById = roles.selectList(null).stream()
            .collect(Collectors.toMap(AuthRole::getId, r -> r, (a, b) -> a));
        Map<Integer, List<Integer>> rolesByUser = userRoles.selectList(null).stream()
            .collect(Collectors.groupingBy(AuthUserRole::getUserId,
                     Collectors.mapping(AuthUserRole::getRoleId, Collectors.toList())));

        String kw = q == null ? "" : q.trim().toLowerCase(Locale.ROOT);
        return users.selectList(Wrappers.<AuthUser>lambdaQuery().orderByAsc(AuthUser::getId)).stream()
            .filter(u -> status == null || Objects.equals(u.getStatus(), status))
            .filter(u -> roleId == null || rolesByUser.getOrDefault(u.getId(), List.of()).contains(roleId))
            .filter(u -> kw.isEmpty()
                      || u.getUsername().toLowerCase(Locale.ROOT).contains(kw)
                      || (u.getDisplayName() != null && u.getDisplayName().toLowerCase(Locale.ROOT).contains(kw)))
            .map(u -> new UserDTO(u.getId(), u.getUsername(), u.getDisplayName(),
                    u.getStatus() == null ? 0 : u.getStatus(),
                    u.getMustChangePassword() != null && u.getMustChangePassword() == 1,
                    rolesByUser.getOrDefault(u.getId(), List.of()).stream()
                        .map(roleById::get).filter(Objects::nonNull)
                        .map(r -> new UserRoleBrief(r.getId(), r.getCode(), r.getName())).toList(),
                    u.getCreatedAt()))
            .toList();
    }

        @NoReviewGuard(reason = "账号档案,不是期间数据。停用一个人不该等审核 —— 那正是出事时最需要立刻做的事")
@Transactional
    public UserDTO createUser(UserCreateReq req) {
        if (users.selectOne(Wrappers.<AuthUser>lambdaQuery().eq(AuthUser::getUsername, req.username())) != null)
            throw new BizException(ResultCode.CONFLICT, "用户名「" + req.username() + "」已被占用");
        AuthUser u = new AuthUser();
        u.setUsername(req.username());
        u.setDisplayName(req.displayName());
        u.setPasswordHash(enc.encode(req.password()));
        u.setStatus(1);
        u.setRole("admin");                 // V32 遗留列,授权不看它;留个非空值免得老代码路径炸
        u.setMustChangePassword(1);         // 管理员设的是初始密码,本人首次登录必须改(拍板 #3)
        users.insert(u);
        replaceRoles(u.getId(), req.roleIds());
        audit.log("user.create", "user:" + u.getUsername(), "角色 " + safe(req.roleIds()).size() + " 个");
        cache.reload();
        return oneUser(u.getId());
    }

        @NoReviewGuard(reason = "同 createUser:账号档案,与任何账期无关")
@Transactional
    public UserDTO updateUser(Integer id, UserUpdateReq req) {
        AuthUser u = mustUser(id);
        boolean self = u.getUsername().equals(currentUsername());

        // 自锁防护只针对**角色**：改错角色会把自己关在门外，而这系统没有第二条进门的路。
        // 改自己的显示名是无害的，不该一起拦 —— 初版守卫一刀切拦掉整个 updateUser，
        // 结果管理员连自己的名字都改不了（2026-08-22 用户反馈）。
        if (self && rolesChanged(id, req.roleIds()))
            throw new BizException(ResultCode.CONFLICT,
                "不能修改自己的角色。显示名可以改，角色请让另一位管理员来改 —— "
              + "万一改错把自己关在门外，这个系统没有第二条进门的路。");

        u.setDisplayName(req.displayName());
        users.updateById(u);
        if (!self) replaceRoles(id, req.roleIds());   // 自己那行角色原样不动
        audit.log("user.update", "user:" + u.getUsername(),
            self ? "改显示名" : "角色 " + safe(req.roleIds()).size() + " 个");
        cache.reload();
        return oneUser(id);
    }

    /** 传进来的角色集合与库里现有的是否不同（顺序无关；null 视为空集）。 */
    private boolean rolesChanged(Integer userId, List<Integer> incoming) {
        Set<Integer> now = userRoles.selectList(Wrappers.<AuthUserRole>lambdaQuery()
                .eq(AuthUserRole::getUserId, userId))
            .stream().map(AuthUserRole::getRoleId).collect(Collectors.toSet());
        return !now.equals(new HashSet<>(safe(incoming)));
    }

        @NoReviewGuard(reason = "停用/启用账号。出事时要能立刻停,等审核等于把安全动作排进业务队列")
@Transactional
    public UserDTO setStatus(Integer id, int status) {
        AuthUser u = mustUser(id);
        guardNotSelf(u, "不能停用自己。");
        u.setStatus(status);
        users.updateById(u);
        audit.log(status == 1 ? "user.enable" : "user.disable", "user:" + u.getUsername(), null);
        cache.reload();   // 停用后下一个请求即 401 —— 不必等令牌过期
        return oneUser(id);
    }

        @NoReviewGuard(reason = "凭据操作。凭据不是期间数据,而让重置密码等审核会在人被锁在门外时无解")
@Transactional
    public void resetPassword(Integer id, String password) {
        AuthUser u = mustUser(id);
        u.setPasswordHash(enc.encode(password));
        u.setMustChangePassword(1);   // 管理员从此不知道任何人的密码,出事能说清是谁干的
        users.updateById(u);
        audit.log("user.reset-password", "user:" + u.getUsername(), null);
        cache.reload();
    }

    /** 本人改密。改完清 mustChangePassword，放行进系统。 */
    @Transactional
    public void changeOwnPassword(String currentPassword, String newPassword) {
        String me = currentUsername();
        AuthUser u = users.selectOne(Wrappers.<AuthUser>lambdaQuery().eq(AuthUser::getUsername, me));
        if (u == null) throw new BizException(ResultCode.UNAUTHORIZED);
        if (!enc.matches(currentPassword, u.getPasswordHash()))
            throw new BizException(ResultCode.BAD_REQUEST, "当前密码不正确");
        if (enc.matches(newPassword, u.getPasswordHash()))
            throw new BizException(ResultCode.BAD_REQUEST, "新密码不能与当前密码相同");
        u.setPasswordHash(enc.encode(newPassword));
        u.setMustChangePassword(0);
        users.updateById(u);
        audit.log("user.change-password", "user:" + u.getUsername(), "本人修改");
        cache.reload();
    }

    // ══════════ 守卫 ══════════

    private void guardNotSelf(AuthUser target, String why) {
        if (target.getUsername().equals(currentUsername()))
            throw new BizException(ResultCode.CONFLICT, why);
    }

    /**
     * 改角色权限时，不能把当前操作者自己的 system:edit 摘掉 —— 那等于当场锁门。
     * 只在"这个角色是我自己挂着的、且改完我就没有 system:edit 了"时才拦。
     */
    private void guardSelfKeepsSystemEdit(Integer roleId, List<String> nextPerms) {
        if (nextPerms.contains(Perm.SYSTEM_EDIT)) return;          // 没摘掉,不用管
        UserPermissionCache.UserAuth me = cache.get(currentUsername());
        if (me == null || !me.perms().contains(Perm.SYSTEM_EDIT)) return;

        AuthUser self = users.selectOne(Wrappers.<AuthUser>lambdaQuery().eq(AuthUser::getUsername, currentUsername()));
        if (self == null) return;
        List<Integer> myRoles = userRoles.selectList(Wrappers.<AuthUserRole>lambdaQuery()
            .eq(AuthUserRole::getUserId, self.getId())).stream().map(AuthUserRole::getRoleId).toList();
        if (!myRoles.contains(roleId)) return;                     // 改的不是我挂的角色

        // 我的其它角色里还有 system:edit 吗?有就随便改
        boolean elsewhere = myRoles.stream().filter(r -> !r.equals(roleId)).anyMatch(r ->
            count(rolePerms.selectCount(Wrappers.<AuthRolePerm>lambdaQuery()
                .eq(AuthRolePerm::getRoleId, r).eq(AuthRolePerm::getPerm, Perm.SYSTEM_EDIT))) > 0);
        if (!elsewhere)
            throw new BizException(ResultCode.CONFLICT,
                "这一步会摘掉你自己的「系统管理 · 管理」权限，保存后你就再也进不了这个页面了。"
              + "如果确实要收回，请先让另一位管理员操作。");
    }

    // ══════════ helpers ══════════

    private static String currentUsername() {
        var a = SecurityContextHolder.getContext().getAuthentication();
        return a == null || a.getName() == null ? "" : a.getName();
    }

    private AuthRole mustRole(Integer id) {
        AuthRole r = roles.selectById(id);
        if (r == null) throw new BizException(ResultCode.NOT_FOUND, "角色不存在");
        return r;
    }

    private AuthUser mustUser(Integer id) {
        AuthUser u = users.selectById(id);
        if (u == null) throw new BizException(ResultCode.NOT_FOUND, "账号不存在");
        return u;
    }

    private RoleDTO oneRole(Integer id) {
        return listRoles().stream().filter(r -> r.id().equals(id)).findFirst()
            .orElseThrow(() -> new BizException(ResultCode.NOT_FOUND, "角色不存在"));
    }

    private UserDTO oneUser(Integer id) {
        return listUsers(null, null, null).stream().filter(u -> u.id().equals(id)).findFirst()
            .orElseThrow(() -> new BizException(ResultCode.NOT_FOUND, "账号不存在"));
    }

    /** 静默丢掉不存在的权限点 —— 客户配不出系统里没有的权限（RBAC-SPEC 的那条分工线）。 */
    private static List<String> validPerms(List<String> in) {
        return safe(in).stream().distinct().filter(Perm::exists).toList();
    }

    private void replacePerms(Integer roleId, List<String> perms) {
        rolePerms.delete(Wrappers.<AuthRolePerm>lambdaQuery().eq(AuthRolePerm::getRoleId, roleId));
        for (String p : validPerms(perms)) {
            AuthRolePerm rp = new AuthRolePerm();
            rp.setRoleId(roleId);
            rp.setPerm(p);
            rolePerms.insert(rp);
        }
    }

    private void replaceRoles(Integer userId, List<Integer> roleIds) {
        userRoles.delete(Wrappers.<AuthUserRole>lambdaQuery().eq(AuthUserRole::getUserId, userId));
        for (Integer rid : safe(roleIds).stream().distinct().toList()) {
            if (roles.selectById(rid) == null) continue;   // 忽略不存在的角色 id
            AuthUserRole ur = new AuthUserRole();
            ur.setUserId(userId);
            ur.setRoleId(rid);
            userRoles.insert(ur);
        }
    }

    private static final Set<String> LAYERS = Set.of("data", "reports", "analysis");

    private static String joinLayers(List<String> in) {
        List<String> ok = safe(in).stream().distinct().filter(LAYERS::contains).toList();
        return String.join(",", ok);
    }

    private static List<String> splitLayers(String s) {
        if (s == null || s.isBlank()) return List.of();
        return Arrays.stream(s.split(",")).map(String::trim).filter(t -> !t.isEmpty()).toList();
    }

    private static <T> List<T> safe(List<T> in) { return in == null ? List.of() : in; }
    private static long count(Long n) { return n == null ? 0L : n; }
}
