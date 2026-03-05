import {
  Engine, Scene, ArcRotateCamera, Vector3, Color3, Color4,
  HemisphericLight, DirectionalLight,
  SceneLoader, CubeTexture, DefaultRenderingPipeline,
  CascadedShadowGenerator, MeshBuilder, PBRMaterial,
  SSAO2RenderingPipeline,
} from '@babylonjs/core';
import '@babylonjs/loaders/glTF';

function init() {
  const canvas = document.getElementById('canvas') as HTMLCanvasElement;
  const engine = new Engine(canvas, true, {
    preserveDrawingBuffer: true,
    stencil: true,
  });
  const scene = new Scene(engine);
  scene.clearColor = new Color4(1, 1, 1, 1);

  // No tone mapping — direct color control for clean white background
  scene.imageProcessingConfiguration.toneMappingEnabled = false;

  // White fog to blend ground horizon into background
  scene.fogMode = Scene.FOGMODE_LINEAR;
  scene.fogColor = new Color3(1, 1, 1);
  scene.fogStart = 8;
  scene.fogEnd = 25;

  // Camera
  const camera = new ArcRotateCamera(
    'camera',
    Math.PI + Math.PI / 6,
    Math.PI / 2.5,
    5.0,
    new Vector3(0, 0, 0),
    scene,
  );
  camera.lowerRadiusLimit = 2;
  camera.upperRadiusLimit = 8;
  camera.wheelPrecision = 50;
  camera.panningSensibility = 0;
  camera.attachControl(canvas, true);
  camera.minZ = 0.1;

  // Environment
  scene.environmentTexture = CubeTexture.CreateFromPrefilteredData(
    'https://assets.babylonjs.com/environments/environmentSpecular.env',
    scene,
  );
  scene.environmentIntensity = 0.6;

  // Lights
  const hemiLight = new HemisphericLight('hemi', new Vector3(0, 1, 0), scene);
  hemiLight.intensity = 0.6;
  hemiLight.groundColor = new Color3(0.35, 0.35, 0.4);

  const keyLight = new DirectionalLight('key', new Vector3(0, -1, 0), scene);
  keyLight.position = new Vector3(0, 10, 0);
  keyLight.intensity = 0.6;
  keyLight.autoCalcShadowZBounds = true;

  const fillLight = new DirectionalLight('fill', new Vector3(1, -0.5, 1).normalize(), scene);
  fillLight.intensity = 0.35;

  const rimLight = new DirectionalLight('rim', new Vector3(0, -1, -2).normalize(), scene);
  rimLight.intensity = 0.45;

  // Shadow map (contact shadow under shoe)
  const shadowGen = new CascadedShadowGenerator(2048, keyLight);
  shadowGen.penumbraDarkness = 0.0;
  shadowGen.shadowMaxZ = 10;
  shadowGen.bias = 0.005;
  shadowGen.normalBias = 0.02;
  shadowGen.useContactHardeningShadow = true;
  shadowGen.contactHardeningLightSizeUVRatio = 0.4;
  shadowGen.filteringQuality = CascadedShadowGenerator.QUALITY_HIGH;

  // SSAO2 for soft ambient contact shadows
  const ssao = new SSAO2RenderingPipeline('ssao', scene, {
    ssaoRatio: 1.0,
    blurRatio: 1.0,
  });
  ssao.radius = 2.0;
  ssao.totalStrength = 1.5;
  ssao.base = 0.5;
  ssao.samples = 32;
  ssao.maxZ = 100;
  ssao.minZAspect = 0.5;
  ssao.expensiveBlur = true;
  scene.postProcessRenderPipelineManager.attachCamerasToRenderPipeline('ssao', camera);

  // Ground
  const ground = MeshBuilder.CreateGround('ground', { width: 100, height: 100 }, scene);
  ground.position.y = -1.2;
  ground.receiveShadows = true;

  const groundMat = new PBRMaterial('groundMat', scene);
  groundMat.albedoColor = new Color3(1.0, 1.0, 1.0);
  groundMat.metallic = 0.0;
  groundMat.roughness = 1.0;
  groundMat.environmentIntensity = 0.3;
  ground.material = groundMat;

  // Load shoe model
  SceneLoader.ImportMeshAsync('', '/models/', 'shoe.glb', scene).then((result) => {
    const meshes = result.meshes;

    // Center and scale
    let min = new Vector3(Infinity, Infinity, Infinity);
    let max = new Vector3(-Infinity, -Infinity, -Infinity);

    for (const mesh of meshes) {
      if (!mesh.getBoundingInfo) continue;
      const bb = mesh.getBoundingInfo().boundingBox;
      min = Vector3.Minimize(min, bb.minimumWorld);
      max = Vector3.Maximize(max, bb.maximumWorld);
    }

    const center = Vector3.Center(min, max);
    const size = max.subtract(min);
    const maxDim = Math.max(size.x, size.y, size.z);
    const scale = 2.5 / maxDim;

    const root = meshes[0];
    root.position = center.negate().scale(scale);
    root.scaling.setAll(scale);

    // Tint + shadow casters
    const tints: Color3[] = [
      new Color3(0.95, 0.95, 0.95),
      new Color3(0.95, 0.95, 0.95),
      new Color3(0.15, 0.15, 0.5),
      new Color3(0.15, 0.15, 0.5),
      new Color3(0.9, 0.9, 0.9),
      new Color3(0.5, 0.82, 0.08),
      new Color3(0.95, 0.95, 0.95),
      new Color3(0.5, 0.82, 0.08),
    ];

    let childIdx = 0;
    for (const mesh of meshes) {
      if (!mesh.getTotalVertices || mesh.getTotalVertices() === 0) {
        continue;
      }
      shadowGen.addShadowCaster(mesh);
      mesh.receiveShadows = true;

      const mat = mesh.material as PBRMaterial | null;
      if (mat && childIdx < tints.length) {
        mat.albedoColor = tints[childIdx];
      }
      childIdx++;
    }

    // Position ground below shoe (floating)
    const scaledMin = min.scale(scale);
    ground.position.y = -center.y * scale + scaledMin.y - 0.3;

    camera.target = new Vector3(0, -0.1, 0);

  }).catch((err) => {
    console.error('Failed to load shoe model:', err);
  });

  // Post-processing
  const pipeline = new DefaultRenderingPipeline('default', true, scene, [camera]);
  pipeline.fxaaEnabled = true;
  pipeline.bloomEnabled = false;
  pipeline.sharpenEnabled = true;
  pipeline.sharpen.edgeAmount = 0.15;
  pipeline.imageProcessingEnabled = true;

  // Subtle vignette
  pipeline.imageProcessing.vignetteEnabled = true;
  pipeline.imageProcessing.vignetteWeight = 0.4;
  pipeline.imageProcessing.vignetteStretch = 0;
  pipeline.imageProcessing.vignetteColor = new Color4(0, 0, 0, 1);

  engine.runRenderLoop(() => {
    scene.render();
  });

  window.addEventListener('resize', () => {
    engine.resize();
  });
}

init();
