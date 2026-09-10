import { useEffect, useState, useRef } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css'
import * as SunCalc from 'suncalc'
import * as turf from '@turf/turf'
import '../App.css'

function parseJwt(token) {
  const base64Payload = token.split('.')[1]
  const decoded = atob(base64Payload.replace(/-/g, '+').replace(/_/g, '/'))
  return JSON.parse(decoded)
}

// 태양의 방위각(azimuth), 고도각(altitude)을 도(degree) 단위로 계산
function getSunPosition(date, lat, lon) {
  console.log('입력값: ', {date, lat, lon})
  const sunPos = SunCalc.getPosition(date, lat, lon)
  console.log('getSunPosition에서 altitude', sunPos.altitude)
  console.log('getSunPosition에서 azimuth', sunPos.azimuth)
  return {
    altitude: sunPos.altitude,
    azimuth: sunPos.azimuth,
  }
} /* getSunPosition */

// 건물 외곽선과 높이, 태양 위치를 받아 그림자 폴리곤 계산
function calculateShadowPolygon(footprintCoordinates, heightMeters, sunAltitudeDeg, sunAzimuthDeg) {
  // 고도각 0 이하면 그림자 없음 처리
  if(sunAltitudeDeg <= 0) return null

  // 그림자 길이 = 건물높이 / tan(고도각)
  const shadowLength = heightMeters / Math.tan(Cesium.Math.toRadians(sunAltitudeDeg))
  // 그림자 방향 = 방위각 + 180"
  const shadowDirection = (sunAzimuthDeg + 180) % 360
  
  // 건물 외곽선의 각 점을 그림자 방향으로 이동
  const projectedCoords = footprintCoordinates.map(([lon, lat]) => {
    // lon, lat을 기준으로 shadowLength, shadowDirection만큼 떨어진 좌표를 계산
    const projected = turf.destination([lon, lat], shadowLength, shadowDirection, { units: 'meters' })
    return projected.geometry.coordinates
  })

  // 원래 외곽선 점 + 이동된 점을 합쳐서 볼록 껍질(그림자 전체 모양) 계산
  const allPoints = turf.featureCollection(   // 여러개의 점을 하나로 묶음으로 만듬
    [...footprintCoordinates, ...projectedCoords].map((coord) => turf.point(coord))
  )
  // 입력된 점을 모두 감싸는 볼록 껍질 폴리곤 계산
  const shadowHull = turf.convex(allPoints)

  return shadowHull
} /* calculateShadowPolygon */

