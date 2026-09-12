package com.park.demo3.security;
import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.util.Date;

/**
 * 令牌带四样:用户名(sub)、角色(role,V32 遗留,只供展示)、令牌版本(tv)、会话 id(sid)。
 *
 * **权限仍然不烤进去**(RBAC-SPEC v2 §5.5):烤进去的话改了权限要等 120 分钟才生效。
 * tv 与 sid 可以烤,因为它们是**签发时刻的身份**,不是会随时间变化的授权 ——
 * 它们的作用正是让服务端认出「这张是旧的」。
 */
@Component
public class JwtUtil {
    private final SecretKey key;
    private final long expireMs;
    public JwtUtil(@Value("${app.jwt.secret}") String secret,
                   @Value("${app.jwt.expire-minutes}") long expireMinutes) {
        if (secret == null || secret.getBytes(StandardCharsets.UTF_8).length < 32)
            throw new IllegalStateException("app.jwt.secret must be >= 32 bytes");
        this.key = Keys.hmacShaKeyFor(secret.getBytes(StandardCharsets.UTF_8));
        this.expireMs = expireMinutes * 60_000L;
    }
    public long expireMs() { return expireMs; }

    public String generate(String username, String role, int tokenVersion, String sessionId) {
        Date now = new Date();
        return Jwts.builder().subject(username).claim("role", role)
                .claim("tv", tokenVersion).claim("sid", sessionId)
                .issuedAt(now).expiration(new Date(now.getTime() + expireMs)).signWith(key).compact();
    }
    public Claims validateAndGetClaims(String token) {
        return Jwts.parser().verifyWith(key).build().parseSignedClaims(token).getPayload();
    }

    /** 令牌里的 tv。老令牌(V125 之前签的)没有这个 claim → 给 -1,必与任何真实版本不等 → 拒绝。 */
    public static int tokenVersionOf(Claims c) {
        Object v = c.get("tv");
        return v instanceof Number n ? n.intValue() : -1;
    }
    /** 令牌里的 sid;老令牌没有 → null。 */
    public static String sessionIdOf(Claims c) {
        Object v = c.get("sid");
        return v instanceof String s && !s.isBlank() ? s : null;
    }
}
