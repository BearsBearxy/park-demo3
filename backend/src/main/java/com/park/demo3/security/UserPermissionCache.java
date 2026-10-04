package com.park.demo3.security;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.park.demo3.entity.*;
import com.park.demo3.mapper.*;
import jakarta.annotation.PostConstruct;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.util.*;
import java.util.stream.Collectors;

/**
 * 用户 → 权限点 的内存快照(RBAC-SPEC v2 §5.5)。
 *
 * **为什么不把权限烤进 JWT**:令牌有效期 120 分钟。权限烤进去 → 把一个人停用了,
 * 他还能再用两小时。这里全量装内存(账号就几十行),任何用户/角色写操作后 {@link #reload()},
 * 每请求零 DB 查询,改完立刻生效,停用立刻踢。
 *
 * 停用/删号的账号**不进快照** → JwtAuthFilter 查不到 → 该请求保持匿名 → 401。
 * 停用的另记一份名单({@link #isDisabled}),让 401 带上「账号已停用」这个理由(V133)。
 */
@Slf4j
@Component
public class UserPermissionCache {

    /**
     * 一个账号的授权快照。navLayers 与权限无关,只管导航显示哪几层(RBAC-SPEC §4)。
     *
     * roleNames = 该账号挂着的角色**显示名**(D6),多角色按挂载序给全部,顺序即展示序。
     * 它是展示物,不是判定依据 —— 判定一律看 perms。放这里而不是每次 join `auth_user_role`,
     * 是因为这份快照本来就是那张表的内存投影,再查一次库只是把同一件事做两遍。
     * 一个角色都没挂的账号是空表(不是 null):派生兜底由前端 `auth.roleLabel` 做,
     * 后端不猜 —— 猜出来的名字会被当成真名显示,而"（派生）"这个标记只有前端画得出来。
     */
    public record UserAuth(String username, Set<String> perms, List<String> navLayers,
                           List<String> roleNames, int tokenVersion, String sessionId,
                           String revokeReason) {

        /** 换一份会话身份,其余原样(V125:登录/改密/踢人之后定点改这一个账号,不整表 reload)。 */
        UserAuth withSession(int tv, String sid, String reason) {
            return new UserAuth(username, perms, navLayers, roleNames, tv, sid, reason);
        }
    }

    private final AuthUserMapper users;
    private final AuthUserRoleMapper userRoles;
    private final AuthRoleMapper roles;
    private final AuthRolePermMapper rolePerms;

    private final ElevationStore elevations;

    private volatile Map<String, UserAuth> snapshot = Map.of();
    /** status≠1 的账号名。不进 snapshot(那样就有权限了),单独记,只用来给 401 说理由。 */
    private volatile Set<String> disabled = Set.of();

    /** 系统管理员角色的标识。预置、建后不可改、不可删(SystemService)。 */
    public static final String SUPER_ADMIN_ROLE = "admin";
    /**
     * 持系统管理员角色的启用账号。系统管理分级与录审分离都放过他们 ——
     * 用户 2026-10-04 拍板「我需要一个超级管理员的账号都能调试整个软件，录审不分离在超级管理，其他分离」。
     * 按角色 code 认,不按权限点认:别人的角色可以被勾满全部权限,那也不等于系统管理员。
     */
    private volatile Set<String> superAdmins = Set.of();
    /** 启用、且 must_change_password=1 的账号:除改密页要用的几条接口外一律拦(JwtAuthFilter)。跟着 reload 走,改完密码当场清。 */
    private volatile Set<String> mustChange = Set.of();

    public UserPermissionCache(AuthUserMapper users, AuthUserRoleMapper userRoles,
                               AuthRoleMapper roles, AuthRolePermMapper rolePerms,
                               ElevationStore elevations) {
        this.users = users; this.userRoles = userRoles; this.roles = roles; this.rolePerms = rolePerms;
        this.elevations = elevations;
    }

    @PostConstruct
    public void init() { reload(); }