// 브이월드 wfs 요청
async function loadWorldBuildings(viewer, bbox, isStillLatest, sunPos) {
  const token = localStorage.getItem('token')

  try {
    const response = await fetch(`/api/buildings?bbox=${bbox}`, {
      headers: { Authorization: `Bearer ${token}`},
    })

    if(!response.ok) {
      console.error('건물데이터 요청 실패:', response.status)
      return
    }

    const geoJson = await response.json()
    console.log('geoJson', geoJson)

    // strictMode에서 반환된 함수에 대한 뷰어A를 제거
    // strictMode가 개발 중 마운트 > 언마운트 > 재마운트 시 이전 뷰어 파괴에도 그 뷰어의 fetch의 응답을 막기 위해 사용
    if(viewer.isDestroyed()) return
    // 최신 요청이 더 나갔다면 이 응답은 버림(moveEnd에 대한 fetch)
    if(!isStillLatest()) return

    // 이전 화면 범위의 건물들 지우고 새로 그림(카메라가 이동했기 때문)
    viewer.entities.removeAll()

    // 건물 높이 계산
    geoJson.features.forEach((feature) => {
      const floors = feature.properties.gro_flo_co ?? 1   // 층수가 없으면 기본 1층
      const height = floors * 3                           // 건물 층고를 기본 3m 가정

      // 멀티폴리곤의 첫번째 외곽선 계산
      feature.geometry.coordinates.forEach((polygon) => {
        const outerRing = polygon[0]
        const positions = outerRing.flatMap(([lon, lat]) => [lon, lat])

        viewer.entities.add({
          polygon: {
            hierarchy: Cesium.Cartesian3.fromDegreesArray(positions),
            extrudedHeight: height,
            height: 0,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,              // DEM적용 시 바닥을 실제 지면에 붙임
            extrudedHeightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,   // 지형 표면 기준으로 위로 EXTRUDEDHEIGHT 만큼
            material: Cesium.Color.GRAY.withAlpha(1),
            outline: true,
            outlineColor: Cesium.Color.BLACK,
          },
        })
        // 그림자 계산
        const shadowHull = calculateShadowPolygon(outerRing, height, sunPos.altitude, sunPos.azimuth)

        if(shadowHull === null) return
        shadowHull.geometry.coordinates.forEach((polygon) => {
          const positions = polygon.flatMap(([lon, lat]) => [lon, lat])
          
          // 그림자 뷰어에 add
          viewer.entities.add({
            polygon: {
              hierarchy: Cesium.Cartesian3.fromDegreesArray(positions),
              extrudedHeight: 0,
              height: 0,
              material: Cesium.Color.BLACK.withAlpha(0.9),
              outline: false,
              outlineColor: Cesium.Color.BLACK,
            },
          })
        })
      })
    })
  } catch (error) {
    console.error('브이월드 건물 로드 실패:', error)
  }
} /* loadWorldBuildings */

