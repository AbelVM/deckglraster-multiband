import proj4 from 'proj4';

/**
 * Parse GeoTIFF projection keys and transform to proj4 definition
 * Extracts EPSG code from geoKeys and returns proj4-compatible CRS definition
 * 
 * @param {Object} geoKeys - GeoTIFF geokeys object
 * @returns {Promise<Object>} Promise resolving to CRS definition object
 * @returns {string} return.def - proj4 definition string (e.g., 'EPSG:4326')
 * @returns {Object} return.parsed - Parsed proj4 CRS object
 * @returns {string} return.coordinatesUnits - Units of the coordinate system
 * @throws {Error} If geoKeys is invalid or no projection code found
 * @public
 */
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
