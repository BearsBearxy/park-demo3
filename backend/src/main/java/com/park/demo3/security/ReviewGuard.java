package com.park.demo3.security;

import com.park.demo3.common.BizException;
import com.park.demo3.common.ResultCode;
import com.park.demo3.entity.ReviewState;
import com.park.demo3.mapper.ReviewStateMapper;
import org.springframework.stereotype.Component;

import java.util.Collection;
import java.util.Optional;
import java.util.Set;
import java.util.TreeSet;

/**
 * 审核态的写路径闸(SIDEBAR-UX-REDESIGN §7.4)。**已审核 / 待审核的表,任何写入口一律拒。**
 *
 * 为什么落在 service 层而不是 PermissionRegistry:提权是在 WriteAccessManager.check() 里
 * 放行的,权限表拦不住它;而 service 之间互调(ParamService.recalc → AllocService.generate)
 * 根本不过 controller。§7.3「主管接管锁、当场提权都过不去」只有在 service 层才成立。
 *
 * 形状照 BookService.assertMonthEditable(P6 录入即冻结):assertXxx 动词开头 / 只判一次 /
 * 不满足就抛 BizException / **不返回布尔**(返回布尔等于让每个调用点自己决定怎么处理,必漏一处) /
 * 文案把期次拼进去。
 *
 * 三个入口对应三种写形状,不要给第四种:
 *  · assertEditable(kind, period, scope)   —— 单月写。绝大多数方法用它。
 *  · assertEditable(kind, periods, scope)  —— 一批落在多个月上(导入逐行带月 / 整年清空 / 改月的读数)。
 *  · assertNoLockedMonth(kind, scope)      —— 拿不到被写月的跨月写(参数长期默认行)。
 */
@Component
public class ReviewGuard {

    /** 落库三态里这两个锁写;returned 只是留痕,可编辑性等同「录入中」(§7.2)。 */
    private static final Set<String> LOCKING = Set.of("submitted", "approved");

    private final ReviewStateMapper states;

    public ReviewGuard(ReviewStateMapper states) { this.states = states; }

    public void assertEditable(ReviewKind kind, String period, String scope) {
        ReviewKey key = ReviewKey.of(kind, scope, period);   // 顺手把 period 格式与 scope 形状校验了
        ReviewState s = states.selectById(key.raw());
        if (s != null && LOCKING.contains(s.getStatus())) throw locked(key, s);
    }

    /**
     * 一批写落在多个月上时,**每个月都要判**;文案点名最早的锁月,让用户先去处理它。
     *
     * ⚠ TreeSet 不是随手挑的:YYYY-MM 的字典序就是时间序,靠它保证「点名最早」。换成 HashSet
     * 会变成「点名集合里碰巧第一个」,用户被指去处理一个不相干的月份。
     */
    public void assertEditable(ReviewKind kind, Collection<String> periods, String scope) {
        for (String p : new TreeSet<>(periods)) assertEditable(kind, p, scope);
    }

    /**
     * 拿不到被写月时的兜底闸:该 kind(+scope)下存在任一被锁月就整体拒。
     *
     * ponytail: 比「只拒被影响的那些月」粗。用在计费参数的长期默认行(acctMonth='')与
     *   AllocService 的长期规则行上 —— 它们是「所有未被月度行覆盖的月」的取值来源,
     *   压根没有「被写月」这个概念,放它过去等于给已审月开后门。
     *   代价:该 kind 一旦有一个月审过,默认行就锁死。升级路径:等能算出「这一改影响哪些月」
     *   的区间之后换成批量闸(from 行那半边已经能用 VersionResolver.nextFrom 算了)。
     */
    public void assertNoLockedMonth(ReviewKind kind, String scope) {
        Optional<ReviewState> first = states.byKindAndScope(kind.code(), scope).stream()
            .filter(s -> LOCKING.contains(s.getStatus())).findFirst();   // byKindAndScope 已按 period 升序
        first.ifPresent(s -> { throw locked(ReviewKey.of(kind, scope, s.getPeriod()), s); });
    }

    private BizException locked(ReviewKey key, ReviewState s) {
        boolean approved = "approved".equals(s.getStatus());
        String who  = approved ? s.getReviewedBy() : s.getSubmittedBy();
        String when = approved
            ? (s.getReviewedAt()  == null ? "" : s.getReviewedAt().toLocalDate().toString())
            : (s.getSubmittedAt() == null ? "" : s.getSubmittedAt().toLocalDate().toString());
        String state = approved ? "已审核" : "待审核";
        String tail  = approved ? ",撤销审核后才能修改" : ",审核员处理后才能修改";
        return new BizException(ResultCode.LOCKED,
            key.human() + " " + state
            + (who == null || who.isBlank() ? "" : "(" + who + (when.isEmpty() ? "" : " " + when) + ")")
            + tail);
    }
}
