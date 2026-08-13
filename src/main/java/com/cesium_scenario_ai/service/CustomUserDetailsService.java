package com.cesium_scenario_ai.service;



import java.util.Optional;

import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.stereotype.Service;

import com.cesium_scenario_ai.entity.User;
import com.cesium_scenario_ai.repository.UserRepository;
import com.cesium_scenario_ai.security.CustomUserDetails;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

@Slf4j
@Service
@RequiredArgsConstructor
public class CustomUserDetailsService implements UserDetailsService {	// 사용자 정보 가져오기

	private final UserRepository userRepository;
	
	/*
	 * username을 이용해 사용자 정보를 조회
	 */
    @Override
    public UserDetails loadUserByUsername(String username) throws UsernameNotFoundException {
        Optional<User> userOptional = userRepository.findByUsername(username);

        // 사용자가 존재하지 않을 경우 예외 throw
        User user = userOptional.orElseThrow(() -> {
            log.warn("사용자를 찾을 수 없습니다: username={}", username);
            return new UsernameNotFoundException("사용자를 찾을 수 없습니다: " + username);
        });

        return new CustomUserDetails(user);
	}
	
	
	
}
