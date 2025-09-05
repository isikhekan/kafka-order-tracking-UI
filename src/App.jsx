import React, { useEffect, useMemo, useRef, useState } from 'react'
import { MapContainer, TileLayer, Marker, Polyline, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

// Default Leaflet marker fix
const markerIcon2x = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png'
const markerIcon = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png'
const markerShadow = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png'

delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
})

const API_BASE = 'http://localhost:8080'

// ÇÖZÜM 1: Renk paleti - her sipariş için farklı renk
const COLOR_PALETTE = [
  '#FF0000', '#00FF00', '#0000FF', '#FF00FF', 
  '#FFFF00', '#00FFFF', '#FFA500', '#800080',
  '#008000', '#FFC0CB', '#A52A2A', '#808080'
]

// Click handler to pick coordinates from the map
function MapClickPicker({ mode, onPick }) {
  useMapEvents({
    click(e) {
      if (!mode) return
      const { lat, lng } = e.latlng
      onPick(mode, { lat, lng })
    },
  })
  return null
}

export default function App() {
  const [customerId, setCustomerId] = useState('')
  const [latitude, setLatitude] = useState('')
  const [longitude, setLongitude] = useState('')
  const [destinationLat, setDestinationLat] = useState('')
  const [destinationLon, setDestinationLon] = useState('')
  const [speed, setSpeed] = useState('')
  const [startAddress, setStartAddress] = useState('')
  const [destAddress, setDestAddress] = useState('')
  
  // ÇÖZÜM 2: Çoklu sipariş takibi için state yapısını değiştirdim
  const [orders, setOrders] = useState({}) // orderId -> order data mapping
  const [activeOrders, setActiveOrders] = useState([]) // aktif sipariş listesi
  
  const [pickMode, setPickMode] = useState(null)
  
  const center = useMemo(() => ({ lat: 39.0, lng: 35.0 }), [])

  // ÇÖZÜM 3: Her sipariş için ayrı event source referansları
  const eventSourcesRef = useRef({})

  useEffect(() => {
    return () => {
      // Tüm event source'ları temizle
      Object.values(eventSourcesRef.current).forEach(es => {
        if (es) es.close()
      })
      eventSourcesRef.current = {}
    }
  }, [])

  function fmt(v) { return (typeof v === 'number' && isFinite(v)) ? v.toFixed(6) : '-' }

  // Küçük bir haversine
  function distMeters(a, b) {
    const R = 6371000;
    const toRad = d => d * Math.PI / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const lat1 = toRad(a.lat), lat2 = toRad(b.lat);
    const s = Math.sin(dLat/2)**2 + Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLng/2)**2;
    return 2 * R * Math.asin(Math.sqrt(s));
  }

  // ÇÖZÜM 4: Animasyon hızını düzelttim - gerçek hıza göre hesaplama
  function calculateAnimationDuration(distance, speedKmh) {
    if (!speedKmh || speedKmh <= 0) return 1000; // varsayılan 1 saniye
    const speedMs = speedKmh / 3.6; // km/h to m/s
    const durationMs = (distance / speedMs) * 1000;
    return Math.min(durationMs, 5000); // maksimum 5 saniye
  }

  async function geocodeAddress(query) {
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}`
      const res = await fetch(url, { headers: { 'Accept': 'application/json' } })
      if (!res.ok) return null
      const list = await res.json()
      if (!Array.isArray(list) || list.length === 0) return null
      const first = list[0]
      return { lat: Number(first.lat), lng: Number(first.lon) }
    } catch (_) {
      return null
    }
  }

  // ÇÖZÜM 5: Rota çekme fonksiyonunu iyileştirdim
  async function getRoute(from, to) {
    try {
      const url = `https://router.project-osrm.org/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson&steps=true`
      const res = await fetch(url)
      if (!res.ok) return null
      const data = await res.json()
      const coords = data?.routes?.[0]?.geometry?.coordinates || []
      return coords.map(([lng, lat]) => ({ lat, lng }))
    } catch (_) { 
      return null 
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()

    const payload = {
      customerId: Number(customerId),
      lat: Number(latitude),
      lon: Number(longitude),
      destinationLat: Number(destinationLat),
      destinationLon: Number(destinationLon),
      speed: Number(speed)
    }

    if ([payload.customerId, payload.lat, payload.lon, payload.destinationLat, payload.destinationLon, payload.speed].some(n => !isFinite(n))) {
      alert('Lütfen tüm alanları doğru giriniz')
      return
    }

    try {
      const res = await fetch(`${API_BASE}/api/orders/order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      if (!res.ok) throw new Error(`POST /orders ${res.status}`)
      const data = await res.json()
      const newOrderId = data.orderId || data.id || ''
      if (!newOrderId) throw new Error('orderId alınamadı')

      // ÇÖZÜM 6: Rota çekmeyi düzelttim - doğru sırayla koordinat veriyorum
      const routePath = await getRoute(
        { lat: payload.lat, lng: payload.lon },
        { lat: payload.destinationLat, lng: payload.destinationLon }
      )

      // ÇÖZÜM 7: Yeni siparişi orders state'ine ekliyorum
      const colorIndex = Object.keys(orders).length % COLOR_PALETTE.length
      const newOrder = {
        orderId: newOrderId,
        startPoint: { lat: payload.lat, lng: payload.lon },
        endPoint: { lat: payload.destinationLat, lng: payload.destinationLon },
        routePath: routePath || [],
        traveledPath: routePath ? [routePath[0]] : [],
        currentPosition: routePath ? routePath[0] : { lat: payload.lat, lng: payload.lon },
        stats: { speedKmh: payload.speed, remainingKm: 0, totalDistance: 0 },
        color: COLOR_PALETTE[colorIndex],
        isActive: true,
        // ÇÖZÜM 8: Animasyon state'ini sipariş bazında tutuyorum
        animationState: {
          targetIndex: 0,
          currentIndex: 0,
          animationTimer: null
        }
      }

      setOrders(prev => ({
        ...prev,
        [newOrderId]: newOrder
      }))

      setActiveOrders(prev => [...prev, newOrderId])
      
      // ÇÖZÜM 9: Her sipariş için ayrı SSE başlatıyorum
      startSse(newOrderId)

    } catch (err) {
      console.error(err)
      alert('Sipariş oluşturulamadı')
    }
  }

  function startSse(orderId) {
    const url = `${API_BASE}/stream/location/${encodeURIComponent(orderId)}`
    const es = new EventSource(url)
    eventSourcesRef.current[orderId] = es

    const handleMessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data)
        const lat = Number(msg.lat)
        const lon = Number(msg.lon ?? msg.lng)
        if (!isFinite(lat) || !isFinite(lon)) return

        // ÇÖZÜM 10: İlgili siparişin bilgilerini güncelliyorum
        setOrders(prev => {
          const order = prev[orderId]
          if (!order) return prev

          const newStats = {
            speedKmh: Number(msg.speed) || 0,
            remainingKm: Number(msg.remainingKm) || 0,
            totalDistance: Number(msg.totalDistance) || 0,
          }

          // ÇÖZÜM 11: Progress hesaplamasını düzelttim
          let progress = 0
          const totalKm = Number(msg.totalDistance) || 0
          const remKm = Number(msg.remainingKm) || 0
          
          if (totalKm > 0) {
            progress = Math.max(0, Math.min(1, (totalKm - remKm) / totalKm))
          }

          // ÇÖZÜM 12: Rota üzerindeki hedef noktayı hesaplıyorum
          const routePath = order.routePath
          if (routePath && routePath.length > 1) {
            const targetIndex = Math.round(progress * (routePath.length - 1))
            
            // ÇÖZÜM 13: Smooth animasyon için yavaş yavaş ilerletiyorum
            animateOrderToProgress(orderId, targetIndex, newStats.speedKmh)
          }

          return {
            ...prev,
            [orderId]: {
              ...order,
              stats: newStats,
              currentPosition: { lat, lng: lon }
            }
          }
        })

      } catch (err) {
        console.error('SSE message parse error:', err)
      }
    }

    es.onopen = () => console.log(`SSE open for order ${orderId}`)
    es.onmessage = handleMessage
    es.addEventListener('location', handleMessage)
    es.addEventListener('orders.location', handleMessage)
    es.onerror = (e) => {
      console.warn(`SSE error for order ${orderId}; readyState=`, es.readyState, e)
      // Event source'u temizle
      if (eventSourcesRef.current[orderId]) {
        eventSourcesRef.current[orderId].close()
        delete eventSourcesRef.current[orderId]
      }
    }
  }

  // ÇÖZÜM 14: Sipariş bazında animasyon fonksiyonu
  function animateOrderToProgress(orderId, targetIndex, speedKmh) {
    setOrders(prev => {
      const order = prev[orderId]
      if (!order || !order.routePath || order.routePath.length < 2) return prev

      const currentIndex = order.animationState.currentIndex
      if (targetIndex === currentIndex) return prev

      // Önceki timer'ı temizle
      if (order.animationState.animationTimer) {
        clearInterval(order.animationState.animationTimer)
      }

      const steps = Math.abs(targetIndex - currentIndex)
      const forward = targetIndex > currentIndex
      
      // ÇÖZÜM 15: Gerçek hıza göre animasyon süresi hesaplıyorum
      let totalDistance = 0
      for (let i = currentIndex; forward ? i < targetIndex : i > targetIndex; forward ? i++ : i--) {
        if (order.routePath[i] && order.routePath[i + (forward ? 1 : -1)]) {
          totalDistance += distMeters(order.routePath[i], order.routePath[i + (forward ? 1 : -1)])
        }
      }
      
      const animationDuration = calculateAnimationDuration(totalDistance, speedKmh)
      const stepDuration = animationDuration / steps

      let currentStep = currentIndex
      
      const timer = setInterval(() => {
        currentStep = forward ? currentStep + 1 : currentStep - 1
        
        setOrders(prev2 => {
          const order2 = prev2[orderId]
          if (!order2) return prev2

          const newTraveledPath = order2.routePath.slice(0, currentStep + 1)
          
          return {
            ...prev2,
            [orderId]: {
              ...order2,
              traveledPath: newTraveledPath,
              currentPosition: order2.routePath[currentStep],
              animationState: {
                ...order2.animationState,
                currentIndex: currentStep
              }
            }
          }
        })

        if (currentStep === targetIndex) {
          clearInterval(timer)
          // Timer referansını temizle
          setOrders(prev3 => ({
            ...prev3,
            [orderId]: {
              ...prev3[orderId],
              animationState: {
                ...prev3[orderId].animationState,
                animationTimer: null
              }
            }
          }))
        }
      }, stepDuration)

      return {
        ...prev,
        [orderId]: {
          ...order,
          animationState: {
            ...order.animationState,
            targetIndex,
            animationTimer: timer
          }
        }
      }
    })
  }

  // ÇÖZÜM 16: Sipariş durma/başlatma fonksiyonları
  const stopOrder = (orderId) => {
    if (eventSourcesRef.current[orderId]) {
      eventSourcesRef.current[orderId].close()
      delete eventSourcesRef.current[orderId]
    }
    
    setOrders(prev => ({
      ...prev,
      [orderId]: {
        ...prev[orderId],
        isActive: false
      }
    }))
    
    setActiveOrders(prev => prev.filter(id => id !== orderId))
  }

  return (
    <div className="app-shell" style={{ display: 'flex', gap: '1rem', fontFamily: 'system-ui, sans-serif' }}>
      <div className="sidebar" style={{ 
        width: '30%', 
        minWidth: 300, 
        padding: '1rem',
        backgroundColor: '#f8f9fa',
        borderRadius: '8px',
        boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
        maxHeight: '90vh',
        overflowY: 'auto'
      }}>
        <h2 style={{ marginTop: 0, color: '#333' }}>Yeni Kargo Oluştur</h2>
        
        <div style={{ marginBottom: '1rem' }}>
          <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
            <button 
              type="button" 
              onClick={() => setPickMode(pickMode === 'start' ? null : 'start')}
              style={{
                padding: '8px 12px',
                border: pickMode === 'start' ? '2px solid #007bff' : '1px solid #ccc',
                borderRadius: '4px',
                backgroundColor: pickMode === 'start' ? '#e7f3ff' : 'white',
                cursor: 'pointer'
              }}
            >
              {pickMode === 'start' ? 'Başlangıç: Seçim açık' : 'Başlangıç noktası seç'}
            </button>
            <button 
              type="button" 
              onClick={() => setPickMode(pickMode === 'dest' ? null : 'dest')}
              style={{
                padding: '8px 12px',
                border: pickMode === 'dest' ? '2px solid #007bff' : '1px solid #ccc',
                borderRadius: '4px',
                backgroundColor: pickMode === 'dest' ? '#e7f3ff' : 'white',
                cursor: 'pointer'
              }}
            >
              {pickMode === 'dest' ? 'Varış: Seçim açık' : 'Varış noktası seç'}
            </button>
          </div>
          {pickMode && (
            <div style={{ fontSize: '0.8rem', color: '#6b7280', marginBottom: '8px' }}>
              Haritaya tıklayın: {pickMode === 'start' ? 'Başlangıç' : 'Varış'} noktası atanacak
            </div>
          )}
          
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '8px', marginBottom: '8px' }}>
            <input 
              placeholder="Başlangıç adresi girin" 
              value={startAddress} 
              onChange={e => setStartAddress(e.target.value)}
              style={{ padding: '8px', border: '1px solid #ccc', borderRadius: '4px' }}
            />
            <button 
              type="button" 
              onClick={async () => {
                if (!startAddress.trim()) return
                const p = await geocodeAddress(startAddress.trim())
                if (!p) return alert('Adres bulunamadı')
                setLatitude(p.lat.toFixed(6))
                setLongitude(p.lng.toFixed(6))
              }}
              style={{ padding: '8px 12px', border: '1px solid #ccc', borderRadius: '4px', backgroundColor: '#f8f9fa', cursor: 'pointer' }}
            >
              Uygula
            </button>
          </div>
          
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '8px' }}>
            <input 
              placeholder="Varış adresi girin" 
              value={destAddress} 
              onChange={e => setDestAddress(e.target.value)}
              style={{ padding: '8px', border: '1px solid #ccc', borderRadius: '4px' }}
            />
            <button 
              type="button" 
              onClick={async () => {
                if (!destAddress.trim()) return
                const p = await geocodeAddress(destAddress.trim())
                if (!p) return alert('Adres bulunamadı')
                setDestinationLat(p.lat.toFixed(6))
                setDestinationLon(p.lng.toFixed(6))
              }}
              style={{ padding: '8px 12px', border: '1px solid #ccc', borderRadius: '4px', backgroundColor: '#f8f9fa', cursor: 'pointer' }}
            >
              Uygula
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} style={{ marginBottom: '1rem' }}>
          {[
            { label: 'Müşteri ID', value: customerId, onChange: setCustomerId },
            { label: 'Latitude', value: latitude, onChange: setLatitude },
            { label: 'Longitude', value: longitude, onChange: setLongitude },
            { label: 'Hedef Latitude', value: destinationLat, onChange: setDestinationLat },
            { label: 'Hedef Longitude', value: destinationLon, onChange: setDestinationLon },
            { label: 'Hız (km/h)', value: speed, onChange: setSpeed }
          ].map((field, idx) => (
            <div key={idx} style={{ marginBottom: '12px' }}>
              <label style={{ display: 'block', marginBottom: '4px', fontWeight: '500', color: '#333' }}>
                {field.label}
              </label>
              <input 
                type="number" 
                step="any" 
                value={field.value} 
                onChange={e => field.onChange(e.target.value)}
                style={{ 
                  width: '100%', 
                  padding: '8px', 
                  border: '1px solid #ccc', 
                  borderRadius: '4px',
                  fontSize: '14px'
                }}
              />
            </div>
          ))}
          <button 
            type="submit"
            style={{
              width: '100%',
              padding: '10px',
              backgroundColor: '#007bff',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              fontSize: '16px',
              fontWeight: '500',
              cursor: 'pointer'
            }}
          >
            Kargo Oluştur
          </button>
        </form>

        {/* ÇÖZÜM 17: Aktif siparişleri gösterme paneli */}
        <div>
          <h3 style={{ marginBottom: '12px', color: '#333' }}>Aktif Kargolar ({activeOrders.length})</h3>
          {activeOrders.map(orderId => {
            const order = orders[orderId]
            if (!order) return null
            
            return (
              <div 
                key={orderId} 
                style={{
                  padding: '12px',
                  marginBottom: '8px',
                  backgroundColor: 'white',
                  borderRadius: '6px',
                  border: `2px solid ${order.color}`,
                  fontSize: '0.85rem'
                }}
              >
                <div style={{ fontWeight: 'bold', marginBottom: '6px' }}>
                  Kargo #{orderId}
                </div>
                <div style={{ color: order.color, fontWeight: '500', marginBottom: '4px' }}>
                  ● Renk: {order.color}
                </div>
                <div><strong>Hız:</strong> {fmt(order.stats.speedKmh)} km/h</div>
                <div><strong>Toplam:</strong> {fmt(order.stats.totalDistance)} km</div>
                <div><strong>Kalan:</strong> {fmt(order.stats.remainingKm)} km</div>
                <div>
                  <strong>Konum:</strong> {fmt(order.currentPosition.lat)}, {fmt(order.currentPosition.lng)}
                </div>
                <button 
                  onClick={() => stopOrder(orderId)}
                  style={{
                    marginTop: '8px',
                    padding: '4px 8px',
                    backgroundColor: '#dc3545',
                    color: 'white',
                    border: 'none',
                    borderRadius: '3px',
                    fontSize: '12px',
                    cursor: 'pointer'
                  }}
                >
                  Durduir
                </button>
              </div>
            )
          })}
        </div>
      </div>

      <div className="map-wrap" style={{ width: '70%', height: '90vh' }}>
        <MapContainer center={center} zoom={6} style={{ width: '100%', height: '100%' }}>
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap contributors" />
          <MapClickPicker
            mode={pickMode}
            onPick={(mode, p) => {
              if (mode === 'start') {
                setLatitude(p.lat.toFixed(6))
                setLongitude(p.lng.toFixed(6))
              } else if (mode === 'dest') {
                setDestinationLat(p.lat.toFixed(6))
                setDestinationLon(p.lng.toFixed(6))
              }
              setPickMode(null)
            }}
          />
          
          {/* ÇÖZÜM 18: Her sipariş için ayrı rota ve marker gösterimi */}
          {Object.values(orders).map(order => (
            <React.Fragment key={order.orderId}>
              {/* Planlanan rota - açık renk */}
              {order.routePath.length > 1 && (
                <Polyline 
                  positions={order.routePath} 
                  color={order.color} 
                  opacity={0.4}
                  weight={3}
                />
              )}
              
              {/* Gidilen yol - koyu renk */}
              {order.traveledPath.length > 1 && (
                <Polyline 
                  positions={order.traveledPath} 
                  color={order.color}
                  opacity={0.8}
                  weight={5}
                />
              )}
              
              {/* Araç konumu */}
              {order.currentPosition && (
                <Marker position={order.currentPosition} />
              )}
            </React.Fragment>
          ))}
        </MapContainer>
      </div>
    </div>
  )
}