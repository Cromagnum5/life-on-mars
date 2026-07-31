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
        // The body is thirty-three rigid parts hung off the bones, and not one
        // of them ever moves in the frame of the bone it hangs on — every
        // animation channel in the GLB targets a bone, and the pose layers only
        // ever write bone quaternions. So the local matrix is composed once
        // here rather than rebuilt from position, quaternion and scale on every
        // part on every frame: at sixty-four a side that is four thousand two
        // hundred `compose` calls a frame, every one of them arriving at the
        // answer it already had.
        //
        // This is the leaves only. It must not be done to the model root, which
        // the hurl's lunge moves, and `traverse` will not: the root is a Group.
        // `Object3D.copy` carries the matrix and the flag together, so every
        // clone taken below inherits both.
        object.updateMatrix();
        object.matrixAutoUpdate = false;
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
