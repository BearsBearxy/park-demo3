package com.park.demo3.service;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.park.demo3.dto.NoticeDtos.NoticeDTO;
import com.park.demo3.dto.NoticeDtos.SystemSeenDTO;
import com.park.demo3.entity.AuthUser;
import com.park.demo3.entity.UserNotice;
import com.park.demo3.entity.UserSeen;
import com.park.demo3.mapper.AuthUserMapper;
import com.park.demo3.mapper.UserNoticeMapper;
import com.park.demo3.mapper.UserSeenMapper;
import com.park.demo3.security.NoReviewGuard;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * 铃铛「有结果了」(PAGE-BEHAVIOR-SPEC §5.1 第二步)与系统类「看过」(§5.3 末行)。
 *
 * 写入点在各业务 service 里调 {@link #add}:它跟着调用方的事务走,业务回滚消息也回滚。
 * 打开铃铛 = {@link #markSeen} 把本人全部置已看;心跳带 {@link #unseenCount} 回去算蓝点。
 */
@Service
public class NoticeService {

    /** 每人只留最近这么多条(§5.1「只留最近 30 条」)。 */
    public static final int KEEP = 30;

    /** 消息种类。常量名就是落库值,前端按它选图标。 */
    public enum Kind {
        review_approved,     // 你交的表审核通过(→ 交审人)
        review_withdrawn,    // 审核被撤销,detail = 理由(→ 交审人、不是本人的原审核人)
        approval_approved,   // 你请的远程授权批准了(→ 请求者)
        approval_rejected,   // 你请的远程授权被拒绝(→ 请求者)
        approval_timeout,    // 你请的远程授权超时(→ 请求者;本人撤回的不算)
        bill_unconfirmed,    // 你确认的催缴单被取消确认,detail = 理由(→ 原确认人)
        bill_voided,         // 你确认的催缴单被作废,detail = 理由(→ 原确认人)
        perms_changed        // 你的角色或权限被改了,detail「刷新后生效」(→ 持该角色的人 / 被改的人)
    }

    private final UserNoticeMapper notices;
    private final UserSeenMapper seen;
    private final AuthUserMapper users;

    public NoticeService(UserNoticeMapper notices, UserSeenMapper seen, AuthUserMapper users) {
        this.notices = notices; this.seen = seen; this.users = users;
    }

    /**
     * 给 to 写一条。to 是当前操作人自己时不写 —— 自己刚做完的事是结果回执,不是通知。
     * actor 取当前登录人;没有登录上下文(授权到期回调)时为 null = 系统。
     */
    public void add(String to, Kind kind, String title, String detail, String ref) {
        String actor = currentUser();
        if (to == null || to.isBlank() || to.equals(actor)) return;
        insert(to, kind, title, detail, ref, actor);
    }

    /**
     * 系统造成的(授权到期回调):actor 记 null,也不按「发给自己跳过」判 ——
     * 到期清扫跑在某个人的心跳请求里,那个人恰好就是请求者时,add 会把它当成「自己做的」吞掉。
     */
    public void addAsSystem(String to, Kind kind, String title, String detail, String ref) {
        if (to == null || to.isBlank()) return;
        insert(to, kind, title, detail, ref, null);
    }

    private void insert(String to, Kind kind, String title, String detail, String ref, String actor) {
        UserNotice n = new UserNotice();
        n.setUsername(to);
        n.setKind(kind.name());
        n.setTitle(clip(title, 200));
        n.setDetail(clip(detail, 500));
        n.setRef(clip(ref, 128));
        n.setActor(actor);
        n.setCreatedAt(LocalDateTime.now());
        notices.insert(n);
        notices.trim(to, KEEP - 1);
    }

    /** 本人最近 30 条,新的在前。 */
    public List<NoticeDTO> list(String me) {
        List<UserNotice> rows = notices.selectList(Wrappers.<UserNotice>lambdaQuery()
            .eq(UserNotice::getUsername, me).orderByDesc(UserNotice::getId).last("LIMIT " + KEEP));
        List<String> actors = rows.stream().map(UserNotice::getActor).filter(a -> a != null).distinct().toList();
        Map<String, String> names = actors.isEmpty() ? Map.of()
            : users.selectList(Wrappers.<AuthUser>lambdaQuery().in(AuthUser::getUsername, actors)).stream()
                .collect(Collectors.toMap(AuthUser::getUsername, u -> u.getDisplayName() == null ? u.getUsername() : u.getDisplayName(), (a, b) -> a));
        return rows.stream().map(n -> new NoticeDTO(n.getId(), n.getKind(), n.getTitle(), n.getDetail(), n.getRef(),
                n.getActor(), n.getActor() == null ? null : names.getOrDefault(n.getActor(), n.getActor()),
                n.getCreatedAt(), n.getSeenAt() != null))
            .toList();
    }

    /** 打开铃铛 = 本人全部看过(§5.3「打开铃铛就消失」)。 */
    @NoReviewGuard(reason = "铃铛已读位,写的是本人的 user_notice.seen_at,不是期间数据")
    public void markSeen(String me) {
        notices.update(null, Wrappers.<UserNotice>lambdaUpdate()
            .set(UserNotice::getSeenAt, LocalDateTime.now())
            .eq(UserNotice::getUsername, me).isNull(UserNotice::getSeenAt));
    }

    public int unseenCount(String me) {
        return Math.toIntExact(notices.selectCount(Wrappers.<UserNotice>lambdaQuery()
            .eq(UserNotice::getUsername, me).isNull(UserNotice::getSeenAt)));
    }

    /** 系统类看过。从没记过 = 两项都 null。 */
    public SystemSeenDTO systemSeen(String me) {
        UserSeen s = seen.selectById(me);
        return s == null ? new SystemSeenDTO(null, null) : new SystemSeenDTO(s.getChangelogVersion(), s.getBellKey());
    }

    /** 传 null 的那一项保持原值:「看看」只写版本号,开铃铛只写 bellKey,互不覆盖。 */
    @NoReviewGuard(reason = "系统类「看过」,写的是本人的 user_seen 一行,不是期间数据")
    public void saveSystemSeen(String me, SystemSeenDTO req) {
        if (req.changelogVersion() == null && req.bellKey() == null) return;
        seen.upsert(me, req.changelogVersion(), req.bellKey());
    }

    private static String currentUser() {
        var a = SecurityContextHolder.getContext().getAuthentication();
        return a == null || a.getName() == null || a.getName().isBlank() ? null : a.getName();
    }

    private static String clip(String s, int max) {
        return s == null || s.length() <= max ? s : s.substring(0, max);
    }
}
