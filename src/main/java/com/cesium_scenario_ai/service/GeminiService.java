package com.cesium_scenario_ai.service;

import java.util.HashMap;
import java.util.Map;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;

import tools.jackson.databind.ObjectMapper;

@Service
public class GeminiService {
	
	@Value("${gemini.api-key}")
	private String apiKey;
	
	private final RestClient restClient = RestClient.create();			// HTTP 요청을 보내는 도구
	private final ObjectMapper objectMapper = new ObjectMapper();		// JSON 문자열 <-> Java 객체를 변환해주는 도구

	public String fetchAsk(String message) {
		String url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key="
				+ apiKey;
		
		Map<String, Map<String, String>> parseMessage = new HashMap<>();
		// parseMessage = objectMapper.writeValueAsString(message);
		
		String response = restClient.post().uri(url).contentType(MediaType.APPLICATION_JSON)
				.body(message).retrieve().body(String.class);
		return response;
	}
	
	
}
