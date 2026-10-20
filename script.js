// 1. 引入 AI 库
import { FaceLandmarker, HandLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.8";
import * as Tone from "https://cdn.jsdelivr.net/npm/tone@14.8.49/+esm";

const canvas = document.getElementById('renderCanvas');
const ctx = canvas.getContext('2d');
const video = document.getElementById('webcam');
const startCameraBtn = document.getElementById('audio-overlay');

const img = new Image();
img.src = 'stained-glass.webp'; // 请确保文件名一致

let handLandmarker = null;
let faceLandmarker = null;
let videoStream = null;
let glassRegions = [];
let lastVideoTime = -1;
let currentHandPos = null;
let currentFaceBox = null;

const notes = ["C4", "D4", "E4", "G4", "A4", "C5", "D5", "E5", "G5", "A5"];
let synth = null;

// 2. 初始化摄像头 - 核心修复流程
async function initCamera() {
    try {
        const vision = await FilesetResolver.forVisionTasks(
            "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.8/wasm"
        );
        
        // 使用 CPU 模式，避免 GPU 兼容性问题
        handLandmarker = await HandLandmarker.createFromOptions(vision, {
            baseOptions: {
                modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
                delegate: "CPU"
            },
            runningMode: "VIDEO",
            numHands: 1
        });
        console.log("✅ 手部模型加载成功");

        faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
            baseOptions: {
                modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
                delegate: "CPU"
            },
            runningMode: "VIDEO",
            numFaces: 1
        });
        console.log("✅ 面部模型加载成功");

        // 请求摄像头，使用更明确的约束
        videoStream = await navigator.mediaDevices.getUserMedia({ 
            video: { 
                width: { ideal: 1280 }, 
                height: { ideal: 720 },
                facingMode: "user"
            },
            audio: false
        });
        video.srcObject = videoStream;
        console.log("✅ 摄像头流已获取");

        // 【关键修复】等待 canplay 事件，确保视频真正可以播放后再调用 play()
        video.addEventListener('canplay', () => {
            console.log("视频已就绪，尝试播放...");
            video.play().then(() => {
                console.log("✅ 视频播放成功");
                requestAnimationFrame(renderLoop);
            }).catch(err => {
                console.error("❌ 视频播放失败:", err);
                // 播放失败时的友好提示
                alert("无法播放摄像头画面，请确保已授予摄像头权限，并刷新页面重试。");
            });
        }, { once: true }); // 只触发一次

        // 处理可能出现的错误
        video.addEventListener('error', (e) => {
            console.error("视频元素错误:", e);
        });

    } catch (error) {
        console.error("❌ 初始化失败:", error);
        alert("无法启动摄像头，请检查权限设置。");
    }
}

// 3. 实时检测 (保持不变)
function detectHandsAndFace() {
    if (!handLandmarker || !faceLandmarker || video.readyState < 2) return;
    if (video.currentTime === lastVideoTime) return;
    lastVideoTime = video.currentTime;
    const startTimeMs = performance.now();

    const handResults = handLandmarker.detectForVideo(video, startTimeMs);
    if (handResults.landmarks && handResults.landmarks.length > 0) {
        const indexTip = handResults.landmarks[0][8];
        const canvasX = (1 - indexTip.x) * canvas.width;
        const canvasY = indexTip.y * canvas.height;
        currentHandPos = { x: canvasX, y: canvasY };
        checkCollision(canvasX, canvasY);
    } else {
        currentHandPos = null;
    }

    const faceResults = faceLandmarker.detectForVideo(video, startTimeMs);
    if (faceResults.faceLandmarks && faceResults.faceLandmarks.length > 0) {
        const nose = faceResults.faceLandmarks[0][1];
        const faceX = (1 - nose.x) * canvas.width;
        const faceY = nose.y * canvas.height;
        currentFaceBox = { x: faceX - 50, y: faceY - 50, w: 100, h: 100 };
    } else {
        currentFaceBox = null;
    }
}

function checkCollision(x, y) {
    glassRegions.forEach(region => {
        if (ctx.isPointInPath(region.path, x, y)) {
            if (!region.isLit) {
                region.isLit = true;
                region.brightness = 1.0;
                playNote(region.note);
            }
        }
    });
}

// 4. 渲染与网格 (保持不变)
img.onload = () => {
    canvas.width = img.width;
    canvas.height = img.height;
    generateMockRegions();
    drawDarkState();
};

function generateMockRegions() {
    const cols = 8, rows = 8;
    const w = canvas.width / cols, h = canvas.height / rows;
    for (let i = 0; i < cols; i++) {
        for (let j = 0; j < rows; j++) {
            const points = [
                { x: i * w, y: j * h }, { x: (i + 1) * w, y: j * h },
                { x: (i + 1) * w, y: (j + 1) * h }, { x: i * w, y: (j + 1) * h }
            ];
            const note = notes[Math.floor(Math.random() * notes.length)];
            const path = new Path2D();
            path.moveTo(points[0].x, points[0].y);
            for (let k = 1; k < points.length; k++) path.lineTo(points[k].x, points[k].y);
            path.closePath();
            glassRegions.push({ id: `${i}-${j}`, path, note, isLit: false, brightness: 0 });
        }
    }
}

function drawDarkState() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
    ctx.fillStyle = 'rgba(10, 20, 20, 0.65)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function renderLoop() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
    ctx.fillStyle = 'rgba(10, 20, 20, 0.65)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    detectHandsAndFace();

    glassRegions.forEach(region => {
        if (region.brightness > 0) {
            ctx.save();
            ctx.clip(region.path);
            ctx.fillStyle = `rgba(168, 216, 200, ${region.brightness * 0.7})`;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.shadowBlur = 20 * region.brightness;
            ctx.shadowColor = 'rgba(200, 255, 240, 1)';
            ctx.strokeStyle = `rgba(200, 255, 240, ${region.brightness})`;
            ctx.lineWidth = 2;
            ctx.stroke(region.path);
            ctx.restore();
            region.brightness -= 0.02;
            if (region.brightness <= 0) {
                region.brightness = 0;
                region.isLit = false;
            }
        }
    });

    if (currentHandPos) {
        ctx.beginPath();
        ctx.arc(currentHandPos.x, currentHandPos.y, 10, 0, Math.PI * 2);
        ctx.fillStyle = 'red';
        ctx.fill();
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 2;
        ctx.stroke();
    }
    
    if (currentFaceBox) {
        ctx.strokeStyle = 'rgba(0, 255, 0, 0.5)';
        ctx.lineWidth = 2;
        ctx.strokeRect(currentFaceBox.x, currentFaceBox.y, currentFaceBox.w, currentFaceBox.h);
    }

    requestAnimationFrame(renderLoop);
}

// 5. 音频与入口 (保持不变)
function playNote(note) {
    if (synth && Tone.getContext().state === 'running') {
        synth.triggerAttackRelease(note, "8n");
    }
}

startCameraBtn.addEventListener('click', async () => {
    try {
        await Tone.start();
        if (Tone.getContext().state !== 'running') await Tone.context.resume();
        synth = new Tone.PolySynth(Tone.Synth, {
            oscillator: { type: "sine" },
            envelope: { attack: 0.02, decay: 0.3, sustain: 0.1, release: 1.5 }
        }).toDestination();
        synth.volume.value = -8;
        console.log("✅ 音频已启动");
        startCameraBtn.style.opacity = '0';
        setTimeout(() => startCameraBtn.style.display = 'none', 500);
        await initCamera();
    } catch (error) {
        console.error("❌ 启动失败:", error);
    }
});