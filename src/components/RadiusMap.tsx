'use client';

import { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Circle, useMapEvents, GeoJSON } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { Facility, AqsMonitor } from '@/lib/data-service';
import type { FeatureCollection, Feature } from 'geojson';
import { FlaskConical } from 'lucide-react';

// Project location marker (green tint via hue-rotate)
const CenterIcon = L.icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [30, 46],
  iconAnchor: [15, 46],
  className: 'hue-rotate-[90deg]',
});

function makeMonitorIcon(): L.DivIcon {
  return L.divIcon({
    html: `<div style="display:flex;align-items:center;justify-content:center;width:24px;height:24px;background:#6366f1;border-radius:6px;border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.35)">
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 18h8"/><path d="M3 22h18"/><path d="M9 12h3"/><path d="M17 18h.01"/><path d="M7 2h8l3 5v11"/><path d="M7 2v16"/><path d="M9 6h4"/></svg>
    </div>`,
    className: '',
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    popupAnchor: [0, -12],
  });
}

function makePowerPlantIcon(): L.DivIcon {
  return L.divIcon({
    html: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="22" viewBox="0 0 18 22" style="display:block;filter:drop-shadow(0 1px 2px rgba(0,0,0,0.4))">
      <polygon points="10,1 2,12 9,12 8,21 16,10 9,10" fill="#f97316" stroke="white" stroke-width="1.5" stroke-linejoin="round"/>
    </svg>`,
    className: '',
    iconSize: [18, 22],
    iconAnchor: [9, 21],
    popupAnchor: [0, -22],
  });
}

function makePermitIcon(isMajor?: boolean, permitType?: string): L.DivIcon {
  const color = isMajor
    ? '#dc2626'   // red-600 — major source
    : permitType === 'Synthetic Minor'
      ? '#d97706' // amber-600 — synthetic minor
      : '#2563eb'; // blue-600 — minor / other

  return L.divIcon({
    html: `<div style="width:10px;height:10px;border-radius:50%;background:${color};border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.35)"></div>`,
    className: '',
    iconSize: [10, 10],
    iconAnchor: [5, 5],
    popupAnchor: [0, -8],
  });
}

function makeMarkerIcon(f: Facility): L.DivIcon | L.Icon {
  if (f.sector === 'Power Plant') return makePowerPlantIcon();
  return makePermitIcon(f.isMajor, f.permitType);
}

// Style for Class I area polygons
const classIStyle = {
  color: '#166534',       // green-800 border
  weight: 2,
  fillColor: '#16a34a',   // green-600 fill
  fillOpacity: 0.12,
  dashArray: '4 3',
};

interface RadiusMapProps {
  defaultCenter: [number, number];
  center: [number, number] | null;
  radiusMi: number;
  facilities: Facility[];
  aqsMonitors?: AqsMonitor[];
  onMapClick: (lat: number, lon: number) => void;
  onFacilityClick: (facility: Facility) => void;
  onFacilityClose?: (facility: Facility) => void;
  onMonitorClick?: (monitor: AqsMonitor) => void;
  onMonitorClose?: (monitor: AqsMonitor) => void;
  classIGeoJson?: FeatureCollection | null;
}

function MapEvents({ onClick }: { onClick: (lat: number, lon: number) => void }) {
  useMapEvents({
    click(e) {
      onClick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

export default function RadiusMap({
  defaultCenter,
  center,
  radiusMi,
  facilities,
  aqsMonitors = [],
  onMapClick,
  onFacilityClick,
  onFacilityClose,
  onMonitorClick,
  onMonitorClose,
  classIGeoJson
}: RadiusMapProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return <div className="h-[500px] bg-slate-100 animate-pulse rounded-xl" />;

  const hasClassI = classIGeoJson && classIGeoJson.features.length > 0;

  return (
    <div style={{ position: 'relative' }}>
    <MapContainer
      center={defaultCenter}
      zoom={7}
      style={{ height: '500px', width: '100%', borderRadius: '0.75rem' }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <MapEvents onClick={onMapClick} />

      {/* Federal Class I Areas overlay */}
      {hasClassI && (
        <GeoJSON
          key="class1-layer"
          data={classIGeoJson!}
          pathOptions={classIStyle}
          onEachFeature={(feature: Feature, layer: L.Layer) => {
            const name = feature.properties?._displayName ?? 'Class I Area';
            const type = feature.properties?._type ?? '';
            const acres = feature.properties?.GIS_ACRES ?? feature.properties?.GIS_Acres;
            const acreStr = acres ? ` · ${Math.round(acres).toLocaleString()} ac` : '';
            if ((layer as L.Path).bindPopup) {
              (layer as L.Path).bindPopup(
                `<div style="font-size:12px;line-height:1.5">
                  <strong style="color:#166534">🏔 ${name}</strong><br/>
                  <span style="color:#64748b">${type}${acreStr}</span><br/>
                  <span style="font-size:10px;color:#94a3b8">Federal Class I Area (CAA §162)</span>
                </div>`,
                { maxWidth: 220 }
              );
            }
          }}
        />
      )}

      {center && (
        <>
          <Marker position={center} icon={CenterIcon}>
            <Popup>
              <strong>Project Location</strong><br />
              {center[0].toFixed(5)}, {center[1].toFixed(5)}
            </Popup>
          </Marker>
          <Circle
            center={center}
            radius={radiusMi * 1609.34}
            pathOptions={{ color: '#ea580c', fillColor: '#ea580c', fillOpacity: 0.07 }}
          />
        </>
      )}

      {facilities.map((f, i) => (
        <Marker
          key={`${f.id}-${i}`}
          position={[f.lat, f.lon]}
          icon={makeMarkerIcon(f)}
          eventHandlers={{ click: () => onFacilityClick(f) }}
        >
          <Popup eventHandlers={{ remove: () => onFacilityClose?.(f) }}>
            <div className="text-sm leading-snug">
              <p className="font-bold">{f.name}</p>
              <p className="text-slate-500">{f.city}, {f.state}</p>
              {f.sector === 'Power Plant' && (
                <p className="text-xs mt-1 font-semibold text-orange-500">⚡ Power Plant{f.camdId ? ' (CAMPD)' : ''}</p>
              )}
              {f.permitType && (
                <p className="text-xs mt-0.5">
                  <span className={`font-semibold ${f.isMajor ? 'text-red-600' : f.permitType === 'Synthetic Minor' ? 'text-amber-600' : 'text-blue-600'}`}>
                    {f.isMajor ? 'Major Source' : f.permitType}
                  </span>
                </p>
              )}
              {typeof f.distance === 'number' && (
                <p className="text-xs text-slate-400 mt-0.5">{f.distance.toFixed(1)} mi from project</p>
              )}
            </div>
          </Popup>
        </Marker>
      ))}

      {/* AQS Monitors (Safe rendering with pane check) */}
      {mounted && aqsMonitors.length > 0 && aqsMonitors.map((m, i) => (
        <Marker
          key={`aqs-${m.id}-${aqsMonitors.length}-${i}`}
          position={[m.lat, m.lon]}
          icon={makeMonitorIcon()}
          eventHandlers={{ 
            click: () => onMonitorClick?.(m),
            add: (e) => {
               // Safety to ensure the marker is added to the correct pane
               if (!e.target.getPane()) {
                 console.warn('Marker failed to find pane on add');
               }
            }
          }}
        >
          <Popup eventHandlers={{ remove: () => onMonitorClose?.(m) }}>
            <div className="text-sm leading-snug">
              <p className="font-bold text-indigo-700">📡 Monitoring Site</p>
              <p className="font-semibold text-xs mt-1">{m.local_site_name || 'AQS Monitor'}</p>
              <p className="text-slate-500 text-xs">{m.address || m.county + ' County'}</p>
              {m.pollutants && m.pollutants.length > 0 && (
                <div className="mt-2">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Monitors:</p>
                  <p className="text-[10px] text-slate-600 leading-tight">
                    {m.pollutants.slice(0, 5).join(', ')}{m.pollutants.length > 5 ? '...' : ''}
                  </p>
                </div>
              )}
            </div>
          </Popup>
        </Marker>
      ))}
    </MapContainer>

    {/* Map legend — bottom-right, above Leaflet attribution */}
    <div style={{
      position: 'absolute', bottom: '30px', right: '10px', zIndex: 1000,
      background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(4px)',
      border: '1px solid #e2e8f0', borderRadius: '8px',
      padding: '8px 10px', fontSize: '11px', lineHeight: '1.7',
      boxShadow: '0 1px 6px rgba(0,0,0,0.15)',
    }}>
      <div style={{ fontWeight: 700, marginBottom: '3px', color: '#334155' }}>Legend</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <svg width="12" height="15" viewBox="0 0 18 22"><polygon points="10,1 2,12 9,12 8,21 16,10 9,10" fill="#f97316" stroke="white" strokeWidth="1.5" strokeLinejoin="round"/></svg>
        <span style={{ color: '#334155' }}>Power Plant</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <span style={{ display:'inline-block', width:10, height:10, borderRadius:'50%', background:'#dc2626', border:'2px solid white', boxShadow:'0 1px 3px rgba(0,0,0,0.3)' }}/>
        <span style={{ color: '#334155' }}>Major Source</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <span style={{ display:'inline-block', width:10, height:10, borderRadius:'50%', background:'#d97706', border:'2px solid white', boxShadow:'0 1px 3px rgba(0,0,0,0.3)' }}/>
        <span style={{ color: '#334155' }}>Synthetic Minor</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <span style={{ display:'inline-block', width:10, height:10, borderRadius:'50%', background:'#2563eb', border:'2px solid white', boxShadow:'0 1px 3px rgba(0,0,0,0.3)' }}/>
        <span style={{ color: '#334155' }}>Minor / Other</span>
      </div>
      {aqsMonitors.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <div style={{ width:12, height:12, background:'#6366f1', borderRadius:'3px', border:'1px solid white' }}/>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ color: '#4f46e5', fontWeight: 600, lineHeight: '1.2' }}>AQS Monitoring</span>
            <span style={{ fontSize: '9px', color: '#64748b', lineHeight: '1' }}>Criteria & Toxics</span>
          </div>
        </div>
      )}
      {hasClassI && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px', borderTop: '1px solid #e2e8f0', paddingTop: '4px' }}>
          <span style={{ display:'inline-block', width:14, height:10, background:'rgba(22,163,74,0.18)', border:'2px dashed #166534', borderRadius:'2px' }}/>
          <span style={{ color: '#166534', fontWeight: 600 }}>Class I Area</span>
        </div>
      )}
    </div>
    </div>
  );
}
