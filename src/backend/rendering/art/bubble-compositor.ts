import { frontendAsset } from '../../config/paths.js';
import { readFile } from 'node:fs/promises';
import { type ArtMeal, type ArtRect, bubbleBodyHeight } from '../../../frontend/story/art-placement.js';

import sharp from 'sharp';

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

/** The cloud, heading and icon are local artwork; AI supplies only the dish. */
export async function renderThoughtBubble(input: Buffer, meal: ArtMeal, box: ArtRect, character: ArtRect): Promise<Buffer> {
  const scale = Math.max(.6, box.width / 375);
  const bodyHeight = bubbleBodyHeight(box);
  const color = meal === 'lunch' ? '#FFD577' : '#71CDEB';
  const cloud = Buffer.from(`<svg width="400" height="360" xmlns="http://www.w3.org/2000/svg">
    <path d="M72 84 C65 42 112 20 148 39 C177 2 234 3 259 36 C303 16 347 44 340 85 C386 91 407 138 379 172 C409 212 390 256 352 268 C351 314 304 341 269 322 C243 359 189 360 161 329 C117 348 72 324 70 284 C22 282 1 238 26 203 C-2 166 15 118 58 112 C55 99 63 88 72 84 Z" fill="white" stroke="${color}" stroke-width="8" stroke-linejoin="round"/>
    ${meal === 'lunch'
      ? `<g transform="translate(37 24)" stroke="#FFCB46" stroke-width="5" stroke-linecap="round"><path d="M88 59v-7 M88 112v7 M61 85h-7 M115 85h7 M69 66l-5-5 M107 104l5 5 M69 104l-5 5 M107 66l5-5"/><circle cx="88" cy="85" r="17" fill="#FFD34E"/></g>`
      : `<path transform="translate(37 24)" d="M101 62 A24 24 0 1 0 107 102 A22 22 0 0 1 101 62 Z" fill="#FFD34E"/>`}
  </svg>`);
  const title = await readFile(frontendAsset(`illustrations/story-${meal}-heading.png`));
  const food = await sharp(await cloudBody(input)).resize(260, 166, { fit: 'inside' }).png().toBuffer({ resolveWithObject: true });
  const composedBody = await sharp(cloud).composite([
    { input: title, left: 176, top: 88 },
    { input: food.data, left: Math.round((400 - food.info.width) / 2), top: 150 + Math.round((166 - food.info.height) / 2) },
  ]).png().toBuffer();
  const body = await sharp(composedBody).resize(box.width, bodyHeight, { fit: 'fill' }).png().toBuffer();
  const center = box.width / 2;
  const target = Math.max(center - box.width * .3, Math.min(center + box.width * .3,
    character.x + character.width * .58 - box.x));
  let y = bodyHeight + 8 * scale;
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
    .composite([{ input: body, left: 0, top: 0 }, { input: trail, left: 0, top: 0 }])
    .png().toBuffer();
}
