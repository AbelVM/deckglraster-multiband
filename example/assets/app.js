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
    attributionControl: false,
    pitch: 0,
    bearing: 0,
    pitchWithRotate: false,
    dragRotate: false,
    touchPitch: false
});

window._map = map;

// Add navigation controls
map.addControl(new maplibregl.NavigationControl({
    showCompass: false,
    visualizePitch: false
}), 'bottom-right');

// Add scale control
map.addControl(new maplibregl.ScaleControl({
    maxWidth: 100,
    unit: 'metric'
}), 'bottom-left');

map.on('load', () => {
    // Add spinner while TIFF is loading (non-interactive)
    let spinner = document.createElement('div');
    spinner.className = 'loading-spinner';
    spinner.setAttribute('role', 'status');
    spinner.setAttribute('aria-label', 'Loading raster');
    spinner.style.pointerEvents = 'none';
    document.body.appendChild(spinner);

    const pixelPopup = new maplibregl.Popup({
        closeButton: false,
        closeOnClick: false,
        maxWidth: '320px'
    });

    const firstLabelLayerId = map.getStyle().layers
        .find(layer => layer.type === 'symbol' && layer.id !== 'waterway_label').id;

    multiband.setActiveStyle('True Color');

    let rasterBounds = null;

    const layer = new COGLayer({
        id: 'cog-layer',
        geotiff: new URL('./sentinel_test.tif', import.meta.url).href,
        geoKeysParser: multiband.geoKeysParser,
        getTileData: multiband.getTileData,
        renderTile: multiband.renderTile,
        pickable: true,
        onGeoTIFFLoad: (geotiff, info) => {
            const { west, south, east, north } = info.geographicBounds;
            rasterBounds = { west, south, east, north };
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
            // Remove spinner when the GeoTIFF is ready
            if (spinner && spinner.parentNode) {
                spinner.parentNode.removeChild(spinner);
                spinner = null;
            }
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

    // No programmatic height changes here — layout handled with CSS. If needed, call `map.resize()` elsewhere.

    // Set crosshair cursor when hovering over raster
    const mapCanvas = map.getCanvas();
    
    map.on('mousemove', (e) => {
        if (!mapCanvas || !rasterBounds) return;
        
        const { lng, lat } = e.lngLat;
        const { west, south, east, north } = rasterBounds;
        
        if (lng >= west && lng <= east && lat >= south && lat <= north) {
            mapCanvas.style.cursor = 'crosshair';
        } else {
            mapCanvas.style.cursor = '';
        }
    });

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
    sampleStatus.className = 'sample-status';
    sampleStatus.textContent = 'Click on the raster to sample pixel values.';
    if (controlsPanel) {
        controlsPanel.appendChild(sampleStatus);
    }

    const setSampleStatus = (message, isError = false) => {
        sampleStatus.textContent = message;
        sampleStatus.classList.toggle('error', Boolean(isError));
    };

    const resetSamplePanel = () => {
        setSampleStatus('Click on the raster to sample pixel values.');
        sampleDetails.innerHTML = SAMPLE_DETAILS_PLACEHOLDER;
        sampleDetails.classList.remove('visible');
    };

    // Reserve fixed space for details to avoid panel resize on updates
    const SAMPLE_DETAILS_PLACEHOLDER = '<div class="sample-details-placeholder">No sample details to display.</div>';
    const sampleDetails = document.createElement('div');
    sampleDetails.id = 'sample-details';
    sampleDetails.className = 'sample-details';
    sampleDetails.innerHTML = SAMPLE_DETAILS_PLACEHOLDER;
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
            sampleDetails.innerHTML = '';
            sampleDetails.classList.remove('visible');
            pixelPopup
                .setLngLat(lngLat)
                .setHTML('<strong>No sampled value</strong><br/>Tile not loaded at this location yet.')
                .addTo(map);
            return;
        }

        // Check if all bands are zero (NO DATA)
        const allBandsZero = sample.bands.every(band => Number(band) === 0);
        
        if (allBandsZero) {
            const noDataContent = `
                <div style="font-family: 'IBM Plex Sans', 'Segoe UI', sans-serif; font-size: 12px; line-height: 1.35; white-space: nowrap;">
                    <strong>${sample.selectedstyle}:</strong> NO DATA
                </div>
            `;
            
            pixelPopup
                .setLngLat(lngLat)
                .setHTML(noDataContent)
                .addTo(map);
            
            sampleStatus.style.background = '#f5f7fa';
            sampleStatus.style.color = '#233044';
            sampleStatus.innerHTML = `<span class="sample-status-inner"><strong>${sample.selectedstyle}:</strong> NO DATA</span>`;
            sampleDetails.innerHTML = SAMPLE_DETAILS_PLACEHOLDER;
            sampleDetails.classList.remove('visible');
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

        sampleStatus.classList.remove('error');
        // Always show the style and value inline in the controls panel (no forced line break)
        const panelValueMarkup = `<strong>${sample.selectedstyle}:</strong> ${valueLabel}${swatch}`;
        sampleStatus.innerHTML = `<span class="sample-status-inner">${panelValueMarkup}</span>`;

        sampleDetails.classList.add('visible');
        sampleDetails.innerHTML = `
            <div class="sample-details-inner">
                <table style="border-collapse: collapse; width: 100%; table-layout: fixed;">
                    <thead>
                        <tr>
                            <th style="text-align: left; border-bottom: 1px solid #d0d0d0; padding: 2px 0;">Band</th>
                            <th style="text-align: right; border-bottom: 1px solid #d0d0d0; padding: 2px 0;">Value</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
        `;
    };

    // Single click handler avoids duplicate sampling events.
    map.on('click', (event) => {
        pixelPopup.remove();
        
        if (!rasterBounds) return;
        
        const { lng, lat } = event.lngLat;
        const { west, south, east, north } = rasterBounds;
        
        if (lng >= west && lng <= east && lat >= south && lat <= north) {
            showPixelSample(event.lngLat);
            return;
        }

        resetSamplePanel();
    });

    initSelector('layers', multiband, (newStyle) => {
        pixelPopup.remove();
        resetSamplePanel();
        multiband.setActiveStyle(newStyle, map, 'cog-layer');
    });

    // Ensure map correctly sizes to the updated container dimensions
    // Dynamically reserve space for the mobile controls panel to avoid overlap.
    const adjustMapForControls = () => {
        const panel = document.querySelector('.controls-panel');
        const mapContainer = map.getContainer();
        if (!mapContainer) return;

        const mq = window.matchMedia('(max-width: 640px)');
        // On desktop, clear any inline height we may have set.
        if (!panel || !mq.matches) {
            mapContainer.style.height = '';
            try { map.resize(); } catch (err) { /* ignore */ }
            return;
        }

        const rect = panel.getBoundingClientRect();
        const panelHeight = Math.ceil(rect.height || 0);
        // Small buffer for borders/margins/safe-area
        const buffer = 8;
        mapContainer.style.height = `calc(100vh - ${panelHeight + buffer}px)`;
        try { map.resize(); } catch (err) { /* ignore */ }

        // If the panel bottom is still off-screen, bring it into view.
        const panelRect = panel.getBoundingClientRect();
        if (panelRect.bottom > window.innerHeight) {
            panel.scrollIntoView({ block: 'end', behavior: 'auto' });
        }
    };

    // Debounce helper for resize/DOM-change events
    let _adjustTimeout = null;
    const scheduleAdjust = () => {
        if (_adjustTimeout) clearTimeout(_adjustTimeout);
        _adjustTimeout = setTimeout(adjustMapForControls, 100);
    };

    // Run once now and whenever layout/content changes
    scheduleAdjust();
    window.addEventListener('resize', scheduleAdjust);
    window.addEventListener('orientationchange', scheduleAdjust);

    // Observe changes in controls panel (e.g., sample details expanding)
    const controlsPanelNode = document.querySelector('.controls-panel');
    if (controlsPanelNode) {
        const mo = new MutationObserver(scheduleAdjust);
        mo.observe(controlsPanelNode, { childList: true, subtree: true, attributes: true, characterData: true });
    }
});

window.addEventListener('beforeunload', () => {
    if (multiband) {
        multiband.destroy();
    }
});

