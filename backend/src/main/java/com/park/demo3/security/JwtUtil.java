package com.park.demo3.security;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.util.Date;
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
    public String generate(String username) {
        Date now = new Date();
        return Jwts.builder().subject(username).issuedAt(now)
                .expiration(new Date(now.getTime() + expireMs)).signWith(key).compact();
    }
    public String validateAndGetSubject(String token) {
        return Jwts.parser().verifyWith(key).build().parseSignedClaims(token).getPayload().getSubject();
    }
}