function App() {
  const [ count, setCount ] = useState(0) 
  const [ user, setUser ] = useState(null)
  const [ timeOffsetHours, setTimeOffsetHours ] = useState(0)
  const [ time, setTime ] = useState(new Date())
  const [ message, setMessage ] = useState('')
  const [ messages, setMessages ] = useState([])
  const [ isLoading, setIsLoading ] = useState(false)
  const [ chatMode, setChatMode ] = useState('idle')
  const [ zoomLevel, setZoomLevel ] = useState(0)
  const [ tiltDeg, setTiltDeg ] = useState(0)
  const [ isChatOpen, setIsChatOpen ] = useState(false)
  const [ isHudOpen, setIsHudOpen ] = useState(false)
  const navigate = useNavigate()
  const viewerRef = useRef(null)
  const cesiumViewerRef = useRef(null)
  const updateFnRef = useRef(() => {})
  const zoomFnRef = useRef(() => {})
  const myLocationMarkerRef = useRef(null)
  const myLocationDataSourceRef = useRef(null)
  const routeDataSourceRef = useRef(null)

  useEffect(() => {
  const token = localStorage.getItem('token')
  if(token) {
    const payload = parseJwt(token)
    setUser({ username: payload.username, role: payload.role })
  }
}, [])

  useEffect(() => {
    // 1초마다 실행되는 타이머 설정
    const timer = setInterval(() => {
      setTime(new Date())
    }, 1000)
    
    // 컴포넌트가 사라질 때 타이머 정리
    return () => clearInterval(timer)
  }, [])

  // 로그아웃 처리
  const handleLogout = () => {
    localStorage.removeItem('token')
    navigate('/')
  }
  
  const handleTiltChange = (value) => {
    setTiltDeg(value)
    const viewer = cesiumViewerRef.current
    if(!viewer || viewer.isDestroyed()) return
    const pitch = -(90 - value)   // value=0 → -90(2D), value=60 → -30(3D)
    viewer.camera.setView({
      orientation: { heading: viewer.camera.heading, pitch: Cesium.Math.toRadians(pitch), roll: 0 },
    })
  }

  // 전달받은 메시지를 브이월드 장소 검색 api를 호출
  async function searchLocation(message) {
    console.log('위치 이동 기능')
    const token = localStorage.getItem('token')

    const response = await fetch(`/api/vworld?place=${message}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    })
    if(!response.ok) return
    const result = await response.json()
    const xcoord = Number(result.response.result.items[0].point.x)
    const ycoord = Number(result.response.result.items[0].point.y)

    const listcoord = [ xcoord, ycoord ]

    return listcoord
  }
  // 줌인 줌아웃 버튼 핸들러
  const handleZoom = (direction) => {
    const viewer = cesiumViewerRef.current
    if(!viewer || viewer.isDestroyed()) return
    const amount = viewer.camera.positionCartographic.height * 0.5
    direction === 'in' ? viewer.camera.zoomIn(amount) : viewer.camera.zoomOut(amount)
  }

  // 위치 이동 기능 선택 시 카메라 좌표 이동
  const moveCamera = (coords) => {
    const viewer = cesiumViewerRef.current
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(coords[0], coords[1], 700),
    });
  }

  // gps버튼 클릭 시 현재 위치로 이동
  const handleGoToMyLocation = () => {
    if(!navigator.geolocation) {
      alert('이 브라우저는 위치 정보를 지원하지 않습니다.')
      return
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { longitude, latitude } = position.coords // 성공시 넘어오는 객체 안에 coords
        moveCamera([longitude, latitude])

        const viewer = cesiumViewerRef.current
        if(viewer && !viewer.isDestroyed()) {
          const dataSource = myLocationDataSourceRef.current

          // 기존에 찍어둔 핀이 있으면 제거
          if(myLocationMarkerRef.current) {
            dataSource.entities.remove(myLocationMarkerRef.current)
          }

          const pinBuilder = new Cesium.PinBuilder()
          const pinImage = pinBuilder.fromColor(Cesium.Color.fromCssColorString('#aa3bff'), 48).toDataURL()
          
          myLocationMarkerRef.current = dataSource.entities.add({
            position: Cesium.Cartesian3.fromDegrees(longitude, latitude),
            billboard: {
              image: pinImage,
              verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
              heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
            zIndex: 9999,
          })
        }
      },
      (error) => {
        console.error(error)
        alert('위치 정보를 가져오지 못했어요. 브라우저 위치 권한을 허용했는지 확인해주세요.')
      },
      { enableHighAccuracy: true, timeout: 5000 }
    )
  } /* handleGoToMyLocation */

  // 전송버튼 클릭 시 실행
  const handleSend = async () => {
    // 기존 메시지에 새 메시지 배열에 추가
    const newMessages = [...messages, { role: 'user', text: message }]
    setMessages(newMessages)
    const sentMessage = message // 전송 버튼을 누르고 프롬프트 내용을 지우기 위해 기존 작성한 메시지 값을 안전하게 보관
    setMessage('')

    // 1-1. 장소, 이름을 기다리는 중이었다면('idle', 'awaiting-location')
    if(chatMode === 'awaiting-location') {
      const coords = await searchLocation(sentMessage)
      if(coords) {
        console.log('브이월드 호출 후 넘어온 좌표 확인', coords)
        moveCamera(coords)
        setMessages([...newMessages, { role: 'bot', text: `${sentMessage}(으)로 이동했어요!`}])
      } else {
        setMessages([...newMessages, { role: 'bot', text: '장소를 찾지 못했어요. 다시 입력해주세요. ex) 당산역, 63빌딩, 명동' }])
      }
      setChatMode('idle') // 다시 대기중으로 복귀
      return
    }
    // 1-2. 시간 이동을 기다렸다면('idle', 'awaitiing-time')
    if(chatMode === 'awaiting-time') {
      const parsed = await parseTimeOffset(sentMessage) // 숫자로 파싱된 시간(ex. 3 or -3) offset에 저장

      if(isNaN(parsed)) {
        setMessages([...newMessages, { role: 'bot', text: '시간을 이해하지 못했어요. 다시 입력해주세요. ex) 3시간 뒤, 저녁 6시, -2시간'}])
        // chatMode 그대로 유지 -> 다시 시간 입력 받음
      } else if(parsed < -9 || parsed > 9) {
        setMessages([...newMessages, { role: 'bot', text: '이동 가능한 시간 범위는 -9시간 ~ +9시간까지예요. 다시 입력해주세요.'}])
      } else {
        setTimeOffsetHours(parsed)
        const viewer = cesiumViewerRef.current
        if(viewer && !viewer.isDestroyed()) {
          const newDate = new Date(Date.now() + parsed * 60 * 60 * 1000)
          viewer.clock.currentTime = Cesium.JulianDate.fromDate(newDate)
          updateFnRef.current()
        }
        setMessages([...newMessages, { role: 'bot', text: `${parsed > 0 ? '+' : ''}${parsed}시간으로 이동했어요!`}])
        setChatMode('idle')   // 성공시에만 메뉴로 복귀
      }
      return
    }
    // 1-3. 길찾기를 선택했다면('idle', 'awaiting-route')
    if(chatMode === 'awaiting-route') {
      const parsed = await parsePlaceWord(sentMessage)
      if(parsed) {
        const result = await callToFindRoute(parsed)
        setMessages([...newMessages, { role: 'bot', text: '길찾기를 완료했어요'}])
        setChatMode('idle')
        // 길 찾은 후, 찾은 경로의 중간 위치로 카메라 이동
      } else {
        setMessages([...newMessages, { role: 'bot', text: '출발지나 도착지의 정보를 찾을 수 없어요, 주요 역 및 주요 지명으로 입력 후 다시 검색해주세요.'}])
      }
      return
    }

    // 2. 메뉴 선택 처리
    if(sentMessage === '1') {
      setMessages([...newMessages, { role: 'bot', text: '이동하고 싶은 장소를 말씀해주세요. ex) 서울역, 잠실야구장, 진관동' }])
      setChatMode('awaiting-location')
      return
    }
    if(sentMessage === '2') {
      setMessages([...newMessages, { role: 'bot', text: '이동하고 싶은 시간을 말씀해주세요. ex) 3시간 뒤, 저녁 6시, -2시간'}])
      setChatMode('awaiting-time')
      return
    }
    if(sentMessage === '3') {
      setMessages([...newMessages, { role: 'bot', text: '출발지와 도착지를 순서대로 입력해주세요. ex) 당산역, 영등포구청역 or 외대앞역, 신도림역'}])
      setChatMode('awaiting-route')
      return
    }

    // 그 외엔 AI 호출
    // 로딩 표시 켜기
    setIsLoading(true)

    // AI에게 물어보고 답변 기다리기
    const answer = await handleCallGemini(message)

    // 로딩 표시 끄고 AI 답변 화면에 추가
    setIsLoading(false)
    setMessages([...newMessages, { role: 'bot', text: answer }])
  }
  
  // 시간 파싱 함수
  async function parseTimeOffset(message) {
    const now = new Date()
    const prompt = `
      현재 시각은 ${now.toLocaleDateString('ko-KR')}입니다. 사용자가 "${message}"라고 입력했습니다. 이 요청을 현재 시각 기준 몇 시간 뒤/전으로 이동해야 하는지 계산해서, 오직 정수(-9에서 9 사이)만 출력하세요. 다른 설명 없이 숫자만 출력하세요. 예: 3, -2, 0
    `
    const answer = await handleCallGemini(prompt)
    return parseInt(answer, 10)
  }

  // 장소 추출 함수
  async function parsePlaceWord(message) {
    const prompt = `
      사용자가 "${message}"라고 입력했습니다. 이 문장에서 출발지와 도착지 지명만 JSON으로 추출하세요. 
      다른 설명이나 마크다운 코드블록 없이 JSON 객체만 출력하세요. 예: {"start":"당산역", "end":"영등포구청역"}
    `
    const answer = await handleCallGemini(prompt)

    // JSON 형식으로 받기 위해 ``` 코드블록으로 감싸져 오면 제거
    const cleaned = answer.replace(/```json:```/g, '').trim()

    try {
      const parsed = JSON.parse(cleaned)
      if(!parsed.start || !parsed.end) return null
      return parsed
    } catch(e) {
      console.error('장소 파싱 실패:', e, answer)
      return null
    }
  }

  // T맵 길찾기 api 호출
  async function callToFindRoute(parsed) {

    const token = localStorage.getItem('token')

    const startCoords= await searchLocation(parsed.start)
    const endCoords = await searchLocation(parsed.end)

    if(!startCoords || !endCoords) return null
    
    const response = await fetch('/api/tmap', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}` 
      },
      body: JSON.stringify({
        startX: startCoords[0],
        startY: startCoords[1],
        endX: endCoords[0],
        endY: endCoords[1],
        startName: parsed.start,
        endName: parsed.end,
      })
    })
    if(!response.ok) return
    const data = await response.json()
    drawToLineString(data, startCoords, endCoords)
  }
  // 라인 그리기
  function drawToLineString(data, startCoords, endCoords) {
    console.log('draw로 넘어옴', data)
    const viewer = cesiumViewerRef.current
    if(!viewer || viewer.isDestroyed()) return

    const routeCoords = []

    for(const feature of data.features) {
      if(feature.geometry.type === 'LineString') {
        for(const coord of feature.geometry.coordinates) {
          // 결과값 순회 후 LineString인 것들의 좌표만 배열에 push
          routeCoords.push(coord)
        }
      }
    }
    // cesium fromDegreesArray()가 받을수 있는 1차원 배열 구조로 변경(flatMap)
    const flatPositions = routeCoords.flatMap(([lon, lat]) => [lon, lat])
    
    const dataSource = routeDataSourceRef.current

    // 이전에 그려둔 경로선이 있으면 제거
    dataSource.entities.removeAll()
    // viewer에 경로선 추가
    dataSource.entities.add({
      polyline: {
        positions: Cesium.Cartesian3.fromDegreesArray(flatPositions),
        width: 5,
        material: Cesium.Color.RED,
        clampToGround: true,
      }
    })

    const pinBuilder = new Cesium.PinBuilder()

    // 출발 마커 (초록)
    const startPinImage = pinBuilder.fromColor(Cesium.Color.fromCssColorString('#22c55e'), 48).toDataURL()
    dataSource.entities.add({
      position: Cesium.Cartesian3.fromDegrees(startCoords[0], startCoords[1]),
      billboard: {
        image: startPinImage,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    })

    // 도착 마커 (파랑)
    const endPinImage = pinBuilder.fromColor(Cesium.Color.fromCssColorString('#3b82f6'), 48).toDataURL()
    dataSource.entities.add({
      position: Cesium.Cartesian3.fromDegrees(endCoords[0], endCoords[1]),
      billboard: {
        image: endPinImage,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    })

    // 출발지와 도착지 사이의 중간거리를 turf로 계산해 경로 탐색 완료 시 카메라 이동
    const midPoint = turf.midpoint(
      turf.point(startCoords),
      turf.point(endCoords)
    )

    const [ midLon, midLat ] = midPoint.geometry.coordinates

    moveCamera([ midLon, midLat ])
  }

  // ai 호출 및 프롬프트 전달
  const handleCallGemini = async (message) => {
    console.log('ai 호출', message)
    const response = await fetch('/api/gemini', { 
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({message}),
    })
    if(!response.ok) return

    // json으로 변환
    const data = await response.json()

    // text 뽑아오기
    const text = data.candidates[0].content.parts[0].text

    console.log('보낸 메시지', message)
    console.log('응답', text)

    return text
  }

  // 현재시각 가져와서 화면에 출력
  const handleTimeStep = (deltaHours) => {
    const next = Math.min(9, Math.max(-9, timeOffsetHours + deltaHours))
    setTimeOffsetHours(next)

    const viewer = cesiumViewerRef.current
    if(!viewer || viewer.isDestroyed()) return

    const newDate = new Date(Date.now() + next * 60 * 60 * 1000)
    viewer.clock.currentTime = Cesium.JulianDate.fromDate(newDate)
    updateFnRef.current()
}

  useEffect(() => {
    // cesium에서 발급받은 토큰
    Cesium.Ion.defaultAccessToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiJmNGZlNWIzMy1mYTQxLTQyZmYtODVhMi0wYWZiZmIyYmU1YmUiLCJpZCI6NDQwNTg4LCJpc3MiOiJodHRwczovL2FwaS5jZXNpdW0uY29tIiwiYXVkIjoidW5kZWZpbmVkX2RlZmF1bHQiLCJpYXQiOjE3ODA2MzIzNTB9.HtQdGVy09SDWyAgtopFoATbUXRys5eGFpBKpAex6oZs';
    
    let viewer
    let cancelled = false

    async function initViewer() {
      //const terrainProvider = await Cesium.createWorldTerrainAsync()
      const terrainProvider = new Cesium.EllipsoidTerrainProvider()
      console.log('terrainProvider:', terrainProvider)
      
      if(cancelled) return

      viewer = new Cesium.Viewer(viewerRef.current, {
        terrainProvider: terrainProvider,
        geocoder: false,
        homeButton: false,
        sceneModePicker: false,
        baseLayerPicker: false,
        navigationHelpButton: false,
        creditContainer: document.createElement("div"),
        animation: false,
        timeline: false,
        fullscreenButton: true,
      });
      cesiumViewerRef.current = viewer
      // gps핀 전용 CustomDataSource
      const myLocationDataSource = new Cesium.CustomDataSource('myLocation')
      viewer.dataSources.add(myLocationDataSource)
      myLocationDataSourceRef.current = myLocationDataSource

      // 경로선 전용 CustomDataSource
      const routeDataSource = new Cesium.CustomDataSource('route')
      viewer.dataSources.add(routeDataSource)
      routeDataSourceRef.current = routeDataSource

      viewer.scene.screenSpaceCameraController.enableTilt = false   // 여기 추가: 마우스로 각도 못 눕히게 막음

      Cesium.createWorldImageryAsync({
        style: Cesium.IonWorldImageryStyle.ROAD
      }).then((imageryProvider) => {
        if (viewer.isDestroyed()) return;
        viewer.imageryLayers.addImageryProvider(imageryProvider);
      });

      // 시각 설정(설정 기준 : 2026.08.17 오후 3시, 한국 UTC+9 기준 6시간 전으로 계산)
      viewer.clock.currentTime = Cesium.JulianDate.fromDate(new Date());
      
      let latestRequestId = 0
      const MAX_HEIGHT_FOR_BUILDINGS = 2000

      function updateBuildingsForCurrentView() {
        if(viewer.isDestroyed()) return
        
        const currentDate = Cesium.JulianDate.toDate(viewer.clock.currentTime)
        const sunPos = getSunPosition(currentDate, 37.480, 126.908)
        console.log('태양 위치:', sunPos)
        const cameraHeight = viewer.camera.positionCartographic.height
        
        // 카메라 뷰어의 고도가 더 높으면 뷰어에 있는 객체들을 remove
        if(cameraHeight > MAX_HEIGHT_FOR_BUILDINGS) {
          viewer.entities.removeAll()
          return
        }
        
        // 카메라의 위치,방향,시야각 정보를 바탕으로 화면에 보이는 지표면이 지리적으로 어느 위치인지 계산해 Cesium.Rectangle객체 반환
        const rectangle = viewer.camera.computeViewRectangle()
        if(!rectangle) return

        // 라디안 > 도 변환
        const west = Cesium.Math.toDegrees(rectangle.west)
        const south = Cesium.Math.toDegrees(rectangle.south)
        const east = Cesium.Math.toDegrees(rectangle.east)
        const north = Cesium.Math.toDegrees(rectangle.north)

        // 추가: 화면에 보이는 영역이 너무 넓으면(각도를 눕혔을 때) 건물 로딩 자체를 생략
        const MAX_VIEW_SPAN_DEGREES = 0.03   // 위도 1도 ≈ 111km이므로 대략 3km 폭 정도 제한
        const lonSpan = east - west
        const latSpan = north - south

        if(!isFinite(lonSpan) || !isFinite(latSpan) || lonSpan <= 0 || latSpan <= 0 || lonSpan > MAX_VIEW_SPAN_DEGREES || latSpan > MAX_VIEW_SPAN_DEGREES) {
          viewer.entities.removeAll()
          return
        }
        const bbox = `${west},${south},${east},${north}`

        latestRequestId += 1
        const requestId = latestRequestId
        loadWorldBuildings(viewer, bbox, () => requestId === latestRequestId, sunPos)
        } /* updateBuildingsForCurrentView */
        updateFnRef.current = updateBuildingsForCurrentView

        viewer.camera.moveEnd.addEventListener(updateBuildingsForCurrentView)
        
        function updateZoomLevel() {
          const height = viewer.camera.positionCartographic.height
          const zoom = Math.round(Math.log2(591657527.591555 / height))
          setZoomLevel(zoom)
        }

        zoomFnRef.current = updateZoomLevel
        viewer.camera.percentageChanged = 0.1
        viewer.camera.changed.addEventListener(updateZoomLevel)
        updateZoomLevel()

        viewer.camera.flyTo({
          destination: Cesium.Cartesian3.fromDegrees(126.908, 37.480, 700),
          orientation: {
            heading: Cesium.Math.toRadians(0),
            pitch: Cesium.Math.toRadians(-45),   // 45도 정도 내려다보는 각도로 고정
            roll: 0
          }
        });

        // 지구 표시 관련
        // viewer.scene.globe.show = true;
    }

    initViewer()

    return () => {
      cancelled = true
      if(viewer) {
        viewer.camera.moveEnd.removeEventListener(updateFnRef.current)
        viewer.camera.changed.removeEventListener(zoomFnRef.current)
        viewer.destroy()
      }
    }
  }, []);
  
return (
  <div className="dashboard-layout">
    <div className="dashboard-map">
      <div ref={viewerRef} className="sim-viewer-full" />

      <div className="absolute top-4 left-4 z-10 flex items-center gap-1 rounded-full border border-gray-200 bg-white/90 backdrop-blur-md py-1.5 pl-3 pr-1.5 shadow-lg">
        <span className="mr-1 text-base">☀️</span>
        <button
          type="button"
          onClick={() => handleTimeStep(-1)}
          className="flex h-7 w-7 items-center justify-center rounded-full text-[#aa3bff] hover:bg-[#f3eefc] transition"
        >
          −
        </button>
        <span className="min-w-9 text-center text-sm font-semibold text-gray-800">
          {timeOffsetHours > 0 ? `+${timeOffsetHours}` : timeOffsetHours}h
        </span>
        <button
          type="button"
          onClick={() => handleTimeStep(1)}
          className="flex h-7 w-7 items-center justify-center rounded-full text-[#aa3bff] hover:bg-[#f3eefc] transition"
        >
          +
        </button>
      </div>

      <div className="absolute top-4 right-4 z-10 flex flex-col items-center gap-1 rounded-2xl border border-gray-200 bg-white/90 backdrop-blur-md p-1.5 shadow-lg">
        <button
          onClick={() => handleZoom('in')}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-[#aa3bff] text-white hover:bg-[#8f2fe0] transition"
        >
          +
        </button>
        <span className="py-1 text-sm font-semibold text-gray-700">{zoomLevel}</span>
        <button
          onClick={() => handleZoom('out')}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-[#aa3bff] text-white hover:bg-[#8f2fe0] transition"
        >
          −
        </button>
      </div>    
      <button type="button" className="sim-gps-control" onClick={handleGoToMyLocation} title="내 위치로 이동">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="12" cy="12" r="3" fill="currentColor" />
          <path d="M12 2V6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <path d="M12 18V22" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <path d="M2 12H6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <path d="M18 12H22" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>
      <input
        type="range"
        min="0"
        max="45"
        value={tiltDeg}
        onChange={(e) => handleTiltChange(Number(e.target.value))}
        className="sim-tilt-slider"
        style={{ writingMode: 'vertical-lr', direction: 'rtl' }}
      />


    </div>

    <div className="dashboard-side">
      <div className="dashboard-top">
        <a href="/simulation" className="sim-logo">Cesium Scenario AI</a>
        <div className="sim-header-user">
          {user && <p>{user.username}님</p>}
          <button type="button" onClick={handleLogout}>로그아웃</button>
        </div>
      </div>

      <div className="dashboard-chat">
        <div className="sim-chatbot-container">
          <span className="chatbot-icon">🤖</span>
          <h3>ChatBot</h3>
        </div>

        <div className="chat-messages">
          <div className="chat-message chat-message-bot">
            안녕하세요,
            <br></br>
            Cesium Scenario ChatBot입니다.
            <br></br>
            도움이 필요하신 번호를 '숫자만' 입력해주세요
            <br></br>
            1. 위치 이동
            <br></br>
            2. 시간 이동
            <br></br>
            3. 도보 길찾기
          </div>
          {messages.map((msg, i) => (
            <div key={i} className={`chat-message chat-message-${msg.role}`}>
              <p>{msg.text}</p>
              {msg.role === 'bot' && (
                <span className="block text-[11px] text-gray-400 mt-1">
                  {new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
            </div>
          ))}
          {isLoading && <p>...</p>}
        </div>

        <div className="chatbot-input-area">
          <input type="text" className="chatbot-input" placeholder="메시지를 입력하세요..." value={message} onChange={(e) => setMessage(e.target.value)}/>
          <button type="button" className="chatbot-send-btn" onClick={handleSend}>전송</button>
        </div>
      </div>

      <div className="dashboard-stats">
        <h3 className="text-center text-sm font-bold text-[#aa3bff] mb-4 tracking-wide">
          오늘의 요약
        </h3>

        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between rounded-xl border border-[#f0eef5] bg-white px-4 py-3 shadow-sm hover:shadow-md hover:border-[#e4d4fb] transition">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#f3eefc] text-[#aa3bff]">☀️</span>
              <span className="text-sm text-[#4a4550]">태양 고도</span>
            </div>
            <span className="text-sm font-semibold text-[#08060d]">-</span>
          </div>

          <div className="flex items-center justify-between rounded-xl border border-[#f0eef5] bg-white px-4 py-3 shadow-sm hover:shadow-md hover:border-[#e4d4fb] transition">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#f3eefc] text-[#aa3bff]">🧭</span>
              <span className="text-sm text-[#4a4550]">태양 방위</span>
            </div>
            <span className="text-sm font-semibold text-[#08060d]">-</span>
          </div>

          <div className="flex items-center justify-between rounded-xl border border-[#f0eef5] bg-white px-4 py-3 shadow-sm hover:shadow-md hover:border-[#e4d4fb] transition">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#f3eefc] text-[#aa3bff]">🏢</span>
              <span className="text-sm text-[#4a4550]">표시 중인 건물 수</span>
            </div>
            <span className="text-sm font-semibold text-[#08060d]">-</span>
          </div>
        </div>
      </div>
    </div>
    <div className="current-time glass-bottom">
        <p>🕐현재 시간 : {time.toLocaleString()}</p>
      </div>
    </div>
)
} /* App */

export default App
