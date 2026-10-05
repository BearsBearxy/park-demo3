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
 *
 * ⚠ **分级**（{@code guard*InRange}，RBAC-SPEC §12）：系统管理员（持 admin 角色）什么都能改；
 *    别的有 system:edit 的人只能动「不是系统管理员、权限全在自己手里」的角色和账号。
 *    改前一个只管账号的人能给自己的角色勾满权限、建一个系统管理员账号、重置管理员的密码再登进去
 *    （安全审计 F86 / F38 / F39）。用户 2026-10-04 拍板：系统管理员不分级，其他人分。
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
    private final SessionService sessions;
    private final NoticeService notices;
    private final ElevationService elevation;
    private final AuthService auth;
    private final com.park.demo3.security.PermissionRegistry registry;   // 操作日志导入那一路照导入中心的读规则

    public SystemService(AuthUserMapper users, AuthRoleMapper roles, AuthRolePermMapper rolePerms,
                         AuthUserRoleMapper userRoles, PasswordEncoder enc,
                         UserPermissionCache cache, AuditLogService audit, AuditQueryMapper auditQuery,
                         SessionService sessions, NoticeService notices, ElevationService elevation,
                         AuthService auth, com.park.demo3.security.PermissionRegistry registry) {
        this.users = users; this.roles = roles; this.rolePerms = rolePerms;
        this.userRoles = userRoles; this.enc = enc; this.cache = cache;
        this.audit = audit; this.auditQuery = auditQuery; this.sessions = sessions; this.notices = notices;
        this.elevation = elevation; this.auth = auth; this.registry = registry;
    }

    // ══════════ 操作日志时间线（RBAC-SPEC §7.2） ══════════

    /**
     * 几张来源表 union 后按时间倒序。**分页在 SQL 里做** —— param_change_log 随每次
     * 改参数增长，全捞进内存再切正是 QueryHygieneTest 防的那种「返回行数只涨不跌」。
     *
     * **谁看得见哪几行**(用户 2026-10-05 拍板:看得到操作日志,不等于看得到工资和别的打不开的数据):
     * 一行说的是哪张表,就要那张表的查看权 —— 数据修改记录按 {@link ChangeLogService.Tbl#viewPerm},
     * 计费参数那一路要「计费参数 · 查看」(里面是单价的改前改后),表档案那一路要「抄表 · 查看」。
     * 导入那一路照导入中心自己的读规则(PermissionRegistry 里 /api/import-log/** 那一条,八个模块查看权任一):
     * 只有「系统管理 · 查看」的账号打不开导入中心,这里也不给看工资表的文件名和人数;
     * 账号与角色那一路里作废 / 撤回催缴单的行要「出账与催缴单 · 查看」,删表的行要「抄表 · 查看」;
     * 审核那一路照旧全给 —— /api/review 本来就是任何登录账号都能读(审核状态与退回理由)。(对抗复查 SEC-2)
     * 判定下推进 SQL 的每个分支,条数、分页、操作人下拉三处一致;不靠前端藏。回包 sources = 看得见的来源,下拉只列它们。
     *
     * @param src  param / import / auth / review / meter / change，null=全部
     * @param tbl  只看某张表的数据修改记录(ChangeLogService.Tbl#code);给了它 src 就只能是 change 或不给
     * @param to   传日期时按「当天含全天」处理（前端给的是 2026-08-22，用户的意思是含这一天）
     */
    public AuditPageDTO auditLogs(String src, String tbl, String actor, LocalDate from, LocalDate to,
                                  int page, int size) {
        String s = (src == null || src.isBlank()) ? null : src.trim();
        if (s != null && !List.of("param", "import", "auth", "review", "meter", "change").contains(s))
            throw new BizException(ResultCode.BAD_REQUEST, "未知的日志来源：" + s);
        String tb = (tbl == null || tbl.isBlank()) ? null : tbl.trim();
        if (tb != null) {
            if (Arrays.stream(ChangeLogService.Tbl.values()).noneMatch(x -> x.code.equals(tb)))
                throw new BizException(ResultCode.BAD_REQUEST, "未知的表：" + tb);
            if (s != null && !s.equals("change"))
                throw new BizException(ResultCode.BAD_REQUEST, "按表筛只对「数据修改」这一路有效");
            s = "change";
        }
        String a = (actor == null || actor.isBlank()) ? null : actor.trim();
        LocalDateTime f = from == null ? null : from.atStartOfDay();
        LocalDateTime t = to == null ? null : to.plusDays(1).atStartOfDay();   // 含结束当天

        UserPermissionCache.UserAuth me = cache.get(currentUsername());
        Set<String> mine = me == null ? Set.of() : me.perms();
        boolean seeParam = mine.contains(Perm.PARAM_VIEW), seeMeter = mine.contains(Perm.METER_VIEW);
        boolean seeImport = registry.resolveRead("/api/import-log/overview").stream().anyMatch(mine::contains);
        boolean seeBilling = mine.contains(Perm.BILLING_VIEW);
        List<String> tbls = Arrays.stream(ChangeLogService.Tbl.values())
            .filter(x -> mine.contains(x.viewPerm)).map(x -> x.code).toList();
        List<String> sources = new ArrayList<>();
        if (seeParam) sources.add("param");
        if (seeImport) sources.add("import");
        sources.add("auth");
        sources.add("review");
        if (seeMeter) sources.add("meter");
        if (!tbls.isEmpty()) sources.add("change");

        int p = Math.max(1, page);
        int sz = Math.min(200, Math.max(1, size));
        long total = auditQuery.count(s, tb, a, f, t, seeParam, seeImport, seeBilling, seeMeter, tbls);
        List<AuditRowDTO> rows = auditQuery.page(s, tb, a, f, t, seeParam, seeImport, seeBilling, seeMeter, tbls, sz, (p - 1) * sz);
        return new AuditPageDTO(rows, total, p, sz,
            auditQuery.actors(seeParam, seeImport, seeBilling, seeMeter, tbls), tbls, sources);
    }

    // ══════════ 字典 ══════════

    public PermCatalog catalog() {
        return new PermCatalog(
            Perm.META.stream().map(m -> new PermMeta(m.key(), m.label(), m.hint(), m.group(), m.kind())).toList(),
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
            splitLayers(r.getNavLayers()), ps, countByRole.getOrDefault(r.getId(), 0L), r.getRemark(),
            inMyRange(UserPermissionCache.SUPER_ADMIN_ROLE.equals(r.getCode()), ps));
    }

        @NoReviewGuard(reason = "角色权限配置,不是期间数据。它是**元权限** —— 改这里能改谁有 entry:edit,进审核会自锁(要改权限先请人审,而审核权本身也在这张表里)")
