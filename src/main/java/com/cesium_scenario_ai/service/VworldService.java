package com.cesium_scenario_ai.service;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;

@Service
public class VworldService {

	@Value("${vworld.api-key}")
	private String apiKey;
	
	private final RestClient restClient = RestClient.create();
	
	public String searchPlace(String place) {
		String url = "https://api.vworld.kr/req/search?key="
				+ apiKey
				+ "&request=search&query="
				+ place
				+ "&type=place";
		
		String response = restClient.get().uri(url).retrieve().body(String.class);
		return response;
	}
	
	
}
