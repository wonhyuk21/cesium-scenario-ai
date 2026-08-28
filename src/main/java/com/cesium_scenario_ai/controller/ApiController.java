package com.cesium_scenario_ai.controller;

import java.util.Map;

import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import com.cesium_scenario_ai.service.GeminiService;

@RestController
public class ApiController {
	
	private final GeminiService geminiService = new GeminiService();
	
	@PostMapping("/api/gemini")
	public ResponseEntity<String> Ask(@RequestBody Map<String, String> body) throws Exception {		// post - RequestBody, Map - { "message": "서울역" }
		
		String message = body.get("message");
		String result = geminiService.fetchAsk(message);
		return ResponseEntity.ok().contentType(MediaType.APPLICATION_JSON).body(result);
	}
	
}
