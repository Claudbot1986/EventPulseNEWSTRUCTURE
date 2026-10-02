// mapClustering.js — grid-baserad klustring för MapCanvas.
//
// Enkel, snabb approach för sandbox: dela canvas i N×M cells, gruppera
// alla pins som landar i samma cell till ett klustrade. Visa count i
// klustret. Vid zoom-in blir cellerna mindre → färre klustring.
//
// Begränsningar:
//   - Pixel-precision kräver att vi har projicerat pins till x/y
//     FÖRE clustering.
//   - Fungerar bra upp till ~5000 events; därefter överväg
//     supercluster/Leaflet-klöver.
//
// Exporterar:
//   clusterPins() — tar emot [{x, y, event}] och returnerar
//                  [{x, y, count, events}]
//   CELL_SIZE     — default cellstorlek i pixlar (24px)

export const CELL_SIZE = 24;

/**
 * Beräkna cell-id för en pixel-position.
 */
function cellId(x, y, cellSize) {
  const cx = Math.floor(x / cellSize);
  const cy = Math.floor(y / cellSize);
  return `${cx},${cy}`;
}

/**
 * Klustra projicerade pins i grid-celler.
 *
 * @param {Array<{x:number,y:number,visible:boolean,event:object}>} pins
 * @param {number} cellSize default 24
 * @returns {Array<{x:number,y:number,count:number,events:Array<object>}>}
 */
export function clusterPins(pins, cellSize = CELL_SIZE) {
  if (!Array.isArray(pins)) return [];
  const cells = new Map();
  for (const pin of pins) {
    if (!pin || !pin.visible) continue;
    const id = cellId(pin.x, pin.y, cellSize);
    if (!cells.has(id)) {
      cells.set(id, {
        x: 0,
        y: 0,
        count: 0,
        events: [],
      });
    }
    const c = cells.get(id);
    c.x += pin.x;
    c.y += pin.y;
    c.count += 1;
    c.events.push(pin.event);
  }
  // Beräkna medel-x/y per cell (visuell mittpunkt).
  const out = [];
  for (const c of cells.values()) {
    out.push({
      x: c.x / c.count,
      y: c.y / c.count,
      count: c.count,
      events: c.events,
    });
  }
  return out;
}