    /** 任何 auth_user / auth_role / auth_role_perm / auth_user_role 的写操作之后必须调。 */
    public synchronized void reload() {
        // 在事务里调的(SystemService 的写方法),事务结束后再 reload 一次(2026-10-04,对抗复查 R1 / R2)。
        // 事务里这次读得到本事务没提交的写(@Transactional 测试靠它),可从它到提交之间,别的线程的 reload
        // (AdminInitializer、另一个人的保存)读的是提交前的库、发布在它后面:刚建 / 刚启用的号不在快照里,
        // 登录时 applySession 找不到人、新 sid 落空,401;刚改完的密码又被放回 mustChange,新令牌 403 回改密页;
        // 刚停用的号又回到快照、没了「已停用」的理由。事务结束后这次读的是库里真有的,监视器又把它排在那些
        // 读得早的 reload 后面,最后发布的就是对的。回滚也重读:事务里那次发布的是没落库的权限,不能留着 ——
        // 前提是这时还查得了库:afterCompletion 跑在连接归还之前,这次 reload 用的还是事务那条连接。
        // ponytail: 事务要是因为连接断了才结束,这里的 reload 照样抛,Spring 只记一行错误日志,快照停在事务里那份
        //           (含没落库的写)直到下一次 reload;要补就把这里的 reload 放进 REQUIRES_NEW 的 TransactionTemplate,另取一条连接。
        // ponytail: 开得更早的事务里那次 reload(REPEATABLE READ 旧视图)在它提交前会发布旧快照:权限、tv 提交后这里补正;
        // 可这期间新建 / 新启用的号登录,applySession 找不到人,新 sid 落空、补不回来,他要重新登录一次。
        if (TransactionSynchronizationManager.isSynchronizationActive())
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override public void afterCompletion(int status) { reload(); }
            });
        // reload 会重建整张快照,而会话 id 不在它查的那几张表里 —— 不先存下来,
        // 任何一次角色变更都会把所有人的 sid 抹成 null,下一个请求全部 401。
        Map<String, String> liveSid = new HashMap<>();
        Map<String, String> reason = new HashMap<>();
        for (var e : snapshot.entrySet()) {
            if (e.getValue().sessionId() != null) liveSid.put(e.getKey(), e.getValue().sessionId());
            if (e.getValue().revokeReason() != null) reason.put(e.getKey(), e.getValue().revokeReason());
        }
        // 提权授权一并清空。不清的话「停用立刻踢」这条就有个 30 分钟的洞:
        // 被停用的账号仍能靠手上的授权继续写 —— 那正是这份缓存存在的理由。
        // 粗粒度(清所有人)是故意的:reload 不知道是谁变了,而角色变更本就罕见,
        // 代价只是重新叫主管点一次头。
        elevations.revokeAllUsers();
        disabled = users.selectList(Wrappers.<AuthUser>lambdaQuery().ne(AuthUser::getStatus, 1)).stream()
            .map(AuthUser::getUsername).collect(Collectors.toUnmodifiableSet());
        // 只装 status=1 的账号:停用的查不到 → 下一个请求就 401,不必等令牌过期
        List<AuthUser> active = users.selectList(Wrappers.<AuthUser>lambdaQuery().eq(AuthUser::getStatus, 1));
        if (active.isEmpty()) { snapshot = Map.of(); superAdmins = Set.of(); mustChange = Set.of(); return; }
        mustChange = active.stream().filter(u -> Integer.valueOf(1).equals(u.getMustChangePassword()))
            .map(AuthUser::getUsername).collect(Collectors.toUnmodifiableSet());

        Map<Integer, AuthRole> roleById = roles.selectList(null).stream()
            .collect(Collectors.toMap(AuthRole::getId, r -> r, (a, b) -> a));
        Map<Integer, Set<String>> permsByRole = new HashMap<>();
        for (AuthRolePerm rp : rolePerms.selectList(null)) {
            permsByRole.computeIfAbsent(rp.getRoleId(), k -> new HashSet<>()).add(rp.getPerm());
        }
        Map<Integer, List<Integer>> rolesByUser = new HashMap<>();
        for (AuthUserRole ur : userRoles.selectList(null)) {
            rolesByUser.computeIfAbsent(ur.getUserId(), k -> new ArrayList<>()).add(ur.getRoleId());
        }

        Map<String, UserAuth> next = new HashMap<>();
        Set<String> admins = new HashSet<>();
        for (AuthUser u : active) {
            Set<String> perms = new HashSet<>();
            // 多角色是并集 —— 现实里有「主管兼管理员」。导航层同理取并集,否则兼岗的人会少看到东西。
            Set<String> layers = new LinkedHashSet<>();
            List<String> roleNames = new ArrayList<>();
            for (Integer rid : rolesByUser.getOrDefault(u.getId(), List.of())) {
                perms.addAll(permsByRole.getOrDefault(rid, Set.of()));
                AuthRole r = roleById.get(rid);
                if (r != null && SUPER_ADMIN_ROLE.equals(r.getCode())) admins.add(u.getUsername());
                if (r != null && r.getName() != null && !r.getName().isBlank()) roleNames.add(r.getName());
                if (r != null && r.getNavLayers() != null) {
                    for (String s : r.getNavLayers().split(",")) {
                        String t = s.trim();
                        if (!t.isEmpty()) layers.add(t);
                    }
                }
            }
            // 一个角色都没挂的账号(手工 INSERT 进 auth_user 的)→ 零权限 + 导航全开。
            // 不给权限是安全的默认;导航全开是因为看不见入口比看得见更难排查。
            if (layers.isEmpty()) layers.addAll(List.of("data", "reports", "analysis"));
            // sessionId 从 auth_session 现查会让 reload 多一次 join;它只在登录时才变,
            // 由 applySession 定点写进来。reload 拿不到就给 null —— 见 applySession 的注释。
            // tv 取库与快照里较大的那个(2026-10-04)。这次读可能早于某次登录/踢人的提交:open 已经 applySession、
            // 还没提交时别的线程 reload(AdminInitializer、任何一次角色/账号保存),或者 reload 跑在开得更早的事务里
            // (SystemService 的写方法,REPEATABLE READ 读的是事务第一次读那一刻)。照库里的旧数发布,就和快照里的
            // 新 sid 拼成一对,刚签的令牌 401,直到下一次 reload(实测:刚重启时新号登录后改密)。库里已提交的
            // token_version 只增不减(只有 SessionService.bump 写它、在库里 +1;整行写回旧值的写法 2026-10-04 已去掉),
            // 快照里的要么是某个已提交的值,要么是还没提交 / 被回滚的那次 bump,所以大的就是新的(被回滚的见下面 ponytail)。
            // 没把 applySession 挪到 afterCommit:补不上「reload 跑在更早的事务里」那种,而且在调用方自己的事务里
            // (@Transactional 测试里的登录)永远等不到提交、快照永远不改。
            // ponytail: 被回滚的 open/revokeAll 留在快照里的 tv 不退回 —— 改前也退不回(sid 已换),那人重登一次即对齐。
            UserAuth prev = snapshot.get(u.getUsername());
            int tv = Math.max(u.getTokenVersion() == null ? 0 : u.getTokenVersion(), prev == null ? 0 : prev.tokenVersion());
            String sid = liveSid.get(u.getUsername());
            // 编辑隐含同组查看(RBAC-SPEC §11 规则 1):在这里展开、不落库 —— 后端判定(authorities)、
            // /auth/me 与登录回包拿到的都是展开后的集合,角色屏存的仍是勾选的原样
            next.put(u.getUsername(), new UserAuth(u.getUsername(), Set.copyOf(Perm.withImplied(perms)), List.copyOf(layers),
                                                   List.copyOf(roleNames), tv, sid, reason.get(u.getUsername())));
        }
        snapshot = Map.copyOf(next);
        superAdmins = Set.copyOf(admins);
        log.info("permission cache reloaded: {} active users", snapshot.size());
    }

    /** 找不到 = 账号不存在或已停用。 */
    public UserAuth get(String username) { return username == null ? null : snapshot.get(username); }

    /** 还带着管理员给的密码、没改过。 */
    public boolean mustChangePassword(String username) { return username != null && mustChange.contains(username); }

    /** 启用且持系统管理员角色。 */
    public boolean isSuperAdmin(String username) { return username != null && superAdmins.contains(username); }

    /** 这个账号存在且被停用了。只给「令牌签名有效」之后用 —— 拿它回答陌生人就成了枚举口。 */
    public boolean isDisabled(String username) { return username != null && disabled.contains(username); }

    /**
     * 定点换掉一个账号的令牌版本与当前会话 id(V125)。
     *
     * **为什么不复用 reload()**:reload 的第一件事是 {@code elevations.revokeAllUsers()} ——
     * 登录是高频动作,每次登录都清掉所有人的提权授权,等于随便谁登录一次全公司都要重新叫主管点头。
     * 这里只换一个 entry,只清**这个人自己**的提权,也不重查那四张表。
     *
     * sid 传 null = 这个账号当前没有活着的会话(被踢/登出),此后它的令牌一律不认。
     */
    public synchronized void applySession(String username, int tokenVersion, String sessionId, String reason) {
        // 授权跟着会话走(ELEVATION-SPEC:登出即结束授权)。登录、登出、改密都经过这里 —— 会话一换,
        // 主管给的临时授权作废。原来授权按账号存、熬过登出与重登,只靠前端发一次即发即弃的
        // DELETE /auth/elevate,而那一发根本没带令牌(安全审计 F88 / F01)。
        elevations.revokeAll(username);
        UserAuth cur = snapshot.get(username);
        if (cur == null) return;   // 停用/不存在的账号不进快照,也就没有会话可言
        Map<String, UserAuth> next = new HashMap<>(snapshot);
        next.put(username, cur.withSession(tokenVersion, sessionId, reason));
        snapshot = Map.copyOf(next);
    }

    /**
     * 持有全部这些权限点的启用账号 —— 远程授权的候选人名单（设计稿 §07）。
     *
     * 快照本来就在内存里，这里只是给它开一个**收窄的**出口：
     * 只按传入的权限点筛，不返回全量用户表。它是个信息泄露口（谁都能拿它枚举「谁是主管」），
     * 内部系统可接受，但不要放宽成「列出所有人」。
     */
    public java.util.List<String> holdersOf(java.util.List<String> perms) {
        return snapshot.values().stream()
            .filter(u -> u.perms().containsAll(perms))
            .map(UserAuth::username)
            .sorted()
            .toList();
    }
}
