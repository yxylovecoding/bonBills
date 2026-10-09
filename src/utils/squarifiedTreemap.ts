// Squarified treemap 算法（Bruls / Huijing / van Wijk, 2000）。
// 把一组带权数据铺满给定矩形，各块面积严格等于 value / Σvalue × 容器面积，无缝隙。
// 自己实现而不是引 d3-hierarchy / squarify，是为了避免额外依赖；逻辑只有 ~60 行。

export interface TreemapInput { id: string; value: number; }
export interface TreemapRect { id: string; x: number; y: number; width: number; height: number; }

interface Scaled { id: string; value: number; }
interface Rect { x: number; y: number; w: number; h: number; }

// 计算在短边 side 上，当前 row 中最差 aspect ratio。越小越方正。
function worstRatio(row: Scaled[], side: number): number {
  if (!row.length || side <= 0) return Infinity;
  let sum = 0, rmin = Infinity, rmax = -Infinity;
  for (const r of row) { sum += r.value; if (r.value < rmin) rmin = r.value; if (r.value > rmax) rmax = r.value; }
  const s2 = sum * sum, side2 = side * side;
  if (!s2) return Infinity;
  return Math.max((side2 * rmax) / s2, s2 / (side2 * rmin));
}

// 把 row 铺到 rect 的短边一侧（最左/最上），返回剩余矩形。
function placeRow(row: Scaled[], rect: Rect, out: TreemapRect[]): Rect {
  const sum = row.reduce((s, r) => s + r.value, 0);
  if (!sum) return rect;
  if (rect.w >= rect.h) {
    const stripW = sum / rect.h;
    let y = rect.y;
    for (const r of row) {
      const h = (r.value / sum) * rect.h;
      out.push({ id: r.id, x: rect.x, y, width: stripW, height: h });
      y += h;
    }
    return { x: rect.x + stripW, y: rect.y, w: rect.w - stripW, h: rect.h };
  }
  const stripH = sum / rect.w;
  let x = rect.x;
  for (const r of row) {
    const w = (r.value / sum) * rect.w;
    out.push({ id: r.id, x, y: rect.y, width: w, height: stripH });
    x += w;
  }
  return { x: rect.x, y: rect.y + stripH, w: rect.w, h: rect.h - stripH };
}

export function squarifiedTreemap(items: TreemapInput[], width: number, height: number): TreemapRect[] {
  if (width <= 0 || height <= 0) return [];
  const positive = items.filter(i => i.value > 0);
  const total = positive.reduce((s, i) => s + i.value, 0);
  if (!total) return [];
  const area = width * height;
  // 把 value 归一化成"占据面积"，便于 worstRatio 对比。
  const scaled: Scaled[] = positive.map(i => ({ id: i.id, value: (i.value / total) * area }));
  scaled.sort((a, b) => b.value - a.value);
  const out: TreemapRect[] = [];
  let rect: Rect = { x: 0, y: 0, w: width, h: height };
  let row: Scaled[] = [];
  for (const item of scaled) {
    const side = Math.min(rect.w, rect.h);
    const trial = [...row, item];
    if (!row.length || worstRatio(trial, side) <= worstRatio(row, side)) {
      row = trial;
    } else {
      rect = placeRow(row, rect, out);
      row = [item];
    }
  }
  if (row.length) placeRow(row, rect, out);
  return out;
}
