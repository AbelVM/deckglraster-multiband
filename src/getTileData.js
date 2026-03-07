const toFloat32Array = (values) => {
    if (values instanceof Float32Array) {
        return values;
    }

    const output = new Float32Array(values.length);
    if (ArrayBuffer.isView(values)) {
        output.set(values);
        return output;
    }

    for (let i = 0; i < values.length; i++) {
        const v = Number(values[i]);
        output[i] = Number.isFinite(v) ? v : 0;
    }
    return output;
};

const toBandMajorFloat32 = (srcData, planeSize, bandCount, layout) => {
    if (
        srcData instanceof Float32Array &&
        srcData.length === planeSize * bandCount &&
        layout === 'band-separate'
    ) {
        return srcData;
    }

    if (
        ArrayBuffer.isView(srcData) &&
        srcData.length === planeSize * bandCount &&
        layout === 'band-separate'
    ) {
        return toFloat32Array(srcData);
    }

    if (Array.isArray(srcData)) {
        if (bandCount === 1 && srcData[0]) {
            return toFloat32Array(srcData[0]);
        }

        const dest = new Float32Array(planeSize * bandCount);
        for (let b = 0; b < bandCount; b++) {
            const band = srcData[b];
            if (!band) {
                continue;
            }

            const base = b * planeSize;
            if (band instanceof Float32Array) {
                dest.set(band, base);
            } else if (ArrayBuffer.isView(band)) {
                dest.set(band, base);
            } else {
                for (let i = 0; i < planeSize; i++) {
                    const v = Number(band[i]);
                    dest[base + i] = Number.isFinite(v) ? v : 0;
                }
            }
        }
        return dest;
    }

    if (bandCount === 1) {
        return toFloat32Array(srcData);
    }

    const interleaved = srcData;
    const dest = new Float32Array(planeSize * bandCount);
    const isTypedInterleaved = ArrayBuffer.isView(interleaved);

    for (let b = 0; b < bandCount; b++) {
        const destBase = b * planeSize;
        let srcIndex = b;
        for (let i = 0; i < planeSize; i++) {
            const v = interleaved[srcIndex];
            if (isTypedInterleaved) {
                dest[destBase + i] = v;
            } else {
                const n = Number(v);
                dest[destBase + i] = Number.isFinite(n) ? n : 0;
            }
            srcIndex += bandCount;
        }
    }
    return dest;
};

const buildBandDataFromRaster = (array) => {
    if (!array) {
        throw new Error('buildBandDataFromRaster: missing raster array');
    }
    const width = array.width;
    const height = array.height;
    const planeSize = width * height;

    let bandCount = Number(array.count) || 1;
    const srcData = array.data;
    const layout = array.layout;

    if (Array.isArray(srcData)) {
        bandCount = srcData.length || bandCount;
    }

    const concatFloat = toBandMajorFloat32(srcData, planeSize, bandCount, layout);

    return { data: concatFloat, width, height, bandCount };
};

const getTileData = async (image, options = {}) => {
    const { x, y, signal, device } = options;
    const tile = await image.fetchTile(x, y, { signal, boundless: false });
    const { array } = tile;

    if (!array) {
        throw new Error('getTileData: missing raster array from fetched tile');
    }

    const bandData = buildBandDataFromRaster(array);
    bandData.device = device;
    return bandData;
};

export { getTileData };
