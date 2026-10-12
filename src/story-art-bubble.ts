import sharp from 'sharp';
import type { ArtMeal, ArtRect } from './story-art-layout.js';
import { bubbleBodyHeight } from './story-art-layout.js';

/** Keep the enclosed cloud, removing detached AI-generated dots before drawing a consistent trail. */
export async function cloudBody(input: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const count = info.width * info.height;
  const labels = new Int32Array(count), queue = new Int32Array(count);
  let label = 0, largest = 0, largestSize = 0;
  for (let start = 0; start < count; start++) {
    if (labels[start] || data[start * 4 + 3]! <= 16) continue;
    label++;
    let head = 0, tail = 1;
    queue[0] = start; labels[start] = label;
    const visit = (pixel: number) => {
      if (!labels[pixel] && data[pixel * 4 + 3]! > 16) {
        labels[pixel] = label; queue[tail++] = pixel;
      }
    };
    while (head < tail) {
      const pixel = queue[head++]!, x = pixel % info.width;
      if (x) visit(pixel - 1);
      if (x < info.width - 1) visit(pixel + 1);
      if (pixel >= info.width) visit(pixel - info.width);
      if (pixel + info.width < count) visit(pixel + info.width);
    }
    if (tail > largestSize) { largest = label; largestSize = tail; }
  }
  if (!largestSize) throw new Error('말풍선 본체가 없습니다.');
  for (let pixel = 0; pixel < count; pixel++) if (labels[pixel] !== largest) data[pixel * 4 + 3] = 0;
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).trim().png().toBuffer();
}

/** All three outlined circles stay inside the collision-checked bubble rectangle. */
export async function renderThoughtBubble(input: Buffer, meal: ArtMeal, box: ArtRect, character: ArtRect): Promise<Buffer> {
  // Reserve a separate trail below the larger cloud; circles keep their existing size.
  const scale = Math.max(.6, box.width / 375);
  const body = await sharp(await cloudBody(input))
    .resize(box.width, bubbleBodyHeight(box), { fit: 'inside' }).png().toBuffer({ resolveWithObject: true });
  const center = box.width / 2;
  const target = Math.max(center - box.width * .3, Math.min(center + box.width * .3,
    character.x + character.width * .58 - box.x));
  const color = meal === 'lunch' ? '#FFD577' : '#71CDEB';
  let y = body.info.height + 8 * scale;
  const circles = [10, 7, 4].map((radius, index) => {
    const r = radius * scale;
    y += r;
    const x = center + (target - center) * (index + 1) / 3;
    const circle = `<circle cx="${x}" cy="${y}" r="${r}" fill="white" stroke="${color}" stroke-width="${Math.max(1.5, 3 * scale)}"/>`;
    y += r + 7 * scale;
    return circle;
  });
  const trail = Buffer.from(`<svg width="${box.width}" height="${box.height}" xmlns="http://www.w3.org/2000/svg">${circles.join('')}</svg>`);
  return sharp({ create: { width: box.width, height: box.height, channels: 4, background: '#00000000' } })
    .composite([{ input: body.data, left: Math.round((box.width - body.info.width) / 2), top: 0 }, { input: trail, left: 0, top: 0 }])
    .png().toBuffer();
}
