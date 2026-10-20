// 引入 MediaPipe
import { HandLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3";

// --- 1. 基础变量与配置 ---
const canvas = document.getElementById('renderCanvas');
const ctx = canvas.getContext('2d');
const video = document.getElementById('webcam');
const overlay = document.getElementById('audio-overlay');
const img = new Image();
img.src = 'stained-glass.webp'; // 请确保图片文件名一致

let glassRegions = []; // 存储玻璃块的多边形数据
let handLandmarker;
let lastVideoTime = -1;

// 音符映射 (五声音阶，避免刺耳)
const notes = ["C4", "D4", "E4", "G4", "A4", "C5", "D5", "E5", "G5", "A5"];
let synth;

// --- 2. 图像与区域划分 ---
img.onload = () => {
    canvas.width = img.width;
    canvas.height = img.height;
    
    // 【重点说明】这里为了演示，使用网格模拟玻璃块。
    // 如果你有了真实的SVG坐标，请替换这里 glassRegions 的数据生成逻辑。
    generateMockRegions();
    
    drawDarkState(); // 初始绘制昏暗状态
    initMediaPipe(); // 启动摄像头和手势识别
};

// 生成模拟网格区域（用于跑通代码）
function generateMockRegions() {
    const cols = 8;
    const rows = 8;
    const w = canvas.width / cols;
    const h = canvas.height / rows;

    for (let i = 0; i < cols; i++) {
        for (let j = 0; j < rows; j++) {
            // 定义多边形顶点 (这里是一个四边形)
            const points = [
                { x: i * w, y: j * h },
                { x: (i + 1) * w, y: j * h },
                { x: (i + 1) * w, y: (j + 1) * h },
                { x: i * w, y: (j + 1) * h }
            ];

            // 为每个区域分配一个随机音符
            const note = notes[Math.floor(Math.random() * notes.length)];
            
            // 使用 Path2D 预构建路径，极大提升碰撞检测性能
            const path = new Path2D();
            path.moveTo(points[0].x, points[0].y);
            for(let k=1; k<points.length; k++) path.lineTo(points[k].x, points[k].y);
            path.closePath();

            glassRegions.push({
                id: `${i}-${j}`,
                path: path,
                note: note,
                isLit: false,
                brightness: 0 // 0 到 1
            });
        }
    }
}

// --- 3. 渲染逻辑 ---

// 绘制初始黑暗状态
function drawDarkState() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // 底图
    ctx.drawImage(img, 0, 0);
    
    // 覆盖一层深色遮罩模拟昏暗
    ctx.fillStyle = 'rgba(10, 20, 20, 0.85)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
}

// 渲染循环
function render() {
    // 1. 绘制底图
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
    
    // 2. 绘制昏暗遮罩
    ctx.fillStyle = 'rgba(10, 20, 20, 0.85)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 3. 检测手势
    detectHand();

    // 4. 绘制发光区域
    glassRegions.forEach(region => {
        // 如果被点亮，或者余辉未消散
        if (region.brightness > 0) {
            ctx.save();
            
            // 裁剪区域
            ctx.clip(region.path);

            // 获取原本的颜色（这里简单用颜色叠加，如果真实提取，可以直接绘制裁剪后的原图）
            const alpha = region.brightness * 0.7;
            ctx.fillStyle = `rgba(168, 216, 200, ${alpha})`; // 偏青绿色的亮光
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            
            // 绘制发光边缘 (Shadow Blur)
            ctx.shadowBlur = 20 * region.brightness;
            ctx.shadowColor = 'rgba(200, 255, 240, 1)';
            // 重新描边该路径以产生发光
            ctx.strokeStyle = `rgba(200, 255, 240, ${region.brightness})`;
            ctx.lineWidth = 2;
            ctx.stroke(region.path);

            ctx.restore();

            // 亮度缓慢衰减 (余辉效果)
            region.brightness -= 0.02;
            if (region.brightness < 0) region.brightness = 0;
            if (region.brightness === 0) region.isLit = false;
        }
    });

    requestAnimationFrame(render);
}

// --- 4. MediaPipe 手势追踪与音频 ---

async function initMediaPipe() {
    const vision = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm"
    );
    handLandmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: {
            modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
            delegate: "GPU"
        },
        runningMode: "VIDEO",
        numHands: 1
    });

    // 启动摄像头
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        video.srcObject = stream;
        video.addEventListener("loadeddata", () => {
            render(); // 启动渲染循环
        });
    }
}

function detectHand() {
    if (!handLandmarker || video.readyState !== 2) return;
    
    const startTimeMs = performance.now();
    // 节流，不需要每一帧都进行复杂的模型推理
    if (video.currentTime === lastVideoTime) return;
    lastVideoTime = video.currentTime;

    const results = handLandmarker.detectForVideo(video, startTimeMs);
    
    if (results.landmarks && results.landmarks.length > 0) {
        // 取食指指尖 (索引为8)
        const indexTip = results.landmarks[0][8];
        
        // 坐标映射：摄像头是镜像的，x轴需要翻转
        const handX = (1 - indexTip.x) * canvas.width;
        const handY = indexTip.y * canvas.height;

        // 绘制一个视觉反馈点（可选，调试用）
        // ctx.beginPath();
        // ctx.arc(handX, handY, 10, 0, Math.PI * 2);
        // ctx.fillStyle = 'red';
        // ctx.fill();

        checkCollision(handX, handY);
    }
}

function checkCollision(x, y) {
    // 使用 Path2D 的 isPointInPath 进行高效碰撞检测
    glassRegions.forEach(region => {
        if (ctx.isPointInPath(region.path, x, y)) {
            // 如果进入了一个未点亮的区域
            if (!region.isLit) {
                region.isLit = true;
                region.brightness = 1.0; // 瞬间点亮
                playNote(region.note);   // 触发声音
            }
        }
    });
}

// --- 5. 音频逻辑 ---
function initAudio() {
    synth = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: "sine" },
        envelope: { attack: 0.02, decay: 0.3, sustain: 0.1, release: 1.5 } // 类似玻璃的余音
    }).toDestination();
    synth.volume.value = -8; // 调低总音量
}

function playNote(note) {
    if (synth) {
        synth.triggerAttackRelease(note, "8n");
    }
}

// 用户点击遮罩层，启动 AudioContext 和摄像头授权
overlay.addEventListener('click', async () => {
    await Tone.start(); // 必须先由用户交互触发
    initAudio();
    overlay.style.opacity = '0';
    setTimeout(() => overlay.remove(), 500); // 移除遮罩
});