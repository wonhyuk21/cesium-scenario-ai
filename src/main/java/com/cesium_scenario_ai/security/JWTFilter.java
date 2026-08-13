package com.cesium_scenario_ai.security;

import java.io.IOException;

import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;

import com.cesium_scenario_ai.entity.User;
import com.cesium_scenario_ai.entity.UserRole;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

@Slf4j
@RequiredArgsConstructor
public class JWTFilter extends OncePerRequestFilter {
	
	private final JWTUtil jwtUtil;
	
	@Override
	protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain filterChain) throws ServletException, IOException {
		
		// Authorization 헤더에서 JWT 토큰 추출
		String authorizationHeader = request.getHeader("Authorization");
		
		if(authorizationHeader == null || !authorizationHeader.startsWith("Bearer ")) {
			filterChain.doFilter(request, response);
			return;
		}
		
		// "Bearer "이후의 토큰 값만 추출
		String token = authorizationHeader.substring(7);
		
		try {
            // JWT 만료 여부 검증
            if (jwtUtil.isTokenExpired(token)) {
                response.sendError(HttpServletResponse.SC_UNAUTHORIZED, "JWT 토큰이 만료되었습니다.");
                return;
            }
    		
    		// JWT에서 사용자 정보 추출
    		String username = jwtUtil.getUsername(token);
    		UserRole role = UserRole.valueOf(jwtUtil.getRole(token));
    		
            // 인증 객체 생성
            User user = User.builder()
                    .username(username)
                    .password("N/A") // 비밀번호는 JWT 기반 인증이므로 사용하지 않음
                    .role(role)
                    .build();
            
            CustomUserDetails customUserDetails = new CustomUserDetails(user);
            Authentication authToken = new UsernamePasswordAuthenticationToken(customUserDetails, null, customUserDetails.getAuthorities());
           
            // SecurityContext에 인증 정보 저장
            if(SecurityContextHolder.getContext().getAuthentication() == null) {
            	SecurityContextHolder.getContext().setAuthentication(authToken);
            }
		} catch(Exception e) {
			log.error("JWT필터 처리 중 오류 발생: {}", e.getMessage(), e);
			response.sendError(HttpServletResponse.SC_UNAUTHORIZED, "유효하지 않은 토큰입니다.");
		}

		filterChain.doFilter(request, response);
		
	}
	
	
}