@Transactional
    public RoleDTO createRole(RoleCreateReq req) {
        if (roles.selectOne(Wrappers.<AuthRole>lambdaQuery().eq(AuthRole::getCode, req.code())) != null)
            throw new BizException(ResultCode.CONFLICT, "角色标识「" + req.code() + "」已存在");
        guardRoleInRange(null, validPerms(req.perms()));
        AuthRole r = new AuthRole();
        r.setCode(req.code());
        r.setName(req.name());
        r.setBuiltin(0);
        r.setNavLayers(joinLayers(req.navLayers()));
        r.setRemark(req.remark());
        roles.insert(r);
        replacePerms(r.getId(), req.perms());
        audit.log("role.create", "role:" + r.getCode(), permDiff(Set.of(), validPerms(req.perms())));
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
        // 原样保存不发通知:没改的东西写「你的权限被改了」是假话。备注不算 —— 持有人看不到它。
        Set<String> before = rolePerms.selectList(Wrappers.<AuthRolePerm>lambdaQuery().eq(AuthRolePerm::getRoleId, id))
            .stream().map(AuthRolePerm::getPerm).collect(Collectors.toSet());
        // 改前也要比:比我大的角色,哪怕是往小里改也不归我动(F39:改自己挂的角色给自己加权限,改后那份拦住它)
        Set<String> both = new HashSet<>(before);
        both.addAll(next);
        guardRoleInRange(r, both);
        boolean changed = !before.equals(new HashSet<>(next)) || !Objects.equals(r.getName(), req.name())
            || !Objects.equals(r.getNavLayers(), joinLayers(req.navLayers()));
        r.setName(req.name());
        r.setNavLayers(joinLayers(req.navLayers()));
        r.setRemark(req.remark());
        roles.updateById(r);
        replacePerms(id, next);
        audit.log("role.update", "role:" + r.getCode(), permDiff(before, next));
        cache.reload();
        if (changed) {
            // 持这个角色的每个人(NoticeService.add 跳过操作人自己)
            List<Integer> holders = userRoles.selectList(Wrappers.<AuthUserRole>lambdaQuery().eq(AuthUserRole::getRoleId, id))
                .stream().map(AuthUserRole::getUserId).toList();
            if (!holders.isEmpty()) for (AuthUser h : users.selectBatchIds(holders))
                notices.add(h.getUsername(), NoticeService.Kind.perms_changed,
                    "你的角色「" + req.name() + "」的权限被改了", "刷新后生效", null);
        }
        return oneRole(id);
    }

        @NoReviewGuard(reason = "同 createRole:元权限配置,进审核会自锁")
