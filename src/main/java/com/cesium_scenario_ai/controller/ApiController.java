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
import com.cesium_scenario_ai.service.TmapService;
import com.cesium_scenario_ai.service.VworldService;

import lombok.RequiredArgsConstructor;

@RestController
@RequiredArgsConstructor
public class ApiController {
	
	private final GeminiService geminiService;
	private final VworldService vworldService;
	private final TmapService tmapService;
	
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
	
	@PostMapping("/api/tmap")
	public ResponseEntity<String> findRoute(@RequestBody Map<String, String> body) throws Exception {
		System.out.println("findRoute로 요청 들어옴===================================");
		double startX = Double.parseDouble(body.get("startX").toString());
		double startY = Double.parseDouble(body.get("startY").toString());
		double endX = Double.parseDouble(body.get("endX").toString());
		double endY = Double.parseDouble(body.get("endY").toString());
		String startName = body.get("startName").toString();
		String endName = body.get("endName").toString();
		
		String result = tmapService.findPedestrianRoute(startX, startY, endX, endY, startName, endName);
		return ResponseEntity.ok().contentType(MediaType.APPLICATION_JSON).body(result);
	}
	
}
