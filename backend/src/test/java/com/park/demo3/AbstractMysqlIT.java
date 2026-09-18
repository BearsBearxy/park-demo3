package com.park.demo3;

import com.github.dockerjava.api.DockerClient;
import com.github.dockerjava.api.model.Container;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.DockerClientFactory;
import org.testcontainers.containers.MySQLContainer;
import org.testcontainers.utility.TestcontainersConfiguration;

import java.util.Comparator;
import java.util.List;
import java.util.Map;

// ponytail: no @Testcontainers/@Container — singleton start keeps the container alive
//           across all test classes in one JVM run; Ryuk cleans it at JVM exit.
//           Per-class @Container would stop MYSQL after WebLayerIT, breaking AuthIT.
@SpringBootTest
public abstract class AbstractMysqlIT {
    private static final String IT_LABEL = "demo3.it";

    // ponytail: 600s timeout for Docker Desktop/WSL2 Windows where MySQL 8.0
    //           first-run init can take 4-5 min; reduce if environment is faster
    //
    // withReuse:容器跑完不销毁,下次 JVM 起来直接连上去。没有它,每次 mvnw test 都要
    // 「新起空库 + 跑完 V1..V112 迁移 + 塞种子」才轮到第一条断言 —— 实测跑 1 个测试方法
    // 与跑全量 766 条同样要 8-9 分钟,代价几乎全在这段启动上。开了之后首次照旧、之后十几秒。
    //
    // ⚠ 代价:库的状态会在多次运行之间留下来。没有 @Transactional、靠自己清理的用例
    //    (LedgerApiIT 等)若某次跑到一半失败留下残渣,下次可能红 —— 「单独跑绿、连着跑红」。
    //    真遇到就给那个类补 @Transactional,别把这个开关关掉。
    // ⚠ 开关在本机 ~/.testcontainers.properties 的 testcontainers.reuse.enable=true,
    //    **不进仓库**:CI 每次都该是全新库,不该复用。那边没这行,withReuse 自动降级为不复用。
    static final MySQLContainer<?> MYSQL = new MySQLContainer<>("mysql:8.0")
            .withDatabaseName("park_demo3")
            .withStartupTimeoutSeconds(600)
            .withLabel(IT_LABEL, "mysql")
            .withReuse(true);

    static {
        boolean reuse = TestcontainersConfiguration.getInstance().environmentSupportsReuse();
        DockerClient docker = reuse ? DockerClientFactory.instance().client() : null;
        String adopted = reuse ? startNewestStopped(docker) : null;
        try {
            MYSQL.start();
        } catch (RuntimeException e) {
            // 接上的旧库起不来(比如断电把数据目录弄坏了):删掉它,下次就新建,别每次都卡在它身上
            if (adopted != null) remove(docker, adopted);
            throw e;
        }
        if (reuse) removeLeftovers(docker, adopted);
    }

    // 复用只认「正在跑」的容器(Testcontainers 按配置指纹 + running 找)。电脑或 Docker 一重启,
    // 测试库就停了 → 下次新建一个、停着的旧库永远没人删(08-26 到 09-12 攒了 9 个)。
    // 所以起库前先把最新的那个停着的开起来让它接上,起完再删掉其余停着的。
    // ponytail: 按创建时间挑最新的,不比指纹;配置改过时开起来的旧库对不上,多一次 MySQL 冷启动,
    //           起完随其余一起删。
    // 接库、删库只是打扫:Docker 报什么错都吞掉,不许因为它让整批测试挂掉。
    private static String startNewestStopped(DockerClient docker) {
        try {
            return ours(docker).stream()
                    .filter(c -> "exited".equals(c.getState()))
                    .max(Comparator.comparing(Container::getCreated))
                    .map(c -> {
                        docker.startContainerCmd(c.getId()).exec();
                        return c.getId();
                    })
                    .orElse(null);
        } catch (RuntimeException e) {
            return null;
        }
    }

    /** 删停着的,和开起来却没接上的那个;别的正在跑的不碰(可能是另一个 JVM 在用)。连数据卷一起删。 */
    private static void removeLeftovers(DockerClient docker, String adopted) {
        List<Container> all;
        try {
            all = ours(docker);
        } catch (RuntimeException e) {
            return;
        }
        for (Container c : all) {
            if (c.getId().equals(MYSQL.getContainerId())) continue;
            if (c.getId().equals(adopted) || "exited".equals(c.getState())) remove(docker, c.getId());
        }
    }

    private static void remove(DockerClient docker, String id) {
        try {
            docker.removeContainerCmd(id).withForce(true).withRemoveVolumes(true).exec();
        } catch (RuntimeException ignored) {
            // 另一个 JVM 抢先删了之类,不影响本次
        }
    }

    private static List<Container> ours(DockerClient docker) {
        return docker.listContainersCmd().withShowAll(true).withLabelFilter(Map.of(IT_LABEL, "mysql")).exec();
    }

    @DynamicPropertySource
    static void props(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", MYSQL::getJdbcUrl);
        r.add("spring.datasource.username", MYSQL::getUsername);
        r.add("spring.datasource.password", MYSQL::getPassword);
        r.add("app.jwt.secret", () -> "test-secret-test-secret-test-secret-32");
        // 钉死只读账号口令:RoleApiIT 硬编码 viewer123,不受宿主机 VIEWER_PASSWORD 环境变量影响
        r.add("app.viewer.password", () -> "viewer123");
    }
}
