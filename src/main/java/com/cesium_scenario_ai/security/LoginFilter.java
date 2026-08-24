package com.cesium_scenario_ai.security;

import java.io.IOException;
import java.util.Collection;
import java.util.Iterator;
import java.util.Map;

import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;

import jakarta.servlet.FilterChain;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import tools.jackson.databind.ObjectMapper;

public class LoginFilter extends UsernamePasswordAuthenticationFilter {
	
	private final AuthenticationManager authenticationManager;
	private final JWTUtil jwtUtil;
	
	public LoginFilter(AuthenticationManager authenticationManager, JWTUtil jwtUtil) {
        this.authenticationManager = authenticationManager;
        this.jwtUtil = jwtUtil;
        setFilterProcessesUrl("/api/auth/login");
	}
	/*
	 * 로그인 요청 시 사용자 인증 처리
	 */
	@Override
	public Authentication attemptAuthentication(HttpServletRequest req, HttpServletResponse res) throws AuthenticationException {
		ObjectMapper objectMapper = new ObjectMapper();
		Map<String, String> credentials;
		
		try {
			credentials = objectMapper.readValue(req.getInputStream(), Map.class);
		} catch (IOException e) {
			throw new RuntimeException(e);
		}
		String username = credentials.get("username");
		String password = credentials.get("password");
		
		System.out.println("=======username : " + username);
		System.out.println("=======password : " + password);
		UsernamePasswordAuthenticationToken authRequest = new UsernamePasswordAuthenticationToken(username, password);
		
		// Spring Security가 DB에서 사용자를 조회하고, 비밀번호 해시를 비교해 맞으면 인증완료된 Authentication 반환
		return authenticationManager.authenticate(authRequest);
	}
	
	/*
	 * 로그인 성공 시 JWT 토근 발급
	 */
	@Override
	protected void successfulAuthentication(HttpServletRequest req, HttpServletResponse res, FilterChain chain, Authentication auth) {
		// 인증된 사용자의 username을 불러옴
		CustomUserDetails customUserDetails = (CustomUserDetails) auth.getPrincipal();
		String username = customUserDetails.getUsername();
		
		// 사용자가 하나 이상의 권한을 가질 수도 있으므로 컬렉션을 반환
		Collection<? extends GrantedAuthority> authorities = auth.getAuthorities();
		// 컬렉션 반복자 생성
		Iterator<? extends GrantedAuthority> iterator = authorities.iterator();
		// 그 중 첫번째 요소 꺼냄
		GrantedAuthority authority = iterator.next();
		
		String role = authority.getAuthority();
		String token = jwtUtil.createJwt(username, role, 60 * 60 * 1000L);	// 1시간 동안 유효 토큰 생성
		res.addHeader("Authorization", "Bearer " + token); 					// JWT를 Authorization 헤더에 추가	
	}
	
    /**
     * 로그인 실패 시 401 응답 반환
     */
    @Override
    protected void unsuccessfulAuthentication(HttpServletRequest req, HttpServletResponse res, AuthenticationException failed) {
    	System.out.println("=======로그인 실패 원인: " + failed.getClass().getSimpleName() + " - " + failed.getMessage());
    	res.setStatus(HttpServletResponse.SC_UNAUTHORIZED); // 401 Unauthorized 응답
        try {
        	res.getWriter().write("아이디 또는 비밀번호가 올바르지 않습니다");
        } catch(IOException e) {
        	throw new RuntimeException(e);
        }
    }
}
