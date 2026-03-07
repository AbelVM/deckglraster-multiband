/**
 * Type 1: fn returns [r,g,b,a] in range [0,1]
 * Type 2: fn returns scalar, uses colors/stops/domain for gradient LUT
 * Sentinel-2 normalization: multiply by 0.00003051757 (1/32768)
 */
const styles = [
  {
    name: 'True Color',
    fn: function (data) {
      const pixel = [
        data[3][this.thread.y][this.thread.x], // B4 Red
        data[2][this.thread.y][this.thread.x], // B3 Green
        data[1][this.thread.y][this.thread.x]  // B2 Blue
      ];
      const r = Math.max(0, Math.min(1, pixel[0] * 0.00003051757));
      const g = Math.max(0, Math.min(1, pixel[1] * 0.00003051757));
      const b = Math.max(0, Math.min(1, pixel[2] * 0.00003051757));
      const a = (pixel[0] === 0 && pixel[1] === 0 && pixel[2] === 0) ? 0 : 1.0;
      return [r, g, b, a];
    }
  },
  {
    name: 'False Color (NIR)',
    fn: function (data) {
      const pixel = [
        data[7][this.thread.y][this.thread.x], // B8 NIR
        data[3][this.thread.y][this.thread.x], // B4 Red
        data[2][this.thread.y][this.thread.x]  // B3 Green
      ];
      const r = Math.max(0, Math.min(1, pixel[0] * 0.00003051757));
      const g = Math.max(0, Math.min(1, pixel[1] * 0.00003051757));
      const b = Math.max(0, Math.min(1, pixel[2] * 0.00003051757));
      const a = (pixel[0] === 0 && pixel[1] === 0 && pixel[2] === 0) ? 0 : 1.0;
      return [r, g, b, a];
    }
  },
  {
    name: 'Agriculture Composite',
    fn: function (data) {
      const pixel = [
        data[10][this.thread.y][this.thread.x], // B11 SWIR1
        data[7][this.thread.y][this.thread.x],  // B8 NIR
        data[1][this.thread.y][this.thread.x]   // B2 Blue
      ];
      const r = Math.max(0, Math.min(1, pixel[0] * 0.00003051757));
      const g = Math.max(0, Math.min(1, pixel[1] * 0.00003051757));
      const b = Math.max(0, Math.min(1, pixel[2] * 0.00003051757));
      const a = (pixel[0] === 0 && pixel[1] === 0 && pixel[2] === 0) ? 0 : 1.0;
      return [r, g, b, a];
    }
  },
  {
    name: 'True Color optimized',
    fn: function (data) {
      // Sentinel Hub L2A: contrast + gamma + saturation + sRGB
      const b4Raw = data[3][this.thread.y][this.thread.x];
      const b3Raw = data[2][this.thread.y][this.thread.x];
      const b2Raw = data[1][this.thread.y][this.thread.x];

      const b4 = b4Raw * 0.00003051757;
      const b3 = b3Raw * 0.00003051757;
      const b2 = b2Raw * 0.00003051757;

      const maxR = 3.0;
      const midR = 0.13;
      const sat = 1.2;
      const gamma = 1.8;
      const gOff = 0.01;
      const gOffPow = Math.pow(gOff, gamma);
      const gOffRange = Math.pow(1.0 + gOff, gamma) - gOffPow;

      const txOverMax = midR / maxR;
      const twoTxOverMaxMinusOne = 2.0 * txOverMax - 1.0;
      const txOverMaxPlusTyMinusOne = txOverMax; // ty = 1.0

      let ar = b4 / maxR;
      ar = Math.max(0.0, Math.min(1.0, ar));
      let den = ar * twoTxOverMaxMinusOne - txOverMax;
      let rAdj = Math.abs(den) > 0.0000001 ? ar * (ar * txOverMaxPlusTyMinusOne - 1.0) / den : 0.0;
      rAdj = Math.max(0.0, Math.min(1.0, rAdj));
      let rLin = (Math.pow(rAdj + gOff, gamma) - gOffPow) / gOffRange;
      rLin = Math.max(0.0, Math.min(1.0, rLin));

      ar = b3 / maxR;
      ar = Math.max(0.0, Math.min(1.0, ar));
      den = ar * twoTxOverMaxMinusOne - txOverMax;
      let gAdj = Math.abs(den) > 0.0000001 ? ar * (ar * txOverMaxPlusTyMinusOne - 1.0) / den : 0.0;
      gAdj = Math.max(0.0, Math.min(1.0, gAdj));
      let gLin = (Math.pow(gAdj + gOff, gamma) - gOffPow) / gOffRange;
      gLin = Math.max(0.0, Math.min(1.0, gLin));

      ar = b2 / maxR;
      ar = Math.max(0.0, Math.min(1.0, ar));
      den = ar * twoTxOverMaxMinusOne - txOverMax;
      let bAdj = Math.abs(den) > 0.0000001 ? ar * (ar * txOverMaxPlusTyMinusOne - 1.0) / den : 0.0;
      bAdj = Math.max(0.0, Math.min(1.0, bAdj));
      let bLin = (Math.pow(bAdj + gOff, gamma) - gOffPow) / gOffRange;
      bLin = Math.max(0.0, Math.min(1.0, bLin));

      const avgS = ((rLin + gLin + bLin) / 3.0) * (1.0 - sat);
      rLin = Math.max(0.0, Math.min(1.0, avgS + rLin * sat));
      gLin = Math.max(0.0, Math.min(1.0, avgS + gLin * sat));
      bLin = Math.max(0.0, Math.min(1.0, avgS + bLin * sat));

      const r = rLin <= 0.0031308 ? 12.92 * rLin : 1.055 * Math.pow(rLin, 0.41666666666) - 0.055;
      const g = gLin <= 0.0031308 ? 12.92 * gLin : 1.055 * Math.pow(gLin, 0.41666666666) - 0.055;
      const b = bLin <= 0.0031308 ? 12.92 * bLin : 1.055 * Math.pow(bLin, 0.41666666666) - 0.055;

      const b4IsZero = b4Raw === 0 ? 1.0 : 0.0;
      const b3IsZero = b3Raw === 0 ? 1.0 : 0.0;
      const b2IsZero = b2Raw === 0 ? 1.0 : 0.0;
      const allZero = b4IsZero * b3IsZero * b2IsZero;
      const a = allZero > 0.5 ? 0.0 : 1.0;
      return [Math.max(0.0, Math.min(1.0, r)), Math.max(0.0, Math.min(1.0, g)), Math.max(0.0, Math.min(1.0, b)), a];
    }
  },
  {
    name: 'NDVI',
    fn: function (data) {
      const b4 = data[3][this.thread.y][this.thread.x];
      const b8 = data[7][this.thread.y][this.thread.x];

      const denom = (b8 + b4);
      const ndvi = denom === 0 ? 0.0 : (b8 - b4) / denom;

      // Avoid && operator for GPU.js
      const b4IsZero = b4 === 0 ? 1.0 : 0.0;
      const b8IsZero = b8 === 0 ? 1.0 : 0.0;
      const bothZero = b4IsZero * b8IsZero;
      const a = bothZero > 0.5 ? 0.0 : 1.0;
      return [ndvi, 0, 0, a];
    },
    colors: [
      '#a50026',
      '#d73027',
      '#f46d43',
      '#fdae61',
      '#fee08b',
      '#d9ef8b',
      '#a6d96a',
      '#66bd63',
      '#1a9850',
      '#006837'
    ],
    stops: [-0.2, 0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]
  },
  {
    name: 'EVI',
    fn: function (data) {
      const b8 = data[7][this.thread.y][this.thread.x]; // Band 8 - NIR
      const b4 = data[3][this.thread.y][this.thread.x]; // Band 4 - Red
      const b2 = data[1][this.thread.y][this.thread.x]; // Band 2 - Blue

      const denom = b8 + 6.0 * b4 - 7.5 * b2 + 1.0;
      const evi = denom === 0 ? 0.0 : 2.5 * ((b8 - b4) / denom);

      const b8IsZero = b8 === 0 ? 1.0 : 0.0;
      const b4IsZero = b4 === 0 ? 1.0 : 0.0;
      const b2IsZero = b2 === 0 ? 1.0 : 0.0;
      const allZero = b8IsZero * b4IsZero * b2IsZero;
      const a = allZero > 0.5 ? 0.0 : 1.0;
      return [evi, 0, 0, a];
    },
    colors: [
      '#a50026',
      '#d73027',
      '#f46d43',
      '#fdae61',
      '#fee08b',
      '#d9ef8b',
      '#a6d96a',
      '#66bd63',
      '#1a9850',
      '#006837'
    ],
    stops: [-0.2, 0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8],
    domain: [-0.2, 0.8]
  },
  {
    name: 'NDCI',
    fn: function (data) {
      const b5 = data[4][this.thread.y][this.thread.x]; // Band 5
      const b4 = data[3][this.thread.y][this.thread.x]; // Band 4

      const denom = b5 + b4;
      const ndci = denom === 0 ? 0.0 : (b5 - b4) / denom;

      const b5IsZero = b5 === 0 ? 1.0 : 0.0;
      const b4IsZero = b4 === 0 ? 1.0 : 0.0;
      const allZero = b5IsZero * b4IsZero;
      const a = allZero > 0.5 ? 0.0 : 1.0;
      return [ndci, 0, 0, a];
    },
    colors: [
      '#a50026',
      '#d73027',
      '#f46d43',
      '#fdae61',
      '#fee08b',
      '#d9ef8b',
      '#a6d96a',
      '#66bd63',
      '#1a9850',
      '#006837'
    ],
    stops: [-0.2, 0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8],
    domain: [-0.2, 0.8]
  },
  {
    name: 'NDMI',
    fn: function (data) {
      const b8 = data[7][this.thread.y][this.thread.x]; // Band 8 - NIR
      const b11 = data[10][this.thread.y][this.thread.x]; // Band 11 - SWIR

      const denom = b8 + b11;
      const ndmi = denom === 0 ? 0.0 : (b8 - b11) / denom;

      const b8IsZero = b8 === 0 ? 1.0 : 0.0;
      const b11IsZero = b11 === 0 ? 1.0 : 0.0;
      const allZero = b8IsZero * b11IsZero;
      const a = allZero > 0.5 ? 0.0 : 1.0;
      return [ndmi, 0, 0, a];
    },
    colors: [
      '#800000',
      '#ff0000',
      '#ffff00',
      '#00ffff',
      '#0000ff',
      '#000080'
    ],
    stops: [-0.8, -0.24, -0.032, 0.032, 0.24, 0.8],
    domain: [-0.8, 0.8]
  },
  {
    name: 'MSI',
    fn: function (data) {
      const b11 = data[10][this.thread.y][this.thread.x]; // Band 11 - SWIR
      const b8 = data[7][this.thread.y][this.thread.x]; // Band 8 - NIR

      const msi = b8 === 0 ? 0.0 : b11 / b8;

      const b11IsZero = b11 === 0 ? 1.0 : 0.0;
      const b8IsZero = b8 === 0 ? 1.0 : 0.0;
      const allZero = b11IsZero * b8IsZero;
      const a = allZero > 0.5 ? 0.0 : 1.0;
      return [msi, 0, 0, a];
    },
    colors: [
      '#a56d2c',
      '#b28c46',
      '#bbad65',
      '#bdce8e',
      '#bcf0b4',
      '#86d7b4',
      '#58bcb1',
      '#3a9fa8',
      '#22839d'
    ],
    stops: [0.33, 0.66, 1.0, 1.33, 1.66, 2.0, 2.33, 2.66, 3.0],
    domain: [0.33, 3.0]
  },
  {
    name: 'Band 4 - Red',
    fn: function (data) {
      const value = data[3][this.thread.y][this.thread.x];
      const normalized = Math.max(0, Math.min(1, value * 0.00003051757));
      const a = value === 0 ? 0 : 1.0;
      return [normalized, 0, 0, a];
    }
  },
  {
    name: 'Band 8 - NIR',
    fn: function (data) {
      const value = data[7][this.thread.y][this.thread.x];
      const normalized = Math.max(0, Math.min(1, value * 0.00003051757));
      const a = value === 0 ? 0 : 1.0;
      return [normalized, normalized, normalized, a];
    }
  }
];

export { styles };
