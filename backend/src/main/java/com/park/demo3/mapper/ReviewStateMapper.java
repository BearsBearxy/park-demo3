package com.park.demo3.mapper;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.park.demo3.entity.ReviewState;
import java.util.List;

public interface ReviewStateMapper extends BaseMapper<ReviewState> {

    /** 某月全部审核键的落库行。没有行 = 该键处于派生态「录入中」。 */
    default List<ReviewState> byPeriod(String period) {
        return selectList(new QueryWrapper<ReviewState>().eq("period", period));
    }

    /**
     * 某一年 12 个月的落库行(period 前四位匹配)。
     *
     * 与 byPeriod 的分工:byPeriod 喂 ReviewService.list(),那条要凑齐**全部键**(含没落库的
     * 派生态)所以得先跑一遍 dataHome.overview(period) 拿公司数/期区数;这一条只发**已经落库的行**,
     * 不跑聚合 —— 编辑闸只关心「这把键锁没锁」,没有行就是没锁,不需要知道全集。
     * 年表屏(附6/7/8/11、附13/14)一屏要 12 个月,走 byPeriod 那条等于跑 12 遍首页聚合。
     *
     * 用 likeRight 而不是 between:period 是 CHAR(7) 定长,`2025-` 前缀匹配等价于该年全集,
     * 且能吃上 idx_review_period 的最左前缀。
     */
    default List<ReviewState> byYear(int year) {
        return selectList(new QueryWrapper<ReviewState>().likeRight("period", year + "-"));
    }

    /**
     * 某个 kind(+scope) 的全部月份,按期升序。
     * 跨月写(rechain、参数默认行)要靠它反查「有没有已审月」—— 见计划裁定 R-2 / R-4。
     */
    // ⚠ 这里的 orderByAsc("period") **杀不死**:主键是 `kind[:scope]:period`,限定在同一个
    //   (kind, scope) 内主键的字典序恒等于期序,InnoDB 全扫又按主键序返回 —— 去掉 ORDER BY,
    //   ReviewGuardIT 的两条相关断言照样绿(2026-09-07 实测)。留着是为了不依赖这个实现细节:
    //   ReviewGuard.assertNoLockedMonth 的「点名最早那个月」整个建立在这个顺序上,
    //   哪天主键改形状(比如换成自增 id + 唯一索引),没有 ORDER BY 就会静默说错月份而无人发现。
    default List<ReviewState> byKindAndScope(String kind, String scope) {
        QueryWrapper<ReviewState> q = new QueryWrapper<ReviewState>().eq("kind", kind);
        if (scope == null) q.isNull("scope"); else q.eq("scope", scope);
        return selectList(q.orderByAsc("period"));
    }
}
