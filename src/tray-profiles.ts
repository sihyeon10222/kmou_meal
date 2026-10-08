import sharp from 'sharp';
import type { Restaurant } from './story-modes.js';

export interface TraySlot { id: string; shape: 'rect' | 'circle'; x: number; y: number; width: number; height: number; utensil?: boolean }
export interface TrayProfile {
  id: string; version: number; height: number; prompt: string; slots: TraySlot[];
  foodSlots: { rice: string; main: string; soup: string; dessert: string; side: string[] };
}
const rect = (id: string, x: number, y: number, width: number, height: number): TraySlot => ({ id, shape: 'rect', x, y, width, height });
const circle = (id: string, x: number, y: number, diameter: number): TraySlot => ({ id, shape: 'circle', x, y, width: diameter, height: diameter });

// Coordinates share a 1000-unit canvas. Keep the prompt, geometry and version together
// when adding a restaurant-specific tray; masks and cache identity follow this profile.
export const GENERAL_TRAY: TrayProfile = {
  id: 'yellow-general', version: 1, height: 714,
  foodSlots: { rice: 'bottom-left', main: 'bottom-left', soup: 'bottom-right', dessert: 'small-circle',
    side: ['upper-left', 'upper-center-left', 'upper-center-right', 'upper-right'] },
  prompt: 'Glossy warm lemon-yellow (#F8E45C) Korean cafeteria tray, horizontal rounded rectangle, aspect ratio 1.40:1. Exactly 8 recessed compartments: four top rectangular compartments (the center pair equally divided), one small top-right circle, two large bottom rectangles, and a separate narrow vertical utensil capsule at far right. Uniform rounded dividers. Perfect vertical 90-degree overhead product photography, no rotation or perspective.',
  slots: [rect('upper-left', 30, 30, 200, 243), rect('upper-center-left', 248, 30, 126, 243),
    rect('upper-center-right', 392, 30, 126, 243), rect('upper-right', 536, 30, 210, 243),
    circle('small-circle', 852, 30, 93), rect('bottom-left', 30, 291, 420, 307),
    rect('bottom-right', 468, 291, 320, 307), { ...rect('utensils', 852, 141, 100, 478), utensil: true }],
};
export const ROUND_TRAY: TrayProfile = {
  id: 'yellow-round', version: 1, height: 676,
  foodSlots: { rice: 'main', main: 'main', soup: 'lower-right', dessert: 'middle-right', side: ['upper-right'] },
  prompt: 'Glossy warm lemon-yellow (#F8E45C) cafeteria tray, horizontal rounded rectangle, aspect ratio 1.48:1. Exactly 5 compartments: dominant perfectly circular left main well (diameter 74% of tray height), upper-right wide rectangle following the main circle curvature, middle-right small rectangle, lower-right circle, and a separate narrow vertical utensil capsule at far right. Perfect vertical 90-degree overhead product photography, no rotation or perspective.',
  slots: [circle('main', 30, 88, 500), rect('upper-right', 570, 72, 250, 128),
    rect('middle-right', 610, 218, 200, 108), circle('lower-right', 628, 344, 162),
    { ...rect('utensils', 872, 72, 90, 514), utensil: true }],
};
export const ROUND_MENU_PATTERN = /돈가스|돈까스|커틀릿|파스타|스파게티/u;
export const RESTAURANT_TRAYS: Record<Exclude<Restaurant, 'snack'>, { regular: TrayProfile; round?: TrayProfile }> = {
  dormitory: { regular: GENERAL_TRAY, round: ROUND_TRAY },
  badaro: { regular: GENERAL_TRAY }, teacher: { regular: GENERAL_TRAY },
};
export function selectTray(restaurant: Exclude<Restaurant, 'snack'>, meal: string, items: string[]): TrayProfile {
  const profiles = RESTAURANT_TRAYS[restaurant];
  return profiles.round && (meal === 'breakfast' || items.some(item => ROUND_MENU_PATTERN.test(item)))
    ? profiles.round : profiles.regular;
}

function shape(slot: TraySlot, inset = 0): string {
  const { x, y, width, height } = slot;
  return slot.shape === 'circle'
    ? `<circle cx="${x + width / 2}" cy="${y + height / 2}" r="${width / 2 - inset}"/>`
    : `<rect x="${x + inset}" y="${y + inset}" width="${width - inset * 2}" height="${height - inset * 2}" rx="${slot.utensil ? width / 2 : 24}"/>`;
}
function svg(profile: TrayProfile, body: string, definitions = ''): Buffer {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="${profile.height}" viewBox="0 0 1000 ${profile.height}">${definitions}${body}</svg>`);
}
export function traySvg(profile: TrayProfile): Buffer {
  return svg(profile,
    `<rect x="3" y="3" width="994" height="${profile.height - 6}" rx="48" fill="url(#plastic)" stroke="#d5bc42" stroke-width="6"/>`
    + profile.slots.map(slot => `<g fill="url(#well)" stroke="#d1b63c" stroke-width="6">${shape(slot)}</g><g fill="none" stroke="#fff6a8" stroke-width="3">${shape(slot, -4)}</g>`).join(''),
    '<defs><linearGradient id="plastic" x2="0.15" y2="1"><stop stop-color="#fff5a2"/><stop offset=".35" stop-color="#F8E45C"/><stop offset="1" stop-color="#e9ce48"/></linearGradient><linearGradient id="well" x2=".1" y2="1"><stop stop-color="#ddc54b"/><stop offset=".16" stop-color="#f3dd57"/><stop offset=".85" stop-color="#F8E45C"/><stop offset="1" stop-color="#fff09a"/></linearGradient></defs>');
}
export async function trayReference(profile: TrayProfile): Promise<Buffer> {
  // Workers AI requires reference inputs below 512x512, preserving the same framing.
  return sharp(traySvg(profile)).resize({ width: 504 }).flatten({ background: '#ffffff' }).png().toBuffer();
}
export async function compositeTray(profile: TrayProfile, generated: Buffer, occupiedSlots: string[]): Promise<Buffer> {
  const mask = svg(profile, `<g fill="white">${profile.slots.filter(slot => !slot.utensil && occupiedSlots.includes(slot.id)).map(slot => shape(slot, 8)).join('')}</g>`);
  const food = await sharp(generated, { limitInputPixels: 20_000_000 }).resize(1000, profile.height, { fit: 'fill' }).ensureAlpha()
    .composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
  return sharp(traySvg(profile)).composite([{ input: food }]).png().toBuffer();
}