@Transactional
    public void deleteRole(Integer id) {
        AuthRole r = mustRole(id);
        if (r.getBuiltin() != null && r.getBuiltin() == 1)
            throw new BizException(ResultCode.CONFLICT, "预置角色不可删除（权限和导航层可以改）");
        guardRoleInRange(r, permsOfRoles(List.of(id)));
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
        Map<Integer, List<String>> permsByRole = rolePerms.selectList(null).stream()
            .collect(Collectors.groupingBy(AuthRolePerm::getRoleId,
                     Collectors.mapping(AuthRolePerm::getPerm, Collectors.toList())));

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
                    u.getCreatedAt(),
                    inMyRange(rolesByUser.getOrDefault(u.getId(), List.of()).stream()
                            .map(roleById::get).anyMatch(r -> r != null && UserPermissionCache.SUPER_ADMIN_ROLE.equals(r.getCode())),
                        rolesByUser.getOrDefault(u.getId(), List.of()).stream()
                            .flatMap(rid -> permsByRole.getOrDefault(rid, List.of()).stream()).toList())))
            .toList();
    }

        @NoReviewGuard(reason = "账号档案,不是期间数据。停用一个人不该等审核 —— 那正是出事时最需要立刻做的事")
@Transactional
    public UserDTO createUser(UserCreateReq req) {
        if (users.selectOne(Wrappers.<AuthUser>lambdaQuery().eq(AuthUser::getUsername, req.username())) != null)
            throw new BizException(ResultCode.CONFLICT, "用户名「" + req.username() + "」已被占用");
        guardUserInRange(null, safe(req.roleIds()));
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

        boolean rolesDiff = !self && rolesChanged(id, req.roleIds());   // 先判再改,改完就比不出来了
        if (rolesDiff) guardKeepsAnAdmin(u, true, safe(req.roleIds()));
        guardUserInRange(u, rolesDiff ? safe(req.roleIds()) : null);
        // 只写要改的列(2026-10-04)。整行 updateById(u) 会把事务开头读到的 status / token_version / 口令一起写回,
        // 盖掉这期间别人已提交的停用、踢人:改名的同时另一位管理员停用了他,停用被悄悄撤销、版本号往回走(AuthUserLostUpdateIT)。
        // 下面 setStatus / resetPassword / changeOwnPassword、AdminInitializer 同理。
        AuthUser patch = new AuthUser();
        patch.setId(id);
        patch.setDisplayName(req.displayName());
        users.updateById(patch);
        if (!self) replaceRoles(id, req.roleIds());   // 自己那行角色原样不动
        audit.log("user.update", "user:" + u.getUsername(),
            self ? "改显示名" : "角色 " + safe(req.roleIds()).size() + " 个");
        cache.reload();
        if (rolesDiff) notices.add(u.getUsername(), NoticeService.Kind.perms_changed, "你的角色被改了", "刷新后生效", null);
        return oneUser(id);
    }

    /** 传进来的角色集合与库里现有的是否不同（顺序无关；null 视为空集）。 */
    private boolean rolesChanged(Integer userId, List<Integer> incoming) {
        return !roleIdsOf(userId).equals(new HashSet<>(safe(incoming)));
    }

        @NoReviewGuard(reason = "停用/启用账号。出事时要能立刻停,等审核等于把安全动作排进业务队列")
