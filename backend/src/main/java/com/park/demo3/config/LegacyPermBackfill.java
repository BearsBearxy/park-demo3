package com.park.demo3.config;

import com.park.demo3.security.Perm;
import com.park.demo3.security.UserPermissionCache;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.annotation.Order;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.datasource.init.ResourceDatabasePopulator;
import org.springframework.stereotype.Component;

import javax.sql.DataSource;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

/**
 * 启动时把 V140 的正文再跑一遍,然后刷新权限快照(RBAC-SPEC §15.8「启动时补一次新键」)。
 *
 * 为什么要:V140 是版本化迁移,只跑一次;而 0.32 的代码保存角色是整组替换、丢掉它不认识的键。
 * 回滚到 0.32 期间有人在角色屏存过的角色只剩旧键,再升回 0.33 时 V140 已记在 flyway 历史里不会再跑,
 * 这个角色的人登进去什么都看不到。开发期同理:同一个开发库上另有人跑 master,他存一次角色,本分支看到的就是空角色。
 *
 * **只碰还有纯旧键的角色**:两条 INSERT 的 `FROM auth_role_perm p` 后面各接一个 JOIN,限定到至少还有一行
 * {@link Perm#LEGACY_LABELS} 键(23 个,新代码一个都不认)的角色。不加这道的话会越权:`salary:view` / `salary:edit`
 * 新旧同名、也在 V140 第①步的旧键表里,0.33 里存过的角色只要勾了工资,每次启动都被补上「本月出账 · 查看」「导入中心 · 查看」,
 * 管理员取消了下次重启又回来。库里还有纯旧键行 ⇔ 这个角色从上次在 0.32 保存以来没在 0.33 存过(0.33 一存旧键就删光),
 * 这时它的新键本来就该等于从旧键推出来的那一组,重跑只会补上缺的。
 * 代价:回滚期间在 0.32 新建、只勾了工资的角色(没有别的旧键)补不到本月出账与导入中心的查看 —— 少给不多给,管理员补勾即可。
 *
 * V140 正文仍是唯一一份映射表,这里只按精确字符串插 JOIN,命中次数不对就启动失败(V140 的校验和钉死了正文,不会悄悄变)。
 * 不用 Flyway 的 R__ 可重复迁移:它只在文件校验和变了时才重跑,回滚再升级时文件没变。
 */
@Slf4j
@Component
@Order(10)   // 早于 BookSeeder(20)与 AdminInitializer(不排序,最后);都不依赖它,只保持确定顺序
public class LegacyPermBackfill implements ApplicationRunner {
    static final String SCRIPT = "db/common/V140__rbac_screen_perms.sql";
    private static final Pattern FROM = Pattern.compile("FROM auth_role_perm p(\\r?\\n)");

    private final DataSource dataSource;
    private final UserPermissionCache cache;

    public LegacyPermBackfill(DataSource dataSource, UserPermissionCache cache) {
        this.dataSource = dataSource; this.cache = cache;
    }

    /** V140 正文,两条 INSERT 都只对还有纯旧键的角色生效。 */
    static String guardedScript() {
        String sql;
        try {
            sql = new ClassPathResource(SCRIPT).getContentAsString(StandardCharsets.UTF_8);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
        String legacy = Perm.LEGACY_LABELS.keySet().stream().filter(k -> !Perm.exists(k)).sorted()
            .map(k -> "'" + k + "'").collect(Collectors.joining(", "));
        Matcher m = FROM.matcher(sql);
        StringBuilder out = new StringBuilder();
        int hits = 0;
        while (m.find()) {
            hits++;
            m.appendReplacement(out, Matcher.quoteReplacement("FROM auth_role_perm p" + m.group(1)
                + "JOIN (SELECT DISTINCT role_id FROM auth_role_perm WHERE perm IN (" + legacy + ")) lg ON lg.role_id = p.role_id"
                + m.group(1)));
        }
        m.appendTail(out);
        if (hits != 2) throw new IllegalStateException(SCRIPT + " 里「FROM auth_role_perm p」应恰好 2 处,实际 " + hits);
        return out.toString();
    }

    @Override
    public void run(ApplicationArguments args) {
        ResourceDatabasePopulator p = new ResourceDatabasePopulator(
            new ByteArrayResource(guardedScript().getBytes(StandardCharsets.UTF_8)));
        p.setSqlScriptEncoding("UTF-8");
        p.execute(dataSource);
        cache.reload();
        log.info("legacy permission keys backfilled from {}", SCRIPT);
    }
}
