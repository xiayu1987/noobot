/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { mkdir, readFile, rm } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chromium } from "playwright";

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(import.meta.dirname, "..");
const outputPath = path.join(repositoryRoot, "docs/assets/noobot-character-animation.gif");
const frameRoot = path.join(repositoryRoot, "test-results/character-animation-demo-frames");
const threeRoot = path.join(repositoryRoot, "node_modules/three");
const samplePath = path.join(
  repositoryRoot,
  "plugin/noobot-plugin-character/assets/samples/robot-expressive/RobotExpressive.glb",
);

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Noobot character animation</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; width: 960px; height: 540px; overflow: hidden; background: #08111f; color: #e5edf8; }
    .shell { display: grid; grid-template-columns: 214px 1fr 214px; height: 100%; border: 1px solid #20324c; background: #0c1728; }
    aside { padding: 22px 16px; background: #0a1424; border-right: 1px solid #20324c; }
    aside.right { border-right: 0; border-left: 1px solid #20324c; }
    .brand { display: flex; align-items: center; gap: 10px; margin-bottom: 30px; color: #77b5ff; font-size: 17px; font-weight: 750; }
    .logo { display: grid; width: 28px; height: 28px; place-items: center; border-radius: 8px; background: #2d7ff9; color: white; font-size: 15px; }
    .label { margin: 0 0 8px; color: #7890ae; font-size: 11px; letter-spacing: .08em; text-transform: uppercase; }
    .prompt { padding: 11px 12px; border: 1px solid #294263; border-radius: 7px; color: #c7d5e8; font-size: 12px; line-height: 1.45; background: #101f34; }
    .asset { margin-top: 22px; padding: 12px; border: 1px solid #27598f; border-radius: 7px; background: #102b4c; }
    .asset strong { display: block; margin-bottom: 5px; font-size: 12px; }
    .asset span { color: #8fa8c5; font-size: 11px; }
    main { position: relative; display: grid; grid-template-rows: 54px 1fr 44px; min-width: 0; }
    .topbar { display: flex; align-items: center; justify-content: space-between; padding: 0 18px; border-bottom: 1px solid #20324c; }
    .topbar strong { font-size: 14px; }
    .session { color: #7f98b7; font-size: 11px; }
    .viewport { position: relative; min-height: 0; }
    canvas { display: block; width: 100%; height: 100%; }
    .status { position: absolute; right: 14px; bottom: 14px; left: 14px; padding: 9px 12px; border: 1px solid #27466d; border-radius: 7px; background: rgba(8, 17, 31, .86); font-size: 12px; }
    .status-line { display: flex; align-items: center; gap: 8px; }
    .dot { width: 7px; height: 7px; border-radius: 50%; background: #49d69a; box-shadow: 0 0 10px #49d69a; }
    .dot.pending { background: #f3b95f; box-shadow: 0 0 10px #f3b95f; }
    .progress { height: 4px; margin-top: 8px; overflow: hidden; border-radius: 99px; background: #1a2a40; }
    .progress > i { display: block; width: 0; height: 100%; border-radius: inherit; background: #55a1ff; transition: width .1s linear; }
    .bottom { display: flex; align-items: center; justify-content: space-between; padding: 0 18px; border-top: 1px solid #20324c; color: #7890ae; font-size: 11px; }
    .badge { padding: 4px 8px; border: 1px solid #2e5d8f; border-radius: 5px; color: #91c4ff; }
    .steps { display: grid; gap: 12px; margin-top: 4px; }
    .step { display: grid; grid-template-columns: 21px 1fr; gap: 8px; align-items: center; color: #728aa7; font-size: 11px; }
    .step b { display: grid; width: 21px; height: 21px; place-items: center; border: 1px solid #304761; border-radius: 50%; font-size: 10px; font-weight: 600; }
    .step.active { color: #dbeafe; }
    .step.active b { border-color: #56a5ff; color: #84c0ff; }
    .step.done { color: #8ed9b8; }
    .step.done b { border-color: #3ba97b; color: #72d6a7; }
    .meta { margin-top: 25px; padding-top: 17px; border-top: 1px solid #20324c; color: #7890ae; font-size: 11px; line-height: 1.7; }
    .meta code { color: #b7d5f7; font-size: 10px; }
  </style>
</head>
<body>
  <div class="shell">
    <aside>
      <div class="brand"><span class="logo">N</span><span>Noobot</span></div>
      <p class="label">Animation request</p>
      <div class="prompt">Wave to the camera for 2 seconds, then finish.</div>
      <div class="asset"><strong>RobotExpressive.glb</strong><span>14 native clips · shared skeleton</span></div>
      <div class="meta">The model supplies intent.<br>The plugin validates the protocol.<br>Three.js renders the result.</div>
    </aside>
    <main>
      <div class="topbar"><strong>Session artifact · character animation</strong><span class="session">animationId: e2e.character.demo</span></div>
      <div class="viewport"><canvas id="canvas"></canvas><div class="status"><div class="status-line"><i class="dot pending"></i><span id="statusText">Waiting for animation protocol…</span></div><div class="progress"><i id="progress"></i></div></div></div>
      <div class="bottom"><span>noobot.animation.protocol v1</span><span id="phase" class="badge">GENERATING</span></div>
    </main>
    <aside class="right">
      <p class="label">Generation pipeline</p>
      <div class="steps">
        <div class="step" data-step="0"><b>1</b><span>Read asset metadata</span></div>
        <div class="step" data-step="1"><b>2</b><span>Generate keyframes</span></div>
        <div class="step" data-step="2"><b>3</b><span>Commit Session artifact</span></div>
        <div class="step" data-step="3"><b>4</b><span>Play and verify</span></div>
      </div>
      <div class="meta"><code>characters[0]</code><br>assetId: sample.three.robot-expressive<br>clip: Wave<br>duration: 2s<br>loop: false</div>
    </aside>
  </div>
  <script type="importmap">{"imports":{"three":"/vendor/three.module.js","three/addons/":"/vendor/examples/jsm/"}}</script>
  <script type="module">
    import * as THREE from "three";
    import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
    const canvas = document.querySelector("#canvas");
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor("#08111f");
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, 1, .01, 100);
    scene.add(new THREE.HemisphereLight("#eef7ff", "#20334c", 2.5));
    const key = new THREE.DirectionalLight("#ffffff", 2.4);
    key.position.set(2, 4, 3);
    scene.add(key);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(3, 48), new THREE.MeshBasicMaterial({ color: "#132640", transparent: true, opacity: .8 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = .02;
    scene.add(floor);
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync("/asset/RobotExpressive.glb");
    const model = gltf.scene;
    const box = new THREE.Box3().setFromObject(model);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    model.position.sub(center);
    model.position.y += size.y / 2;
    scene.add(model);
    // Frame the complete imported asset instead of relying on a model-specific camera distance.
    const verticalFov = THREE.MathUtils.degToRad(camera.fov);
    const cameraDistance = (size.y / 2) / Math.tan(verticalFov / 2) * 1.18;
    camera.position.set(0, size.y * 0.5, cameraDistance);
    camera.lookAt(0, size.y * 0.48, 0);
    const mixer = new THREE.AnimationMixer(model);
    const wave = THREE.AnimationClip.findByName(gltf.animations, "Wave");
    const idle = THREE.AnimationClip.findByName(gltf.animations, "Idle");
    const waveAction = mixer.clipAction(wave || gltf.animations[0]);
    const idleAction = mixer.clipAction(idle || gltf.animations[0]);
    idleAction.play();
    window.__characterDemoReady = true;
    const clock = new THREE.Clock();
    const started = performance.now();
    const duration = 7600;
    function resize() {
      const width = canvas.clientWidth || 532;
      const height = canvas.clientHeight || 440;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    }
    function setStep(index) {
      document.querySelectorAll(".step").forEach((node, current) => {
        node.classList.toggle("active", current === index);
        node.classList.toggle("done", current < index);
      });
    }
    function tick() {
      const elapsed = performance.now() - started;
      const progress = Math.min(1, elapsed / duration);
      resize();
      if (elapsed < 1200) {
        setStep(0);
        document.querySelector("#statusText").textContent = "Reading GLB clips and skeleton…";
        document.querySelector("#phase").textContent = "GENERATING";
      } else if (elapsed < 2300) {
        setStep(1);
        document.querySelector("#statusText").textContent = "LLM returned a validated animation protocol";
      } else if (elapsed < 3000) {
        setStep(2);
        document.querySelector("#statusText").textContent = "Committed to Session artifact e2e.character.demo";
      } else if (elapsed < 6500) {
        setStep(3);
        document.querySelector("#statusText").textContent = "Executing Wave clip · 2 seconds · loop false";
        document.querySelector("#phase").textContent = "PLAYING";
        if (!waveAction.isRunning()) {
          idleAction.stop();
          waveAction.reset().setLoop(THREE.LoopOnce, 1).play();
        }
      } else {
        setStep(4);
        document.querySelector("#statusText").textContent = "Animation execution completed successfully";
        document.querySelector("#phase").textContent = "COMPLETED";
        document.querySelector(".dot").classList.remove("pending");
      }
      document.querySelector("#progress").style.width = String(Math.round(progress * 100)) + "%";
      mixer.update(clock.getDelta());
      renderer.render(scene, camera);
      if (elapsed < duration) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  </script>
</body>
</html>`;

function serve() {
  return new Promise((resolve) => {
    const server = http.createServer(async (request, response) => {
      const pathname = new URL(request.url || "/", "http://127.0.0.1").pathname;
      if (pathname === "/") {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(html);
        return;
      }
      const file =
        pathname === "/asset/RobotExpressive.glb"
          ? samplePath
          : pathname === "/vendor/three.module.js"
            ? path.join(threeRoot, "build/three.module.js")
            : pathname === "/vendor/three.core.js"
              ? path.join(threeRoot, "build/three.core.js")
              : pathname.startsWith("/vendor/examples/")
                ? path.join(threeRoot, pathname.replace("/vendor/", ""))
                : "";
      if (!file || (!file.startsWith(threeRoot) && file !== samplePath)) {
        response.writeHead(404);
        response.end();
        return;
      }
      try {
        const body = await readFile(file);
        response.writeHead(200, {
          "content-type": file.endsWith(".glb")
            ? "model/gltf-binary"
            : "text/javascript; charset=utf-8",
        });
        response.end(body);
      } catch {
        response.writeHead(404);
        response.end();
      }
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

await rm(frameRoot, { recursive: true, force: true });
await mkdir(frameRoot, { recursive: true });
const server = await serve();
const address = server.address();
const port = typeof address === "object" && address ? address.port : 0;
const browser = await chromium.launch({ headless: true, chromiumSandbox: false });
try {
  const page = await browser.newPage({
    viewport: { width: 960, height: 540 },
    deviceScaleFactor: 1,
  });
  page.on("pageerror", (error) => console.error(`[character-demo] pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "log")
      console.error(`[character-demo] ${message.text()}`);
  });
  page.on("response", (response) => {
    if (response.status() >= 400)
      console.error(`[character-demo] ${response.status()} ${response.url()}`);
  });
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.__characterDemoReady === true, { timeout: 30000 });
  for (let frame = 0; frame < 76; frame += 1) {
    await page.screenshot({
      path: path.join(frameRoot, `frame-${String(frame).padStart(3, "0")}.png`),
    });
    await page.waitForTimeout(100);
  }
} finally {
  await browser.close();
  server.close();
}
await execFileAsync("ffmpeg", [
  "-y",
  "-framerate",
  "10",
  "-i",
  path.join(frameRoot, "frame-%03d.png"),
  "-vf",
  "fps=10,scale=960:-1:flags=lanczos,split[s0][s1];[s0]palettegen=stats_mode=diff[p];[s1][p]paletteuse=dither=sierra2_4a",
  "-loop",
  "0",
  outputPath,
]);
await rm(frameRoot, { recursive: true, force: true });
console.log(`generated ${outputPath}`);
