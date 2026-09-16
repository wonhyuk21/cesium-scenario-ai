import { useEffect, useState, useRef } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css'
import * as SunCalc from 'suncalc'
import * as turf from '@turf/turf'
import '../App.css'
import { checkAndResetHistoryFlag } from '../navigationFlag.js'
import haloIcon from '../assets/halo.svg'
import dotIcon from '../assets/blue-dot.svg'
import startPinIcon from '../assets/start-pin.svg'
import endPinIcon from '../assets/end-pin.svg'

/* 18 ~ 132 라인 삭제 예정 */
function parseJwt(token) {
  const base64Payload = token.split('.')[1]
  const decoded = atob(base64Payload.replace(/-/g, '+').replace(/_/g, '/'))
  return JSON.parse(decoded)
}

// 태양의 고도/방위각을 도(degree) 단위로 계산 (방위각은 나침반 기준: 0=북, 시계방향)
function getSunPosition(date, lat, lon) {
  const sunPos = SunCalc.getPosition(date, lat, lon)
  return {
    altitude: sunPos.altitude,
    azimuth: sunPos.azimuth,
  }
} /* getSunPosition */

// 건물 외곽선과 높이, 태양 위치를 받아 그림자 폴리곤 계산
function calculateShadowPolygon(footprintCoordinates, heightMeters, sunAltitudeDeg, sunAzimuthDeg) {
  if(sunAltitudeDeg <= 0) return null   // 해가 지평선 아래면 그림자 없음

  const shadowLength = heightMeters / Math.tan(Cesium.Math.toRadians(sunAltitudeDeg)) // 높이 / tan(고도각) = 그림자길이
  const shadowDirection = (sunAzimuthDeg + 180) % 360                                 // 그림자방향

  // 외곽선과 그림자 방향으로 그림자 길이만큼 밀어낸 새 좌표 구함
  const projectedCoords = footprintCoordinates.map(([lon, lat]) => {
    const projected = turf.destination([lon, lat], shadowLength, shadowDirection, { units: 'meters' })
    return projected.geometry.coordinates
  })

  // 건물의 모든 꼭짓점, 그림자 방향으로 길이만큼 밀어낸 좌표들을 펼쳐 turf가 이해하는 point로 변환
  const allPoints = turf.featureCollection(
    [...footprintCoordinates, ...projectedCoords].map((coord) => turf.point(coord))
  )
  // 흩어진 점들을 모두 감싸는 convex hull 폴리곤 생성
  return turf.convex(allPoints)
} /* calculateShadowPolygon */

// 경로 라인을 따라 일정 간격으로 샘플 지점을 뽑음 (그늘 판정용)
function sampleRoutePoints(routeCoords, count = 30) {
  if(routeCoords.length < 2) {
    return routeCoords
  }
  const line = turf.lineString(routeCoords)
  const totalLength = turf.length(line, { units: 'meters' })

  const points = []
  for(let i = 0; i <= count; i++) {
    const distance = (totalLength * i) / count
    const pointOnLine = turf.along(line, distance, { units: 'meters' })
    points.push(pointOnLine.geometry.coordinates)
  }
  return points
} /* sampleroutePoints */

// 경로 샘플 지점 중 몇 %가 건물 그림자 안에 있는지 계산
function computeShadeRatio(samplePoints, buildings, sunAltitudeDeg, sunAzimuthDeg) {
  if(sunAltitudeDeg <= 0) return 100   // 해가 없으면(야간) 전체를 그늘로 취급

  const shadowHulls = buildings
    // 건물 목록을 하나씩 돌며 각 건물 외곽선 및 높이를 가지고 그림자 계산 함수 호출
    .map((b) => calculateShadowPolygon(b.outerRing, b.height, sunAltitudeDeg, sunAzimuthDeg))
    // 실제 계산된 결과에 따라 실제 그림자인것들만 남김
    .filter((hull) => hull !== null)

  const shadedCount = samplePoints.filter((coord) => {
    const pt = turf.point(coord)
    return shadowHulls.some((hull) => turf.booleanPointInPolygon(pt, hull)) // 이 점이 그늘 안에 있는지를 반환
  }).length

  // 그늘인 점 갯수 / 전체 샘플 점 갯수 계산해서 %로 변환
  return Math.round((shadedCount / samplePoints.length) * 100)    
} /* computeShadeRatio */

