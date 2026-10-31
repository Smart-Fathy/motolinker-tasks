// Leaflet is loaded from a CDN the first time a card with a fix is drawn, and never otherwise. If it does not arrive — a blocked
// CDN, an offline installed app — the card falls back to the coordinates and a link out, which is the information the map was
// there to convey anyway.
const LEAFLET_CSS = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css';
const LEAFLET_JS = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';

/** The part of Leaflet the card uses. */
export interface LeafletMap {
  setView(center: [number, number], zoom: number): LeafletMap;
  invalidateSize(): void;
  remove(): void;
}
export interface Leaflet {
  map(el: HTMLElement, options: Record<string, unknown>): LeafletMap;
  tileLayer(url: string, options: Record<string, unknown>): { addTo(map: LeafletMap): void };
  divIcon(options: Record<string, unknown>): unknown;
  marker(
    center: [number, number],
    options: Record<string, unknown>,
  ): { addTo(map: LeafletMap): { bindPopup(text: string): void } };
}

let pending: Promise<Leaflet> | null = null;

export function loadLeaflet(): Promise<Leaflet> {
  const had = (window as unknown as { L?: Leaflet }).L;
  if (had) return Promise.resolve(had);
  if (pending) return pending;
  pending = new Promise<Leaflet>((resolve, reject) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = LEAFLET_CSS;
    document.head.appendChild(css);
    const js = document.createElement('script');
    js.src = LEAFLET_JS;
    js.onload = () => resolve((window as unknown as { L: Leaflet }).L);
    js.onerror = () => {
      // (a failure is kept, as the classic page keeps it: the cards drawn after it fall back at once; a reload asks again)
      reject(new Error('Leaflet did not load'));
    };
    document.head.appendChild(js);
  });
  return pending;
}
