import { COGLayer } from '../../deck.gl-raster/packages/deck.gl-geotiff/src/index.ts';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { Multiband } from '../../dist/deck.gl-raster-multiband.es.js';
import { initSelector } from './selector.js';
import { styles } from './styles.js';

const multiband = new Multiband({ debug: false });

styles.forEach(style => {
    const options = {};
    if (style.colors) options.colors = style.colors;
    if (style.stops) options.stops = style.stops;
    if (style.domain) options.domain = style.domain;
    multiband.addStyle(style.name, style.fn, options);
});

const map = new maplibregl.Map({
    container: 'map',
    style: 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json',
    center: [2.9881414786570986, 42.2606115313024],
    zoom: 10,
    attributionControl: false
});

window._map = map;

map.on('load', () => {

    const firstLabelLayerId = map.getStyle().layers
        .find(layer => layer.type === 'symbol' && layer.id !== 'waterway_label').id;

    multiband.setActiveStyle('True Color');

    const layer = new COGLayer({
        id: 'cog-layer',
        geotiff: new URL('./sentinel_test.tif', import.meta.url).href,
        geoKeysParser: multiband.geoKeysParser,
        getTileData: multiband.getTileData,
        renderTile: multiband.renderTile,
        onGeoTIFFLoad: (geotiff, info) => {
            const { west, south, east, north } = info.geographicBounds;
            map.fitBounds(
                [
                    [west, south],
                    [east, north],
                ],
                {
                    padding: 40,
                    duration: 200,
                }
            );
        },
        beforeId: firstLabelLayerId
    });

    const overlay = new MapboxOverlay({
        layers: [layer],
        interleaved: false
    });

    map.addControl(overlay);

    // Set deck instance for multiband
    map.__deck = overlay._deck;

    const opacitySlider = document.getElementById('overlay-opacity');
    const opacityValue = document.getElementById('overlay-opacity-value');

    const getOverlayCanvas = () => {
        if (overlay && overlay._deck && overlay._deck.canvas) {
            return overlay._deck.canvas;
        }

        const mapContainer = map.getContainer();
        if (!mapContainer) {
            return null;
        }

        return (
            mapContainer.querySelector('canvas.deckgl-overlay') ||
            mapContainer.querySelector('canvas[id^="deckgl-overlay"]') ||
            null
        );
    };

    const applyOpacity = (opacityPercent) => {
        const canvas = getOverlayCanvas();
        if (!canvas) {
            return;
        }

        const clamped = Math.max(0, Math.min(100, opacityPercent));
        const opacity = clamped / 100;
        canvas.style.opacity = `${opacity}`;

        if (opacityValue) {
            opacityValue.value = `${clamped}%`;
            opacityValue.textContent = `${clamped}%`;
        }
    };

    if (opacitySlider) {
        applyOpacity(Number(opacitySlider.value) || 100);
        opacitySlider.addEventListener('input', (event) => {
            applyOpacity(Number(event.target.value));
        });
    }

    initSelector('layers', multiband, (newStyle) => {
        multiband.setActiveStyle(newStyle, map, 'cog-layer');
    });
});

window.addEventListener('beforeunload', () => {
    if (multiband) {
        multiband.destroy();
    }
});