function App() {
  const [ user, setUser ] = useState(null)
  const [ timeOffsetHours, setTimeOffsetHours ] = useState(0)
  const [ time, setTime ] = useState(new Date())
  const [ message, setMessage ] = useState('')
  const [ messages, setMessages ] = useState([])
  const [ isLoading, setIsLoading ] = useState(false)
  const [ chatMode, setChatMode ] = useState('idle')
  const [ zoomLevel, setZoomLevel ] = useState(0)
  const [ tiltDeg, setTiltDeg ] = useState(0)
  const [ mapStyle, setMapStyle ] = useState('road')
  const [ headingDeg, setHeadingDeg ] = useState(0)
  const [ routeSummary, setRouteSummary ] = useState(null)   // 경로 그늘 요약(오늘의 요약 패널용)
  const navigate = useNavigate()
  const viewerRef = useRef(null)
  const cesiumViewerRef = useRef(null)
  const updateFnRef = useRef(() => {})
  const zoomFnRef = useRef(() => {})
  const routeContextRef = useRef(null)   // 현재 경로의 샘플지점/건물 캐시(시간 바뀔 때마다 다시 안 받아오게)
  const myLocationMarkerRef = useRef(null)
  const myLocationDataSourceRef = useRef(null)
  const myLocationHaloRef = useRef(null)
  const routeDataSourceRef = useRef(null)
  const imageryLayerRef = useRef(null)

  useEffect(() => {
    // 브라우저의 앞.뒤로 가기 눌렀을 때 차단
    if(checkAndResetHistoryFlag()) {
      alert('잘못된 접근입니다. 다시 로그인해주세요.')
      localStorage.removeItem('token')
      navigate('/')
      return
    } 
    const token = localStorage.getItem('token')
    // 토큰이 이미 삭제된 경우 차단(로그아웃 및 브라우저 뒤로가기 눌렀다가 재접근 시)
    if(!token) {
      navigate('/')
      return
    }
      const payload = parseJwt(token)
      setUser({ username: payload.username, role: payload.role })
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
  
  // 실제로 카메라에 heading(회전각)을 적용하는 공통 함수
  const applyHeading = (value) => {
    const viewer = cesiumViewerRef.current
    if(!viewer || viewer.isDestroyed()) return

    const target = viewer.camera.pickEllipsoid(
      new Cesium.Cartesian2(viewer.canvas.clientWidth / 2, viewer.canvas.clientHeight / 2),
      viewer.scene.globe.ellipsoid
    )
    if(!target) return

    const range = Cesium.Cartesian3.distance(viewer.camera.positionWC, target)

    viewer.camera.lookAt(
      target,
      new Cesium.HeadingPitchRange(Cesium.Math.toRadians(value), viewer.camera.pitch, range)
    )
    viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY)

    setHeadingDeg(value)
  }

  const handleHeadingChange = (value) => {
    applyHeading(value)
  }

  const handleTiltChange = (value) => {
    setTiltDeg(value)
    const viewer = cesiumViewerRef.current
    if(!viewer || viewer.isDestroyed()) return
    const pitch = -(90 - value)   // value=0 → -90(2D), value=60 → -30(3D)

    // 화면 중앙이 가리키는 지면 좌표를 고정 축(target)으로 사용
    const target = viewer.camera.pickEllipsoid(
      new Cesium.Cartesian2(viewer.canvas.clientWidth / 2, viewer.canvas.clientHeight /2),
      viewer.scene.globe.ellipsoid
    )
    if(!target) return

    const range = Cesium.Cartesian3.distance(viewer.camera.positionWC, target)

    viewer.camera.lookAt(
      target,
      new Cesium.HeadingPitchRange(viewer.camera.heading, Cesium.Math.toRadians(pitch), range)
    )
    // lookAt이 카메라를 그 기준툴에 잠금, 그래서 풀어주기
    viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY)
  }

  // 전달받은 메시지를 브이월드 장소 검색 api를 호출
  async function searchLocation(message) {
    console.log('위치 이동 기능')
    const token = localStorage.getItem('token')

    const response = await fetch(`/api/vworld?place=${message}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    })
    const result = await response.json()
    const items = result?.response?.result?.items

    if(!items || items.length === 0) {
      return null
    }
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

  function placeMyLocationMarker(dataSource, longitude, latitude) {
    // 기존 마커/halo 제거
    if(myLocationMarkerRef.current) dataSource.entities.remove(myLocationMarkerRef.current)
    if(myLocationHaloRef.current) dataSource.entities.remove(myLocationMarkerRef.current)

    // halo
    myLocationHaloRef.current = dataSource.entities.add({
      position: Cesium.Cartesian3.fromDegrees(longitude, latitude),
      billboard: {
        image: haloIcon,
        scale: new Cesium.CallbackProperty(() => {
          const t = (Date.now() % 2000) / 2000
          return 0.5 + t * 1.5
        }, false),
        color: new Cesium.CallbackProperty(() => {
          const t = (Date.now() % 2000) / 2000
          return Cesium.Color.WHITE.withAlpha(1 - t)
        }, false),
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    })

    // 중앙파란점
    myLocationMarkerRef.current = dataSource.entities.add({
      position: Cesium.Cartesian3.fromDegrees(longitude, latitude),
      billboard: {
        image: dotIcon,
        verticalOrigin: Cesium.VerticalOrigin.CENTER,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      zIndex: 9999,
    })
  }

  // 버튼 클릭시 basemap을 변경하는 핸들러
  const handleChangeMapStyle = async (style) => {
    const viewer = cesiumViewerRef.current
    if(!viewer || viewer.isDestroyed()) return
    if(mapStyle === style) return       // 이미 같은 스타일이면 아무것도 안함

    const cesiumStyle = style === 'road' ? Cesium.IonWorldImageryStyle.ROAD : Cesium.IonWorldImageryStyle.AERIAL

    const newProvider = await Cesium.createWorldImageryAsync({ style: cesiumStyle })
    if(viewer.isDestroyed()) return

    // 기존 지도 레이어 제거
    if(imageryLayerRef.current) {
      viewer.imageryLayers.remove(imageryLayerRef.current)
    }

    // 새 지도 레이어 추가하고 참조 갱신
    imageryLayerRef.current = viewer.imageryLayers.addImageryProvider(newProvider)
    setMapStyle(style)
  } /* handleChangeMapStyle */

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
         
          placeMyLocationMarker(dataSource, longitude, latitude)
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

    // 0. awaiting-* 모드 중 취소/메뉴 복귀 요청 처리
    const CANCEL_KEYWORDS = ['메뉴', '취소', '0']
    if(chatMode !== 'idle' && CANCEL_KEYWORDS.includes(sentMessage.trim())) {
      setMessages([...newMessages, { role: 'bot', text: '메인 메뉴로 돌아왔어요.\n원하시는 메뉴를 \'번호\'로 선택해주세요.\n1. 위치 이동\n2. 시간 이동\n3. 도보 길찾기'}])
      setChatMode('idle')
      return
    }

    // 1-1. 장소, 이름을 기다리는 중이었다면('idle', 'awaiting-location')
    if(chatMode === 'awaiting-location') {
      const coords = await searchLocation(sentMessage)
      if(coords) {
        console.log('브이월드 호출 후 넘어온 좌표 확인', coords)
        moveCamera(coords)
        setMessages([...newMessages, { role: 'bot', text: `${sentMessage}(으)로 이동했어요! \n원하시는 메뉴를 '번호'로 선택하시거나 자유롭게 대화해주세요.\n1. 위치 이동\n2. 시간 이동\n3. 도보 길찾기`}])
        setChatMode('idle') // 다시 대기중으로 복귀

        // 이동한 장소에 대한 소개를 Gemini에게 물어봐서 뒤이어 보여줌
        setIsLoading(true)
        const info = await getPlaceInfo(sentMessage)
        setIsLoading(false)
        if(info) {
          setMessages((prev) => [...prev, { role: 'bot', text: info }])
        }
      } else {
        setMessages([...newMessages, { role: 'bot', text: '장소를 찾지 못했어요. 다시 입력해주세요. ex) 당산역, 63빌딩, 명동' }])
      }
      return
    }
    // 1-2. 시간 이동을 기다렸다면('idle', 'awaitiing-time')
    if(chatMode === 'awaiting-time') {
      const parsed = await parseTimeOffset(sentMessage) // 숫자로 파싱된 시간(ex. 3 or -3) offset에 저장

      if(isNaN(parsed)) {
        setMessages([...newMessages, { role: 'bot', text: '시간을 이해하지 못했어요. 다시 입력해주세요. ex) 3시간 뒤, 저녁 6시, -2시간'}])
        // chatMode 그대로 유지 -> 다시 시간 입력 받음
      } else if(parsed < -9 || parsed > 9) {
        setMessages([...newMessages, { role: 'bot', text: `${parsed}시간은 이동 가능 범위(-9~9시간)를 벗어나요. 다시 입력해주세요.`}])
      } else {
        setTimeOffsetHours(parsed)
        const viewer = cesiumViewerRef.current
        if(viewer && !viewer.isDestroyed()) {
          const newDate = new Date(Date.now() + parsed * 60 * 60 * 1000)
          viewer.clock.currentTime = Cesium.JulianDate.fromDate(newDate)
          updateFnRef.current()
          updateRouteShadeForCurrentTime()
        }
        setMessages([...newMessages, { role: 'bot', text: `${parsed > 0 ? '+' : ''}${parsed}시간으로 이동했어요! \n원하시는 메뉴를 '번호'로 선택하시거나 자유롭게 대화해주세요.\n1. 위치 이동\n2. 시간 이동\n3. 도보 길찾기`}])
        setChatMode('idle')   // 성공시에만 메뉴로 복귀
      }
      return
    }
    // 1-3. 길찾기를 선택했다면('idle', 'awaiting-route')
    if(chatMode === 'awaiting-route') {
      const parsed = await parsePlaceWord(sentMessage)
      if(parsed) {
        const result = await callToFindRoute(parsed)
        if(result === null) {
          setMessages([...newMessages, { role: 'bot', text: '출발지나 도착지를 찾지 못했어요. 다시 입력해주세요. ex) 당산역에서 영등포구청역까지 길 찾아줘'}])
          // chatMode를 'awaiting-route'로 유지해서 다시 입력받게끔 return
          return
        }
        setMessages([...newMessages, { role: 'bot', text: '길찾기를 완료했어요\n아래 길찾기 요약을 통해 길찾기 결과를 확인할 수 있어요\n좌측 상단에 시간 조절을 통해 경로상 실시간 그늘 비율을 확인할 수 있어요\n원하시는 메뉴를 `번호`로 선택하시거나 자유롭게 대화해주세요.\n1. 위치 이동\n2. 시간 이동\n3. 도보 길찾기' }])
        setChatMode('idle')
        // 길 찾은 후, 찾은 경로의 중간 위치로 카메라 이동
      } else {
        setMessages([...newMessages, { role: 'bot', text: '출발지나 도착지의 정보를 찾을 수 없어요, 주요 역 및 주요 지명으로 입력 후 다시 검색해주세요.'}])
      }
      return
    }

    // 2. 메뉴 선택 처리
    if(sentMessage === '1') {
      setMessages([...newMessages, { role: 'bot', text: '이동하고 싶은 장소를 말씀해주세요. ex) 서울역, 잠실야구장, 진관동\n(취소하려면 "메뉴"라고 입력하세요)' }])
      setChatMode('awaiting-location')
      return
    }
    if(sentMessage === '2') {
      setMessages([...newMessages, { role: 'bot', text: '이동하고 싶은 시간을 말씀해주세요. ex) 3시간 뒤, 저녁 6시, -2시간\n(취소하려면 "메뉴"라고 입력하세요)'}])
      setChatMode('awaiting-time')
      return
    }
    if(sentMessage === '3') {
      setMessages([...newMessages, { role: 'bot', text: '출발지와 도착지를 순서대로 입력해주세요. ex) 당산역, 영등포구청역 or 외대앞역, 신도림역\n(취소하려면 "메뉴"라고 입력하세요)'}])
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

  // 이동한 장소에 대한 간단한 소개를 Gemini에게 요청
  async function getPlaceInfo(placeName) {
    const prompt = `
      "${placeName}"에 대해 여행객에게 소개하듯 2~3문장으로 간단히 설명해줘.
      위치나 특징, 유명한 이유를 포함해서. 다른 설명이나 인사말 없이 소개 내용만 출력해줘.
    `
    const info = await handleCallGemini(prompt)
    return info
  }

  // 시간 파싱 함수
  async function parseTimeOffset(message) {
    const now = new Date()
    const prompt = `
      현재 시각은 ${now.toLocaleDateString('ko-KR')}입니다. 사용자가 "${message}"라고 입력했습니다.
      이 요청이 현재 시각 기준 몇 시간 뒤(양수)인지 몇 시간 전(음수)인지 정확히 계산하세요.
      범위 제한 없이, 계산된 값을 있는 그대로 정수로만 출력하세요.
      다른 설명 없이 숫자만 출력하세요. 예: 3, -2, 0, 99, -200
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
    // T맵 API 호출 후 data를 받아 길찾기 시작 좌표, 길찾기 끝 좌표, 출발지명, 도착지명을 넘김 
    drawToLineString(data, startCoords, endCoords, parsed.start, parsed.end)
  }
  // 라인 그리기
  function drawToLineString(data, startCoords, endCoords, startName, endName) {
    console.log('draw로 넘어옴', data)
    const viewer = cesiumViewerRef.current
    if(!viewer || viewer.isDestroyed()) return

    // 경로 좌표 추출 모음(data.features에서 LineString좌표만 추출)
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

    // 경로 총 거리(m)/소요시간(초)은 T맵 응답 첫 feature의 properties에 들어있음
    const summaryProps = data.features[0]?.properties || {}
    setRouteSummary((prev) => ({
      ...prev,
      startName,
      endName,
      distanceKm: summaryProps.totalDistance != null ? summaryProps.totalDistance / 1000 : null,
      durationMin: summaryProps.totalTime != null ? Math.round(summaryProps.totalTime / 60) : null,
    }))

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
    dataSource.entities.add({
      position: Cesium.Cartesian3.fromDegrees(startCoords[0], startCoords[1]),
      billboard: {
        image: startPinIcon,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: {
        text: '출발',
        font: 'bold 14px sans-serif',
        fillColor: Cesium.Color.WHITE,
        showBackground: true,
        backgroundColor: Cesium.Color.fromCssColorString('#22c55e'),
        backgroundPadding: new Cesium.Cartesian2(8, 4),
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        pixelOffset: new Cesium.Cartesian2(0, -56),
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    })

    // 도착 마커 (파랑)
    dataSource.entities.add({
      position: Cesium.Cartesian3.fromDegrees(endCoords[0], endCoords[1]),
      billboard: {
        image: endPinIcon,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: {
        text: '도착',
        font: 'bold 14px sans-serif',
        fillColor: Cesium.Color.WHITE,
        showBackground: true,
        backgroundColor: Cesium.Color.fromCssColorString('#3b82f6'),
        backgroundPadding: new Cesium.Cartesian2(8, 4),
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        pixelOffset: new Cesium.Cartesian2(0, -56),
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },    
    })

    // 경로 전체가 화면에 다 들어오도록 카메라 범위 계산
    const lons = routeCoords.map(([lon]) => lon)
    const lats = routeCoords.map(([, lat]) => lat)

    // 경로의 동서남북
    const east = Math.max(...lons)
    const west = Math.min(...lons)
    const south = Math.min(...lats)
    const north = Math.max(...lats)

    const lonPadding = (east - west) * 0.1
    const latPadding = (north - south) * 0.1
    const routeRectangle = Cesium.Rectangle.fromDegrees(
      west - lonPadding,
      south - latPadding,
      east + lonPadding,
      north + latPadding
    )

    viewer.camera.flyTo({
      destination: routeRectangle,
      orientation: {
        heading: Cesium.Math.toRadians(0),
        pitch: Cesium.Math.toRadians(-90),   // 경로 전체를 위에서 평면으로 내려다보기
        roll: 0,
      },
    })

    // 경로 주변 건물을 받아와서 그늘 비율/추천 시간 계산 (길찾기 요약 패널용)
    computeRouteShadowSummary(routeCoords, { west, south, east, north })
  }

  // 경로 주변(bbox) 건물 목록을 백엔드(PostGIS)에서 받아옴
  async function fetchRouteBuildings(bounds) {
    const east = bounds.east + 0.002
    const west = bounds.west - 0.002
    const south = bounds.south - 0.002
    const north = bounds.north + 0.002
    const bbox = west + ',' + south + ',' + east + ',' + north

    const token = localStorage.getItem('token')
    const response = await fetch('/api/route-buildings?bbox=' + bbox, {
      headers: { Authorization: `Bearer ${token}` },
    })

    if(!response.ok) {
      return []
    }

    const geojson = await response.json()
    const buildings = []

    console.log('geojson 확인', geojson)
    for(const feature of geojson.features) {
      if(feature.geometry.type !== 'Polygon') {
        continue
      }
      
      // 높이가 없는 건물은 계산 제외
      const height = feature.properties.height
      if(height <= 0) {
        continue
      }

      const outerRing = feature.geometry.coordinates[0]
      buildings.push({ outerRing: outerRing, height: height })
    }

    return buildings
  }

  // 지금(현재 clock 시각) 기준으로 태양 위치/그늘 비율만 다시 계산 (시간 이동 시마다 호출)
  function updateRouteShadeForCurrentTime() {
    // ctx > 경로 계산 컨텍스트(그늘 계산-buildings, samplepoints, midpoint)
    const ctx = routeContextRef.current
    if(!ctx) return

    const viewer = cesiumViewerRef.current
    const currentDate = (viewer && !viewer.isDestroyed())
      ? Cesium.JulianDate.toDate(viewer.clock.currentTime)
      : new Date()

    // 태양 위치
    const sunPos = getSunPosition(currentDate, ctx.midpoint[1], ctx.midpoint[0])
    // 그림자 비율
    const shadeRatio = computeShadeRatio(ctx.samplePoints, ctx.buildings, sunPos.altitude, sunPos.azimuth)

    setRouteSummary((prev) => ({
      ...prev,
      sunAltitude: sunPos.altitude,
      sunAzimuth: sunPos.azimuth,
      shadeRatio,
    }))
  } /* updateRouteShadeForCurrentTime */

  // 경로가 새로 그려졌을 때: 건물 받아오고, 현재 그늘 비율 + -9~9시간 중 추천 시간까지 계산
  async function computeRouteShadowSummary(routeCoords, bboxBounds) {
    // 3d tiles이기 때문에 좌표에 건물이 있는지 확인x -> 
    // db에서 폴리곤+높이 데이터를 GeoJson으로 받아와 turf로 계산
    const buildings = await fetchRouteBuildings(bboxBounds)
    const samplePoints = sampleRoutePoints(routeCoords, 30)
    // 현재 해의 위치를 구하기 위함(경로 사이가 거리가 멀것을 대비해 중간지점을 구함)
    const midpoint = turf.midpoint(
      turf.point(routeCoords[0]),
      turf.point(routeCoords[routeCoords.length - 1])
    ).geometry.coordinates

    // buildings > db에서 받아온 건물 목록
    // samplePoints: 경로를 30등분한 점
    // midpoint: 경로 중간 좌표
    // 경로관련 데이터를 routeContextRef에 저장
    routeContextRef.current = { buildings, samplePoints, midpoint }

    // 현재 시각 기준 값부터 먼저 반영
    updateRouteShadeForCurrentTime()

    if(buildings.length === 0) return

    // -9시간 ~ +9시간 중 그늘 비율이 가장 높은(=햇빛이 가장 적은) 시간을 탐색
    let bestOffset = 0
    let bestShadeRatio = -1
    for(let offset = -9; offset <= 9; offset++) {
      const date = new Date(Date.now() + offset * 60 * 60 * 1000)
      const sunPos = getSunPosition(date, midpoint[1], midpoint[0])
      const ratio = computeShadeRatio(samplePoints, buildings, sunPos.altitude, sunPos.azimuth)
      if(ratio > bestShadeRatio) {
        bestShadeRatio = ratio
        bestOffset = offset
      }
    }

    setRouteSummary((prev) => ({ ...prev, bestOffset, bestShadeRatio }))
  } /* computeRouteShadowSummary */

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
    updateRouteShadeForCurrentTime()
}

  useEffect(() => {
    // cesium에서 발급받은 토큰
    Cesium.Ion.defaultAccessToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiJmNGZlNWIzMy1mYTQxLTQyZmYtODVhMi0wYWZiZmIyYmU1YmUiLCJpZCI6NDQwNTg4LCJpc3MiOiJodHRwczovL2FwaS5jZXNpdW0uY29tIiwiYXVkIjoidW5kZWZpbmVkX2RlZmF1bHQiLCJpYXQiOjE3ODA2MzIzNTB9.HtQdGVy09SDWyAgtopFoATbUXRys5eGFpBKpAex6oZs';
    
    let viewer
    let cancelled = false

    async function initViewer() {
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
        baseLayer: false,
      });
      cesiumViewerRef.current = viewer

      // 실시간 그림자 설정
      viewer.shadows = true                         // 그림자 기능 켜기
      viewer.scene.globe.enableLighting = true      // 지면이 태양 방향에 따라 밝기를 다르게
      viewer.shadowMap.maximumDistance = 2000       // 어느 거리까지 그림자를 계산할지
      viewer.shadowMap.size = 4096                  // 해상도
      viewer.shadowMap.softShadows = true           // 경계를 부드럽게
      viewer.shadowMap.darkness = 0.3               // 어둡기

      // 서울시 건물 3D Tiles 로드
      Cesium.Cesium3DTileset.fromUrl('/tiles/tileset.json').then((tileset) => {
        if (viewer.isDestroyed()) return
        tileset.shadows = Cesium.ShadowMode.ENABLED
        viewer.scene.primitives.add(tileset)
      })

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
        imageryLayerRef.current = viewer.imageryLayers.addImageryProvider(imageryProvider);
      });

      // 시각 설정(설정 기준 : 2026.08.17 오후 3시, 한국 UTC+9 기준 6시간 전으로 계산)
      viewer.clock.currentTime = Cesium.JulianDate.fromDate(new Date());
      
      const MAX_HEIGHT_FOR_BUILDINGS = 2000

      function updateBuildingsForCurrentView() {  /* 3d tiles로 구현, 삭제 예정 */
        if(viewer.isDestroyed()) return
        
        const currentDate = Cesium.JulianDate.toDate(viewer.clock.currentTime)
        //const sunPos = getSunPosition(currentDate, 37.480, 126.908)
        //console.log('태양 위치:', sunPos)
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
        const MAX_VIEW_SPAN_DEGREES = 0.9  // 위도 1도 ≈ 111km이므로 대략 3km 폭 정도 제한
        const lonSpan = east - west
        const latSpan = north - south

        if(!isFinite(lonSpan) || !isFinite(latSpan) || lonSpan <= 0 || latSpan <= 0 || lonSpan > MAX_VIEW_SPAN_DEGREES || latSpan > MAX_VIEW_SPAN_DEGREES) {
          viewer.entities.removeAll()
          return
        }
      } /* updateBuildingsForCurrentView */
        updateFnRef.current = updateBuildingsForCurrentView

        viewer.camera.moveEnd.addEventListener(updateBuildingsForCurrentView)
        
        function updateZoomLevel() {
          const height = viewer.camera.positionCartographic.height
          const zoom = Math.round(Math.log2(591657527.591555 / height))
          setZoomLevel(zoom)
        }

        // 현재 위치에 따라 동적으로 이동시키기
        function flyToInitialLocation() { 
          const defaultView = () => {
            viewer.camera.flyTo({
              destination: Cesium.Cartesian3.fromDegrees(126.908, 37.480, 700),
              orientation: { heading: Cesium.Math.toRadians(0), pitch: Cesium.Math.toRadians(-90), roll: 0 }
            })
          }

          if(!navigator.geolocation) {
            defaultView()   // geolocation 미지원 브라우저는 기본 위치로
            return
          }

          navigator.geolocation.getCurrentPosition(
            (position) => {
              if(viewer.isDestroyed()) return
              const { longitude, latitude } = position.coords
              viewer.camera.flyTo({
                destination: Cesium.Cartesian3.fromDegrees(longitude, latitude, 700),
                orientation: { heading: Cesium.Math.toRadians(0), pitch: Cesium.Math.toRadians(-90), roll: 0 },
              })

              const dataSource = myLocationDataSourceRef.current
              placeMyLocationMarker(dataSource, longitude, latitude)

            },
            (error) => {
              console.warn('현재 위치를 가져오지 못했습니다.', error)
              if(!viewer.isDestroyed()) defaultView()   // 권한 거부/실패 시 기본 위치로
            }
          )
        } /* flyToInitialLocation() */

        zoomFnRef.current = updateZoomLevel
        viewer.camera.percentageChanged = 0.1
        viewer.camera.changed.addEventListener(updateZoomLevel)
        updateZoomLevel()
        
        // 현재 위치에 따라 동적으로 이동시키기
        flyToInitialLocation()
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

      <div className="sim-map-style-control">
        <button type="button" className={mapStyle === 'road' ? 'active' : ''} onClick={() => handleChangeMapStyle('road')}>일반</button>
        <button type="button" className={mapStyle === 'aerial' ? 'active' : ''} onClick={() => handleChangeMapStyle('aerial')}>위성</button>
      </div>

      <input
        type="range"
        min="0"
        max="45"
        value={tiltDeg}
        onChange={(e) => handleTiltChange(Number(e.target.value))}
        className="sim-tilt-slider"
        style={{ writingMode: 'vertical-lr' }}
      />

      <input
        type="range"
        min="0"
        max="360"
        value={headingDeg}
        onChange={(e) => handleHeadingChange(Number(e.target.value))}
        className="sim-heading-slider"
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
          길찾기 요약
        </h3>

        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between rounded-xl border border-[#f0eef5] bg-white px-4 py-3 shadow-sm hover:shadow-md hover:border-[#e4d4fb] transition">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#f3eefc] text-[#aa3bff]">🚩</span>
              <span className="text-sm text-[#4a4550]">
                {routeSummary?.startName && routeSummary?.endName
                  ? `${routeSummary.startName} > ${routeSummary.endName}`
                  : '경로 없음'}
              </span>
            </div>
          </div>

          <div className="flex items-center justify-between rounded-xl border border-[#f0eef5] bg-white px-4 py-3 shadow-sm hover:shadow-md hover:border-[#e4d4fb] transition">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#f3eefc] text-[#aa3bff]">📏</span>
              <span className="text-sm text-[#4a4550]">거리</span>
            </div>
            <span className="text-sm font-semibold text-[#08060d]">
              {routeSummary?.distanceKm != null ? `${routeSummary.distanceKm.toFixed(2)}km` : '-'}
            </span>
          </div>

          <div className="flex items-center justify-between rounded-xl border border-[#f0eef5] bg-white px-4 py-3 shadow-sm hover:shadow-md hover:border-[#e4d4fb] transition">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#f3eefc] text-[#aa3bff]">🚶</span>
              <span className="text-sm text-[#4a4550]">소요 시간</span>
            </div>
            <span className="text-sm font-semibold text-[#08060d]">
              {routeSummary?.durationMin != null ? `${routeSummary.durationMin}분` : '-'}
            </span>
          </div>

          <div className="flex items-center justify-between rounded-xl border border-[#f0eef5] bg-white px-4 py-3 shadow-sm hover:shadow-md hover:border-[#e4d4fb] transition">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#f3eefc] text-[#aa3bff]">🌳</span>
              <span className="text-sm text-[#4a4550]">경로 그늘 비율</span>
            </div>
            <span className="text-sm font-semibold text-[#08060d]">
              {routeSummary?.shadeRatio != null ? `${routeSummary.shadeRatio}%` : '-'}
            </span>
          </div>

          <div className="flex items-center justify-between rounded-xl border border-[#f0eef5] bg-white px-4 py-3 shadow-sm hover:shadow-md hover:border-[#e4d4fb] transition">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#f3eefc] text-[#aa3bff]">⏱️</span>
              <span className="text-sm text-[#4a4550]">추천 이동 시간</span>
            </div>
            <span className="text-sm font-semibold text-[#08060d]">
              {routeSummary?.bestOffset != null
                ? `${routeSummary.bestOffset > 0 ? '+' : ''}${routeSummary.bestOffset}시간 (그늘 ${routeSummary.bestShadeRatio}%)`
                : '-'}
            </span>
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
