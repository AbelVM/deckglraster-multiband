import proj4 from 'proj4';

const geoKeysParser = async (geoKeys) => {
    if (!geoKeys || typeof geoKeys !== 'object') {
        throw new Error('[geoKeysParser] Invalid geoKeys: expected object');
    }
    const projectionCode = geoKeys.ProjectedCSTypeGeoKey || geoKeys.GeographicTypeGeoKey || null;
    if (projectionCode === null) {
        throw new Error('[geoKeysParser] No projection code found in geoKeys');
    }
    const crsString = `EPSG:${projectionCode}`;
    const crs = proj4.defs(crsString);
    return { def: crsString, parsed: crs, coordinatesUnits: crs && crs.units };
};

export { geoKeysParser };
