package com.cesium_scenario_ai.controller;

import java.util.Map;

import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.cesium_scenario_ai.service.GeminiService;
import com.cesium_scenario_ai.service.VworldService;

import lombok.RequiredArgsConstructor;

@RestController
@RequiredArgsConstructor
public class ApiController {
	
	private final GeminiService geminiService;
	private final VworldService vworldService;
	
	@PostMapping("/api/gemini")
	public ResponseEntity<String> Ask(@RequestBody Map<String, String> body) throws Exception {		// post - RequestBody, Map - { "message": "서울역" }
		
		String message = body.get("message");
		String result = geminiService.fetchAsk(message);
		System.out.println("***********ApiController 파싱 후 반환 완료");
		return ResponseEntity.ok().contentType(MediaType.APPLICATION_JSON).body(result);
	}
	
	@GetMapping("api/vworld")
	public ResponseEntity<String> search(@RequestParam String place) {
		String result = vworldService.searchPlace(place);
		
		return ResponseEntity.ok().contentType(MediaType.APPLICATION_JSON).body(result);
	}
	
}
