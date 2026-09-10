package com.cesium_scenario_ai.service;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.client.RestClient;

@Service
public class TmapService {
	
	@Value("${tmap.app-key}")
	private String appKey;
	
	private final RestClient restClient = RestClient.create();
	
	public String findPedestrianRoute(double startX, double startY, double endX, double endY, String startName,
			String endName) {
		String url = "https://apis.openapi.sk.com/tmap/routes/pedestrian?version=1";
		
		// 명세서에 명시되어있는 코드타입: form -> 이 형식으로 자동 인코딩 해주는 표준 타입 사용(MultiValueMap)
		MultiValueMap<String, String> form = new LinkedMultiValueMap<>();
		form.add("startX", String.valueOf(startX));
		form.add("startY", String.valueOf(startY));
		form.add("endX", String.valueOf(endX));
		form.add("endY", String.valueOf(endY));
		form.add("startName", startName);
		form.add("endName", endName);
		
		String response = restClient.post().uri(url).header("appKey", appKey).contentType(MediaType.APPLICATION_FORM_URLENCODED)
				.body(form).retrieve().body(String.class);
		System.out.println("******************* T맵 응답 확인: " + response);
		return response;
	}

	
}
