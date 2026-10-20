import sharp from 'sharp';

/** FLUX returns RGB. Remove the explicit chroma backdrop while retaining the white bubble. */
export async function transparentBubble(input: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(input, { limitInputPixels: 4_194_304 }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  // Flood from the edges so pink ingredients enclosed inside a white bubble are preserved.
  const count = info.width * info.height, visited = new Uint8Array(count), queue = new Uint32Array(count);
  let head = 0, tail = 0;
  const visit = (pixel: number) => {
    if (visited[pixel]) return;
    const i = pixel * 4, r = data[i]!, g = data[i + 1]!, b = data[i + 2]!;
    if (data[i + 3]! >= 16 && !(r > g + 15 && b > g + 15 && r > 90 && b > 90)) return;
    visited[pixel] = 1; queue[tail++] = pixel;
  };
  for (let x = 0; x < info.width; x++) { visit(x); visit((info.height - 1) * info.width + x); }
  for (let y = 0; y < info.height; y++) { visit(y * info.width); visit(y * info.width + info.width - 1); }
  while (head < tail) {
    const pixel = queue[head++]!, x = pixel % info.width;
    data[pixel * 4 + 3] = 0;
    if (x) visit(pixel - 1);
    if (x < info.width - 1) visit(pixel + 1);
    if (pixel >= info.width) visit(pixel - info.width);
    if (pixel + info.width < count) visit(pixel + info.width);
  }
  let transparent = 0, borderOpaque = 0;
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    const i = (y * info.width + x) * 4;
    if (data[i + 3]! < 16) transparent++;
    else if (x === 0 || y === 0 || x === info.width - 1 || y === info.height - 1) borderOpaque++;
  }
  const fraction = transparent / (info.width * info.height);
  if (fraction < .15 || fraction > .9 || borderOpaque > (info.width + info.height) * .04) {
    throw new Error('음식 말풍선의 배경 분리 또는 가장자리 검증에 실패했습니다.');
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).trim().png().toBuffer();
}

