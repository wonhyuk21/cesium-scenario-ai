package com.cesium_scenario_ai.security;

import java.nio.charset.StandardCharsets;
import java.util.Date;

import javax.crypto.SecretKey;
import javax.crypto.spec.SecretKeySpec;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import io.jsonwebtoken.Jwts;

@Component
public class JWTUtil {
	
	private final SecretKey secretKey;
	
	/*
	 * 생성자에서 application.properties에 저장된 SecretKey 값을 가져와 설정
	 */
	public JWTUtil(@Value("${spring.jwt.secret}") String secret) {
		secretKey = new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), Jwts.SIG.HS256.key().build().getAlgorithm());
	}
	
	/*
	 * JWT에서 username 추출
	 */
	public String getUsername(String token) {
		return Jwts.parser()
				.verifyWith(secretKey)
				.build()
				.parseClaimsJws(token)
				.getPayload()
				.get("username", String.class);
	}
	
	/*
	 * JWT에서 Role(권한) 추출
	 */
	public String getRole(String token) {
		return Jwts.parser()
				.verifyWith(secretKey)
				.build()
				.parseClaimsJws(token)
				.getPayload()
				.get("role", String.class);
	}
	
	/*
	 * JWT 만료 여부 확인
	 */
	public Boolean isTokenExpired(String token) {
		return Jwts.parser()
				.verifyWith(secretKey)
				.build()
				.parseClaimsJws(token)
				.getPayload()
				.getExpiration()
				.before(new Date());
	}
	
	/*
	 * JWT 생성 -> username, role(권한), 만료시간(expiredMs)을 포함한 JWT 발급
	 */
	public String createJwt(String username, String role, Long expiredMs) {
		return Jwts.builder()
				.claim("username", username)
				.claim("role", role)
				.issuedAt(new Date(System.currentTimeMillis())) // 발급 시간
				.expiration(new Date(System.currentTimeMillis() + expiredMs)) // 만료 시간
				.signWith(secretKey) // 비밀키를 사용하여 서명
				.compact();
	}
}
