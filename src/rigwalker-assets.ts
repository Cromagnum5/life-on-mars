import * as THREE from "three";

export type RigwalkerAsset = {
  clips: THREE.AnimationClip[];
  instantiate: () => THREE.Object3D;
};

export async function loadRigwalkerAsset(
  url: string,
): Promise<RigwalkerAsset | null> {
  try {
    const [{ GLTFLoader }, SkeletonUtils] = await Promise.all([
      import("three/addons/loaders/GLTFLoader.js"),
      import("three/addons/utils/SkeletonUtils.js"),
    ]);
    const gltf = await new GLTFLoader().loadAsync(url);
    gltf.scene.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = true;
        object.receiveShadow = true;
      }
    });
    return {
      clips: gltf.animations,
      instantiate: () => {
        const model = SkeletonUtils.clone(gltf.scene);
        model.name = "Blender Rigwalker";
        return model;
      },
    };
  } catch (error) {
    console.warn("Rigwalker GLB failed to load; using primitive fallback.", error);
    return null;
  }
}
