import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import * as SkeletonUtils from "three/addons/utils/SkeletonUtils.js";

export type RigwalkerAsset = {
  template: THREE.Object3D;
  clips: THREE.AnimationClip[];
};

export async function loadRigwalkerAsset(
  url: string,
): Promise<RigwalkerAsset | null> {
  try {
    const gltf = await new GLTFLoader().loadAsync(url);
    gltf.scene.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = true;
        object.receiveShadow = true;
      }
    });
    return { template: gltf.scene, clips: gltf.animations };
  } catch (error) {
    console.warn("Rigwalker GLB failed to load; using primitive fallback.", error);
    return null;
  }
}

export function instantiateRigwalkerAsset(asset: RigwalkerAsset): {
  model: THREE.Object3D;
  clips: THREE.AnimationClip[];
} {
  const model = SkeletonUtils.clone(asset.template);
  model.name = "Blender Rigwalker";
  return { model, clips: asset.clips };
}
