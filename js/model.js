// Building O model loader shared by the survey map and the site context.
// Locally the model is assets/model/building-o.glb. The shared claude.ai page can't serve .glb files,
// so tools/make_share.ps1 publishes it as JSON ({ "glb": base64 }) and points window.BUILDING_O_MODEL at it.
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export const MODEL_URL = window.BUILDING_O_MODEL || 'assets/model/building-o.glb';

let packed = null;   // one download of the JSON-wrapped model, parsed separately for each viewer

export function loadBuildingModel(onProgress) {
  if (!MODEL_URL.endsWith('.json')) return new GLTFLoader().loadAsync(MODEL_URL, onProgress);
  packed ??= fetch(MODEL_URL)
    .then((r) => { if (!r.ok) throw new Error(`model ${r.status}`); return r.json(); })
    .then(({ glb }) => {
      const s = atob(glb), bytes = new Uint8Array(s.length);
      for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
      return bytes.buffer;
    });
  return packed.then((buf) => new GLTFLoader().parseAsync(buf, ''));
}
