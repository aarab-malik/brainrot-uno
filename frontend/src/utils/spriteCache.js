import { allSpriteCandidates } from "@shared/gameLogic.js";

const spriteStatus = new Map();

function statusFor(url) {
  return spriteStatus.get(url) ?? "idle";
}

function setStatus(url, status) {
  spriteStatus.set(url, status);
}

export function toSpriteUrl(fileName) {
  return `/sprites/${fileName}`;
}

export function markSpriteLoaded(url) {
  setStatus(url, "loaded");
}

export function markSpriteFailed(url) {
  setStatus(url, "failed");
}

export function firstUsableCandidateIndex(candidates, startIndex = 0) {
  for (let i = startIndex; i < candidates.length; i += 1) {
    const url = toSpriteUrl(candidates[i]);
    if (statusFor(url) !== "failed") return i;
  }
  return -1;
}

export function preloadSpriteUrl(url) {
  if (typeof window === "undefined" || !url) return;
  const status = statusFor(url);
  if (status === "loaded" || status === "pending" || status === "failed") return;

  setStatus(url, "pending");
  const img = new Image();
  img.decoding = "async";
  img.onload = () => markSpriteLoaded(url);
  img.onerror = () => markSpriteFailed(url);
  img.src = url;
}

export function preloadSpriteCandidates(candidates, limit = 3) {
  for (let i = 0; i < Math.min(limit, candidates.length); i += 1) {
    preloadSpriteUrl(toSpriteUrl(candidates[i]));
  }
}

let warmed = false;
export function warmSpriteCache() {
  if (warmed || typeof window === "undefined") return;
  warmed = true;
  allSpriteCandidates().forEach((fileName) => preloadSpriteUrl(toSpriteUrl(fileName)));
  preloadSpriteUrl("/sprites/cozy-pixel-retreat-stockcake.jpg");
}
