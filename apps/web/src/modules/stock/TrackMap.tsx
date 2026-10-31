import { useEffect, useRef, useState } from 'react';
import { loadLeaflet, type LeafletMap } from './leaflet';
import styles from './stock.module.css';
import { dm, mapLink } from './tracking';

/**
 * Where the ship is: a map, mounted only for a box that has a fix (so one still sitting at the load port costs nothing). Zoom 4
 * shows the sea area around the ship — street-level tiles are useless in the middle of an ocean, which is where these boxes are.
 * Where the map cannot be had it says so and gives the position and a link out.
 */
export function TrackMap({
  lat,
  lon,
  course,
  name,
}: {
  lat: number;
  lon: number;
  course: number | null;
  name: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let map: LeafletMap | null = null;
    let timer = 0;
    let gone = false;
    loadLeaflet()
      .then(L => {
        const el = box.current;
        if (gone || !el) return;
        map = L.map(el, {
          attributionControl: true,
          zoomControl: true,
          scrollWheelZoom: false,
        }).setView([lat, lon], 4);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 12,
          attribution: '© OpenStreetMap',
        }).addTo(map);
        const icon = L.divIcon({
          className: '',
          iconSize: [22, 22],
          iconAnchor: [11, 11],
          html: `<div class="${styles['shipMarker']}" style="transform:rotate(${course ?? 0}deg)"><svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M12 2l7 19-7-4-7 4 7-19Z"/></svg></div>`,
        });
        L.marker([lat, lon], { icon })
          .addTo(map)
          .bindPopup(name || 'Vessel');
        // The card is laid out after this runs, so Leaflet's first size read can be of a zero-height box; one invalidate once
        // painted fixes it.
        timer = window.setTimeout(() => map?.invalidateSize(), 60);
      })
      .catch(() => {
        if (!gone) setFailed(true);
      });
    return () => {
      gone = true;
      window.clearTimeout(timer);
      map?.remove();
    };
  }, [lat, lon, course, name]);

  if (failed)
    return (
      <div className={styles['mapFallback']} data-part="mapFallback">
        Map unavailable offline — position {dm(lat, 'lat')}, {dm(lon, 'lon')} (
        <a href={mapLink(lat, lon)} target="_blank" rel="noopener noreferrer">
          open a map
        </a>
        )
      </div>
    );
  return <div ref={box} className={styles['map']} data-part="map" />;
}