@Transactional
    public UserDTO setStatus(Integer id, int status) {
        AuthUser u = mustUser(id);
        guardNotSelf(u, "不能停用自己。");
        guardKeepsAnAdmin(u, status == 1, null);
        guardUserInRange(u, null);
        AuthUser patch = new AuthUser();   // 只写 status,同 updateUser
        patch.setId(id);
        patch.setStatus(status);
        users.updateById(patch);
        audit.log(status == 1 ? "user.enable" : "user.disable", "user:" + u.getUsername(), null);
        cache.reload();   // 停用后下一个请求即 401 —— 不必等令牌过期
        // 停用本来就立刻生效(快照里查不到)。这里再作废一次是为了让 auth_session
        // 跟得上 —— 否则「谁在线」那张表会永远挂着一个已停用的人。
        if (status != 1) sessions.revokeAll(u.getUsername(), "disabled");
        return oneUser(id);
    }

        @NoReviewGuard(reason = "凭据操作。凭据不是期间数据,而让重置密码等审核会在人被锁在门外时无解")
@Transactional
    /** 重置的是自己的 → 返回这台设备接着用的新令牌;重置别人的 → null。 */
    public String resetPassword(Integer id, String password) {
        AuthUser u = mustUser(id);
        guardUserInRange(u, null);   // 重置比自己大的账号的密码 = 拿到那个账号(F38)
        boolean self = u.getUsername().equals(currentUsername());
        AuthUser patch = new AuthUser();   // 只写口令两列,同 updateUser
        patch.setId(id);
        patch.setPasswordHash(enc.encode(password));
        // 给别人重置:管理员从此不知道任何人的密码,出事能说清是谁干的 → 本人下次登录必须改。
        // 给自己重置:密码是自己刚定的,不再逼自己改一遍(用户 2026-10-04:「重置密码后，到登录的时候又要强制改一遍」)。
        patch.setMustChangePassword(self ? 0 : 1);
        users.updateById(patch);
        audit.log("user.reset-password", "user:" + u.getUsername(), null);
        cache.reload();
        // 放在 cache.reload() 之后:reload 重建整张快照,放前面会被它盖掉。
        // 自己的:同 changeOwnPassword,本机换新令牌接着用,别处下线。
        if (self) return auth.reissueAfterPasswordChange(u);
        // V125:改完密码要立刻生效。改前它只换了库里的哈希,
        // 已经发出去的令牌照样能用到 120 分钟过期为止。
        sessions.revokeAll(u.getUsername(), "password");
        return null;
    }

    /** 本人改密。改完清 mustChangePassword，放行进系统;返回这台设备接着用的新令牌。 */
    @NoReviewGuard(reason = "同 resetPassword:只写 auth_user 的口令列,凭据不是期间数据。首登强制改密走的正是这条路,进审核等于新账号在审核员点头前一直登不进系统")
    // noRollbackFor:旧口令错时 verifyOwnPassword 先写一条 .deny 审计再抛 —— 默认回滚会把这条审计一起抹掉。
    // 抛 BizException 的分支都在任何业务写之前,不回滚它们不会留下半截数据。
    @Transactional(noRollbackFor = BizException.class)
    public String changeOwnPassword(String currentPassword, String newPassword) {
        String me = currentUsername();
        AuthUser u = users.selectOne(Wrappers.<AuthUser>lambdaQuery().eq(AuthUser::getUsername, me));
        if (u == null) throw new BizException(ResultCode.UNAUTHORIZED);
        // 旧口令走与提权同一道门:按 ip|账号 5 次锁 15 分钟 + 失败审计。原来直接 enc.matches ——
        // 拿到一张令牌就能不限次、不留痕地猜口令,而下面「新密码不能与当前相同」那句恰好告诉他猜中了(安全审计 F03)。
        elevation.verifyOwnPassword(currentPassword, "user.change-password", "当前密码不正确");
        if (enc.matches(newPassword, u.getPasswordHash()))
            throw new BizException(ResultCode.BAD_REQUEST, "新密码不能与当前密码相同");
        AuthUser patch = new AuthUser();   // 只写口令两列,同 updateUser
        patch.setPasswordHash(enc.encode(newPassword));
        patch.setMustChangePassword(0);
        // 且只在还启用、口令还是刚验过的那个时写(2026-10-04):开头那一读到这里隔着验旧口令、算新哈希(几百毫秒),
        // 这期间被停用,密码不该还改得成、审计里不该还多一条「本人修改」;这期间管理员重置了他的密码,拿旧口令改的这一下
        // 不该把重置盖掉、换出一张能用的新令牌(两边写同一列,只写补丁挡不住)。
        // 0 行 = 刚被停用或刚被重置,令牌已被那一边作废:答 401,他下一个请求就被踢回登录页。
        // 改密页上那句按停用名单分(与下一个请求的 X-Auth-Reason 同一来源):停用的照登录页说;被重置的仍是默认那句。
        if (users.update(patch, Wrappers.<AuthUser>lambdaUpdate().eq(AuthUser::getId, u.getId())
                .eq(AuthUser::getStatus, 1).eq(AuthUser::getPasswordHash, u.getPasswordHash())) == 0)
            throw cache.isDisabled(me) ? new BizException(ResultCode.UNAUTHORIZED, "账号已停用，请联系管理员")
                                       : new BizException(ResultCode.UNAUTHORIZED, "这个账号的密码刚被改动，请重新登录");
        audit.log("user.change-password", "user:" + u.getUsername(), "本人修改");
        cache.reload();
        // 本机换一张新令牌接着用,手上这张旧的连同别处的当场作废(用户 2026-10-04 拍板,AuthService.reissueAfterPasswordChange)。
        // 改前是 revokeAll,连本机也踢回登录页 —— 强制改密改完落到首页,紧接着又被弹回登录页。
        // 放在 cache.reload() 之后:reload 重建整张快照,放前面会被它盖掉。
        return auth.reissueAfterPasswordChange(u);
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
                "这一步会摘掉你自己的「系统管理 · 管理」权限，保存后你就不能再改账号和角色了。"
              + "如果确实要收回，请先让另一位管理员操作。");
    }

    /**
     * 角色权限加了哪几项、去了哪几项,用人话名(用户 2026-10-05 拍板:原来只记「权限 N 项」,看不出动了什么)。
     * 加和去互不相交,全部 28 项一起加也在 detail 的 255 字以内(SystemServicePermDiffTest 钉着)。
     */
    static String permDiff(Collection<String> before, Collection<String> after) {
        Set<String> b = new HashSet<>(before), a = new HashSet<>(after);
        Comparator<String> byAll = Comparator.comparingInt(Perm.ALL::indexOf);
        List<String> add = a.stream().filter(x -> !b.contains(x)).sorted(byAll).map(Perm::label).toList();
        List<String> del = b.stream().filter(x -> !a.contains(x)).sorted(byAll).map(Perm::label).toList();
        // 没增没减不说「权限没变」:那一行的动作是「改角色」(只改名 / 备注也走这里);新建时一项没勾也谈不上「没变」
        if (add.isEmpty() && del.isEmpty()) return a.isEmpty() ? "没勾任何权限" : "没动权限，共 " + a.size() + " 项";
        List<String> parts = new ArrayList<>();
        if (!add.isEmpty()) parts.add("加 " + add.size() + " 项：" + String.join("、", add));
        if (!del.isEmpty()) parts.add("去 " + del.size() + " 项：" + String.join("、", del));
        parts.add("现共 " + a.size() + " 项");
        return String.join("；", parts);
    }

    // ══════════ 分级(RBAC-SPEC §12,用户 2026-10-04 拍板) ══════════
    // 「系统管理不分级反正我需要一个超级管理员的账号都能调试整个软件」:系统管理员一条都不拦。
    // 比的是**角色给的**权限(含编辑隐含查看),与授权判定同一份快照;不含提权 —— system:* 本来就借不到。
    // 不加「再输一次自己的密码」:系统管理员调试要顺手(同一句拍板)。

    private boolean iAmSuperAdmin() { return cache.isSuperAdmin(currentUsername()); }

    /** perms(展开隐含查看)里我没有的,人话名、按 Perm.ALL 排。我是系统管理员时恒空。 */
    private List<String> beyondMe(Collection<String> perms) {
        if (iAmSuperAdmin()) return List.of();
        UserPermissionCache.UserAuth me = cache.get(currentUsername());
        Set<String> mine = me == null ? Set.of() : me.perms();
        return Perm.withImplied(perms).stream().filter(p -> !mine.contains(p))
            .sorted(Comparator.comparingInt(Perm.ALL::indexOf)).map(Perm::label).toList();
    }

    /** 屏上置灰的判据(RoleDTO / UserDTO.manageable),与下面两个守卫同一条。 */
    private boolean inMyRange(boolean holdsAdmin, Collection<String> perms) {
        return iAmSuperAdmin() || (!holdsAdmin && beyondMe(perms).isEmpty());
    }

    /** 角色:系统管理员角色只有系统管理员动得了;别的角色里(改前 ∪ 改后)不许有我没有的权限。 */
    private void guardRoleInRange(AuthRole r, Collection<String> perms) {
        if (iAmSuperAdmin()) return;
        if (r != null && UserPermissionCache.SUPER_ADMIN_ROLE.equals(r.getCode()))
            throw new BizException(ResultCode.FORBIDDEN, "系统管理员角色只有系统管理员能改");
        List<String> over = beyondMe(perms);
        if (!over.isEmpty())
            throw new BizException(ResultCode.FORBIDDEN,
                "角色里有你没有的权限：" + String.join("、", over) + "。只有系统管理员能分配你没有的权限");
    }

    /**
     * 账号:target 现在的样子、nextRoleIds(改完挂的角色,null = 角色不动)都得在我范围内。
     * 持系统管理员角色的账号、以及把这个角色分给谁,只有系统管理员能做。
     */
    private void guardUserInRange(AuthUser target, Collection<Integer> nextRoleIds) {
        if (iAmSuperAdmin()) return;
        Integer adminRole = adminRoleId();
        if (target != null) {
            Set<Integer> cur = roleIdsOf(target.getId());
            if (cur.contains(adminRole))
                throw new BizException(ResultCode.FORBIDDEN,
                    "「" + target.getDisplayName() + "」是系统管理员账号，只有系统管理员能改");
            List<String> over = beyondMe(permsOfRoles(cur));
            if (!over.isEmpty())
                throw new BizException(ResultCode.FORBIDDEN,
                    "「" + target.getDisplayName() + "」有你没有的权限：" + String.join("、", over) + "。只有系统管理员能改这个账号");
        }
        if (nextRoleIds == null) return;
        if (adminRole != null && nextRoleIds.contains(adminRole))
            throw new BizException(ResultCode.FORBIDDEN, "系统管理员角色只有系统管理员能分配");
        List<String> over = beyondMe(permsOfRoles(nextRoleIds));
        if (!over.isEmpty())
            throw new BizException(ResultCode.FORBIDDEN,
                "要分配的角色里有你没有的权限：" + String.join("、", over) + "。只有系统管理员能分配你没有的权限");
    }

    /**
     * 至少留一个启用的系统管理员 —— 对所有人,系统管理员自己也一样(RBAC-SPEC §12)。
     * 排在分级前面:只管账号的人去停用最后一个管理员,该听到的是这个后果,而不是一句「超出你的范围」。
     * 系统管理员自己操作时,「不能停用自己 / 不能改自己的角色」已先拦在前面,今天走不到这里。
     *
     * 并发:A、B 两个系统管理员同时互相停用(或摘角色),普通读各自看见对方还启用着,双双放行,
     * 提交后一个启用的都不剩,只能去库里手改。所以先锁住系统管理员角色那一行(两件事排队),
     * 再用锁定读数人 —— 锁定读读的是已提交的最新行,不是本事务开头(mustUser 那一下)拍的快照,
     * 排在后面的那个才看得见前一个刚停掉的人。只在真要摘掉一个启用的系统管理员时才锁,别的改动不排队。
     *
     * @param enabledAfter 改完还是不是启用
     * @param rolesAfter   改完挂的角色;null = 角色不动
     */
    private void guardKeepsAnAdmin(AuthUser target, boolean enabledAfter, Collection<Integer> rolesAfter) {
        Integer adminRole = adminRoleId();
        if (adminRole == null) return;
        if (!Objects.equals(target.getStatus(), 1) || !roleIdsOf(target.getId()).contains(adminRole)) return;   // 本来就不算数
        if (enabledAfter && (rolesAfter == null || rolesAfter.contains(adminRole))) return;                     // 改完还算数
        roles.selectList(Wrappers.<AuthRole>query().eq("id", adminRole).last("FOR UPDATE"));
        List<Integer> others = userRoles.selectList(Wrappers.<AuthUserRole>query().eq("role_id", adminRole).last("FOR SHARE"))
            .stream().map(AuthUserRole::getUserId).filter(uid -> !uid.equals(target.getId())).toList();
        if (others.isEmpty() || users.selectList(Wrappers.<AuthUser>query().in("id", others).last("FOR SHARE"))
                .stream().noneMatch(o -> Objects.equals(o.getStatus(), 1)))
            throw new BizException(ResultCode.CONFLICT,
                "「" + target.getDisplayName() + "」是最后一个启用的系统管理员账号，停用它或摘掉它的系统管理员角色后，"
              + "就没有人能管理整个系统了。请先给另一个账号分配系统管理员角色。");
    }

    // ══════════ helpers ══════════

    private Integer adminRoleId() {
        AuthRole r = roles.selectOne(Wrappers.<AuthRole>lambdaQuery().eq(AuthRole::getCode, UserPermissionCache.SUPER_ADMIN_ROLE));
        return r == null ? null : r.getId();
    }

    private Set<Integer> roleIdsOf(Integer userId) {
        return userRoles.selectList(Wrappers.<AuthUserRole>lambdaQuery().eq(AuthUserRole::getUserId, userId))
            .stream().map(AuthUserRole::getRoleId).collect(Collectors.toSet());
    }

    /** 这几个角色勾的权限点并集(库里原样,不展开隐含 —— beyondMe 会展开)。 */
    private Set<String> permsOfRoles(Collection<Integer> roleIds) {
        if (roleIds.isEmpty()) return Set.of();
        return rolePerms.selectList(Wrappers.<AuthRolePerm>lambdaQuery().in(AuthRolePerm::getRoleId, roleIds))
            .stream().map(AuthRolePerm::getPerm).collect(Collectors.toSet());
    }

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
