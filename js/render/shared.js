// レンダラー共通の uniform と座標変換（浮動原点: 自機位置を原点とする局所平面 x=東, y=上, z=南）
import * as THREE from 'three';
import { DEG } from '../util/math.js';
import { radii } from '../util/geo.js';

export const R_EARTH = 6371000;

export const worldUniforms = {
  uK: { value: new THREE.Vector2(90000, 111000) },
  uDay: { value: 1 },
  uNight: { value: 0 },
  uSunTint: { value: new THREE.Color(1, 1, 1) },
  uFogColor: { value: new THREE.Color(0.7, 0.8, 0.9) },
  uVis: { value: 30000 },
  uCamAlt: { value: 0 },
  uLLPos: { value: new THREE.Vector3() },
  uLLDir: { value: new THREE.Vector3(0, 0, -1) },
  uLLOn: { value: 0 },
  uTime: { value: 0 },
};

export const curvatureChunk = /* glsl */`
  float curvatureDrop(vec2 xz) { return dot(xz, xz) / (2.0 * ${R_EARTH.toFixed(1)}); }
`;

/** 原点（自機）の設定 */
export const origin = { lat: 35, lon: 139, ke: 90000, kn: 111000 };
export function setOrigin(lat, lon) {
  origin.lat = lat; origin.lon = lon;
  const { RM, RN } = radii(lat * DEG);
  origin.ke = RN * Math.cos(lat * DEG) * DEG;
  origin.kn = RM * DEG;
  worldUniforms.uK.value.set(origin.ke, origin.kn);
}

/** 緯度経度高度 → three.js ワールド座標（地球曲率補正込み） */
export function toWorld(lat, lon, h, out = new THREE.Vector3()) {
  const x = (lon - origin.lon) * origin.ke;
  const z = -(lat - origin.lat) * origin.kn;
  out.set(x, h - (x * x + z * z) / (2 * R_EARTH), z);
  return out;
}

/** NED ベクトル → three.js */
export function nedToThree(v, out = new THREE.Vector3()) {
  return out.set(v[1], -v[2], -v[0]);
}

/** 機体姿勢クォータニオン（機体→NED）から three.js 用の回転（モデル: +x 前, +y 上, +z 右） */
export function attitudeToThree(qRotate, q, out = new THREE.Quaternion()) {
  const f = nedToThree(qRotate(q, [1, 0, 0]));
  const r = nedToThree(qRotate(q, [0, 1, 0]));
  const u = nedToThree(qRotate(q, [0, 0, -1]));
  const m = new THREE.Matrix4().makeBasis(f, u, r);
  return out.setFromRotationMatrix(m);
}
