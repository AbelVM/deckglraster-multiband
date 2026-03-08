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
    const pixelPopup = new maplibregl.Popup({
        closeButton: true,
        closeOnClick: false,
        maxWidth: '320px'
    });

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

    const controlsPanel = document.querySelector('.controls-panel');
    const sampleStatus = document.createElement('div');
    sampleStatus.id = 'sample-status';
    sampleStatus.style.marginTop = '4px';
    sampleStatus.style.padding = '6px 8px';
    sampleStatus.style.borderRadius = '6px';
    sampleStatus.style.background = '#f5f7fa';
    sampleStatus.style.color = '#233044';
    sampleStatus.style.fontSize = '12px';
    sampleStatus.style.lineHeight = '1.35';
    sampleStatus.textContent = 'Click on the raster to sample pixel values.';
    if (controlsPanel) {
        controlsPanel.appendChild(sampleStatus);
    }

    const setSampleStatus = (message, isError = false) => {
        sampleStatus.textContent = message;
        sampleStatus.style.background = isError ? '#fff1f1' : '#f5f7fa';
        sampleStatus.style.color = isError ? '#8f1f1f' : '#233044';
    };

    const sampleDetails = document.createElement('div');
    sampleDetails.id = 'sample-details';
    sampleDetails.style.marginTop = '4px';
    sampleDetails.style.padding = '6px 8px';
    sampleDetails.style.borderRadius = '6px';
    sampleDetails.style.background = '#f5f7fa';
    sampleDetails.style.color = '#233044';
    sampleDetails.style.fontSize = '12px';
    sampleDetails.style.lineHeight = '1.35';
    sampleDetails.style.display = 'none';
    if (controlsPanel) {
        controlsPanel.appendChild(sampleDetails);
    }

    const getRgbValue = (value) => {
        if (!value) {
            return null;
        }

        if (Array.isArray(value) && value.length >= 3) {
            const r = Number(value[0]);
            const g = Number(value[1]);
            const b = Number(value[2]);
            if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) {
                return null;
            }

            const normalized = Math.max(r, g, b) <= 1;
            return {
                r: Math.round(Math.max(0, Math.min(255, normalized ? r * 255 : r))),
                g: Math.round(Math.max(0, Math.min(255, normalized ? g * 255 : g))),
                b: Math.round(Math.max(0, Math.min(255, normalized ? b * 255 : b)))
            };
        }

        if (typeof value === 'object') {
            const r = Number(value.r);
            const g = Number(value.g);
            const b = Number(value.b);
            if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) {
                return null;
            }
            return {
                r: Math.round(Math.max(0, Math.min(255, r))),
                g: Math.round(Math.max(0, Math.min(255, g))),
                b: Math.round(Math.max(0, Math.min(255, b)))
            };
        }

        return null;
    };

    const showPixelSample = (lngLat) => {
        setSampleStatus(`Sampling at ${Number(lngLat.lng).toFixed(5)}, ${Number(lngLat.lat).toFixed(5)}...`);
        const sample = multiband.getPixelValues(lngLat, map, 'cog-layer');

        if (!sample) {
            setSampleStatus('No sampled value: tile not loaded at this location yet.', true);
            sampleDetails.style.display = 'none';
            pixelPopup
                .setLngLat(lngLat)
                .setHTML('<strong>No sampled value</strong><br/>Tile not loaded at this location yet.')
                .addTo(map);
            return;
        }

        const formatValue = (value) => {
            if (value === null || typeof value === 'undefined') {
                return 'n/a';
            }

            if (Array.isArray(value)) {
                return `[${value.map((v) => Number(v).toFixed(4)).join(', ')}]`;
            }

            if (typeof value === 'object') {
                if (Number.isFinite(value.r) && Number.isFinite(value.g) && Number.isFinite(value.b)) {
                    return `rgb(${value.r}, ${value.g}, ${value.b})`;
                }
                return JSON.stringify(value);
            }

            if (Number.isFinite(Number(value))) {
                return Number(value).toFixed(4);
            }

            return String(value);
        };

        const rows = sample.bands
            .map((value, bandIndex) => `
                <tr>
                    <td style="text-align: left; padding: 2px 0;">B${bandIndex + 1}</td>
                    <td style="text-align: right; padding: 2px 0; font-variant-numeric: tabular-nums;">${Number(value).toFixed(3)}</td>
                </tr>
            `)
            .join('');

        const valueLabel = formatValue(sample.value);
        const currentStyleDef = styles.find((style) => style && style.name === sample.selectedstyle);
        const isType2Style = Boolean(currentStyleDef && Array.isArray(currentStyleDef.colors) && Array.isArray(currentStyleDef.stops));

        const rgb = getRgbValue(sample.value);
        const swatch = rgb
            ? `<span style="display:inline-block;width:12px;height:12px;margin-left:6px;vertical-align:middle;background:rgb(${rgb.r}, ${rgb.g}, ${rgb.b});"></span>`
            : '';

        const popupValueMarkup = isType2Style
            ? `<strong>${sample.selectedstyle}:</strong> ${valueLabel}${swatch}`
            : `<strong>${sample.selectedstyle}:</strong><br/>${valueLabel}${swatch}`;

        const content = `
            <div style="font-family: 'IBM Plex Sans', 'Segoe UI', sans-serif; font-size: 12px; line-height: 1.35; white-space: nowrap;">
                ${popupValueMarkup}
            </div>
        `;

        pixelPopup
            .setLngLat(lngLat)
            .setHTML(content)
            .addTo(map);

        sampleStatus.style.background = '#f5f7fa';
        sampleStatus.style.color = '#233044';
        sampleStatus.innerHTML = `<strong>${sample.selectedstyle}:</strong> ${valueLabel}${swatch}`;

        sampleDetails.style.display = 'block';
        sampleDetails.innerHTML = `
            <table style="border-collapse: collapse; width: 100%; table-layout: fixed;">
                <thead>
                    <tr>
                        <th style="text-align: left; border-bottom: 1px solid #d0d0d0; padding: 2px 0;">Band</th>
                        <th style="text-align: right; border-bottom: 1px solid #d0d0d0; padding: 2px 0;">Value</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        `;
    };

    // Single click handler avoids duplicate sampling events.
    map.on('click', (event) => {
        showPixelSample(event.lngLat);
    });

    initSelector('layers', multiband, (newStyle) => {
        multiband.setActiveStyle(newStyle, map, 'cog-layer');
    });
});

window.addEventListener('beforeunload', () => {
    if (multiband) {
        multiband.destroy();
    }
});

