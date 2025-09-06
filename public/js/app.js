"use strict";

/* ===== Defaults you can tweak ===== */
const THRESHOLD = 0.20;
const FLIP_X_FOR_MODEL = true;
const FIXED_RES = {width:1280, height:720};
const LETTER_STABLE = 8;
const LETTER_COOLDOWN = 6;
const AUTO_MIN_INTERVAL_MS = 3000;
const CMD_STABLE = 6;
const CMD_COOLDOWN = 12;
/* ================================== */

const MODEL_FILE  = "/models/handitalk_landmarks.tflite";
const LABELS_FILE = "/models/class_names_landmarks.json";

const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const stage  = document.getElementById("stage");
const ctx = canvas.getContext("2d");

const predEl = document.getElementById("pred");
const chipHands = document.getElementById("chipHands");
const chipShape = document.getElementById("chipShape");
const statusEl = document.getElementById("status");
const fpsEl = document.getElementById("fps");
const kvDev = document.getElementById("kvDev");
const kvModel = document.getElementById("kvModel");
const kvRun = document.getElementById("kvRun");
const kvErr = document.getElementById("kvErr");
const modeChip = document.getElementById("modeChip");

const btnStart = document.getElementById("btnStart");
const btnStop  = document.getElementById("btnStop");
const btnFlip  = document.getElementById("btnFlip");
const btnTest  = document.getElementById("btnTest");
const btnMode  = document.getElementById("btnMode");

const chkMirror = document.getElementById("chkMirror");
const chkLower = document.getElementById("chkLower");

const textOutEl = document.getElementById("textOut");
const btnCommit = document.getElementById("btnCommit");
const btnSpace = document.getElementById("btnSpace");
const btnBack = document.getElementById("btnBack");
const btnClearText = document.getElementById("btnClearText");
const btnCopy = document.getElementById("btnCopy");
const btnSpeak = document.getElementById("btnSpeak");

let stream=null, usingFront=true, running=false, lastTs=performance.now();
let hands=null, tfliteModel=null, classNames=[], shapeMode=null;

let textOut = localStorage.getItem("handitalk_text") || "";
renderText();

let currLabel=null, currCount=0, cooldown=0, dippedSinceCommit=true;
let lastTopChar=null, lastTopConf=0, lastTopRawLabel="";
let autoMode=false; // Free by default
let nextAutoAt = 0;

let cmdCurr=null, cmdCount=0, cmdCooldown=0;

// IMPORTANT: point WASM path to root-relative folder
if (window.tflite?.setWasmPath) window.tflite.setWasmPath("/libs/tflite/");

const clamp01 = v => Math.max(0, Math.min(1, v));
const setErr = e => { kvErr.textContent = e ? String(e) : "—"; if (e) console.error(e); };
const setRun = on => kvRun.textContent = on ? "yes" : "no";
const setHands = n => chipHands.textContent = "hands: " + n;
const setShape = s => chipShape.textContent = "shape: " + s;
const setFps = v => fpsEl.textContent = "FPS: " + v.toFixed(0);

function normalizeLabels(raw){
  if (Array.isArray(raw)) return raw;
  const out=[]; for (const [name,idx] of Object.entries(raw||{})) out[idx]=name; return out;
}
function mapLabelToChar(lbl){
  if (!lbl) return null;
  const t = lbl.trim();
  if (t.length===1 && /[A-Za-z0-9]/.test(t)) return t.toUpperCase();
  const m = t.toUpperCase();
  if (m==="SPACE") return " ";
  if (m==="DEL" || m==="DELETE" || m==="BACKSPACE") return "<BKSP>";
  return null;
}
function renderText(){
  const display = chkLower.checked ? textOut.toLowerCase() : textOut;
  textOutEl.textContent = display;
  localStorage.setItem("handitalk_text", textOut);
}
function appendChar(ch){
  if (!ch) return;
  if (ch === "<BKSP>") { backspace(); return; }
  textOut += ch; renderText();
}
function space(){ textOut += " "; renderText(); }
function backspace(){ textOut = textOut.slice(0,-1); renderText(); }
function clearText(){ textOut=""; renderText(); }

// Camera
async function startCam(){
  if (stream){ stream.getTracks().forEach(t=>t.stop()); stream=null; }
  stream = await navigator.mediaDevices.getUserMedia({
    audio:false,
    video:{ width:{ideal:FIXED_RES.width}, height:{ideal:FIXED_RES.height}, facingMode: usingFront ? "user" : "environment" }
  });
  video.srcObject = stream; await video.play();
  canvas.width = video.videoWidth; canvas.height = video.videoHeight;
  stage.style.aspectRatio = `${video.videoWidth}/${video.videoHeight}`;
  video.style.transform = chkMirror.checked ? "scaleX(-1)" : "none";
  const t = stream.getVideoTracks(); if (t.length){
    const s=t[0].getSettings?.()||{}; kvDev.textContent=(s.deviceId?`id:${s.deviceId} `:"")+(s.facingMode||"");
  }
}

// MediaPipe Hands
async function initHands(){
  if (hands) return;
  statusEl.textContent="loading hands…";
  hands = new Hands({ locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}` });
  hands.setOptions({ maxNumHands:1, modelComplexity:1, minDetectionConfidence:0.35, minTrackingConfidence:0.35 });
  hands.onResults(onResults);
  statusEl.textContent="ready";
}

function toVec42(lms, flipX){
  const out = new Float32Array(42); if (!lms) return out;
  for (let i=0;i<21;i++){
    let x = clamp01(lms[i].x); if (flipX) x = 1 - x;
    const y = clamp01(lms[i].y);
    out[i*2]=x; out[i*2+1]=y;
  }
  return out;
}

async function onResults(results){
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.save(); if (chkMirror.checked){ ctx.translate(canvas.width,0); ctx.scale(-1,1); }
  const ll = results.multiHandLandmarks || [];
  setHands(ll.length);
  for (const lm of ll){
    drawConnectors(ctx, lm, HAND_CONNECTIONS, {color:"#e6f0ff", lineWidth:2});
    drawLandmarks(ctx, lm, {color:"#88c", lineWidth:1, radius:2.2});
  }
  ctx.restore();

  let label="—", conf=0;
  if (tfliteModel && ll.length){
    const feats = toVec42(ll[0], FLIP_X_FOR_MODEL);
    const out = await predictAdaptive(feats);
    label = out.label; conf = out.conf;
  }

  const ch = mapLabelToChar(label);
  lastTopChar = ch; lastTopConf = conf; lastTopRawLabel = label || "";

  const charDisp = ch ? (ch===" " ? " | char: ␣" : (ch==="<BKSP>" ? " | char: ⌫" : ` | char: ${ch}`)) : "";
  predEl.textContent = `${label ?? '—'} (${(conf*100).toFixed(1)}%)${charDisp}`;
  predEl.style.borderColor = (conf >= THRESHOLD) ? "#22c55e" : "#eab308";

  if (conf < Math.max(0.2, THRESHOLD*0.6) || !ll.length) dippedSinceCommit = true;

  // SPACE/DEL (both modes)
  if (ch === " " || ch === "<BKSP>"){
    if (conf >= THRESHOLD){
      if (cmdCurr === ch) cmdCount++; else { cmdCurr = ch; cmdCount = 1; }
      if (cmdCooldown>0) cmdCooldown--;
      if (cmdCount >= CMD_STABLE && cmdCooldown===0){
        if (ch === " ") space(); else backspace();
        cmdCooldown = CMD_COOLDOWN;
        cmdCount = 0;
      }
    } else cmdCount = 0;
  } else {
    cmdCurr = null; cmdCount = 0;
    if (cmdCooldown>0) cmdCooldown--;
  }

  // letters auto-commit (only in Auto mode)
  if (autoMode && ch && ch !== " " && ch !== "<BKSP>"){
    if (conf >= THRESHOLD){
      if (currLabel === ch) currCount++; else { currLabel = ch; currCount = 1; }
      if (cooldown>0) cooldown--;
      const canSame = dippedSinceCommit || ch !== (textOut.slice(-1).toUpperCase());
      if (currCount >= LETTER_STABLE && cooldown===0 && canSame){
        const nowMs = performance.now();
        if (nowMs >= nextAutoAt){
          appendChar(chkLower.checked ? ch.toLowerCase() : ch);
          cooldown = Math.max(LETTER_COOLDOWN, Math.floor(LETTER_STABLE/2));
          dippedSinceCommit = false;
          currCount = 0;
          nextAutoAt = nowMs + AUTO_MIN_INTERVAL_MS;
        }
      }
    } else currCount = 0;
  } else if (!autoMode){
    currCount = 0;
  }

  const now=performance.now(), dt=now-lastTs; if (dt>0) setFps(1000/dt); lastTs=now;
  if (running) requestAnimationFrame(processFrame);
}

async function processFrame(){ try{ await hands.send({image: video}); } catch(e){ setErr("hands.send: "+e); } }

// Adaptive shape + softmax fix
async function predictAdaptive(feats){
  if (!tfliteModel) return {label:"—", conf:0};
  const tryFlat = ()=>{ const x=tf.tensor(feats,[1,42],'float32'); let y; try{ y=tfliteModel.predict(x); } finally{ x.dispose(); } return y; };
  const trySeq  = (T)=>{ const seq=new Float32Array(T*42); for(let t=0;t<T;t++) seq.set(feats,t*42); const x=tf.tensor(seq,[1,T,42],'float32'); let y; try{ y=tfliteModel.predict(x); } finally{ x.dispose(); } return y; };

  let y=null;
  try{
    if (!shapeMode){ try{ y=tryFlat(); shapeMode="flat42"; } catch{ try{ y=trySeq(32); shapeMode="seq32"; } catch{ y=trySeq(64); shapeMode="seq64"; } } setShape(shapeMode); }
    else { y = (shapeMode==="flat42") ? tryFlat() : (shapeMode==="seq32" ? trySeq(32) : trySeq(64)); }
  }catch(e){ setErr("predict failed: "+e); return {label:"—", conf:0}; }

  const raw = await y.data(); y.dispose();
  let data = raw;
  const sum = raw.reduce((a,b)=>a+b, 0);
  if (!(sum > 0.98 && sum < 1.02)) { // apply softmax if needed
    const m = Math.max(...raw);
    const exps = raw.map(v => Math.exp(v - m));
    const expsSum = exps.reduce((a,b)=>a+b, 0);
    data = exps.map(v => v / expsSum);
  }
  let bi=-1,bp=-1; for (let i=0;i<data.length;i++){ if (data[i]>bp){ bp=data[i]; bi=i; } }
  return {label: classNames[bi] ?? `class_${bi}`, conf: bp, vector: data};
}

async function loadClassifier(){
  try{
    statusEl.textContent="loading tflite…";
    if (window.tflite?.setWasmPath) window.tflite.setWasmPath("/libs/tflite/");
    tfliteModel = await window.tflite.loadTFLiteModel(MODEL_FILE);
    const r = await fetch(LABELS_FILE); classNames = normalizeLabels(await r.json());
    kvModel.textContent = `loaded: ${classNames.length} classes`;
    statusEl.textContent="ready"; shapeMode=null; setShape("?");
  }catch(e){ setErr("loadClassifier: "+e); kvModel.textContent="load failed"; statusEl.textContent="error"; }
}

// UI
btnStart.onclick = async ()=>{
  try{
    setErr(""); statusEl.textContent="starting…";
    await loadClassifier(); await initHands(); await startCam();
    running=true; setRun(true); btnStart.disabled=true; btnStop.disabled=false; btnFlip.disabled=false;
    statusEl.textContent="running"; requestAnimationFrame(processFrame);
  }catch(e){ setErr(e); statusEl.textContent="error"; }
};
btnStop.onclick = ()=>{
  running=false; setRun(false); statusEl.textContent="stopped";
  if (stream){ stream.getTracks().forEach(t=>t.stop()); stream=null; }
  ctx.clearRect(0,0,canvas.width,canvas.height); predEl.textContent="—"; predEl.style.borderColor="#eab308"; setShape("?");
  btnStart.disabled=false; btnStop.disabled=true; btnFlip.disabled=true;
};
btnFlip.onclick = async ()=>{ usingFront=!usingFront; statusEl.textContent="switching camera…"; try{ await startCam(); statusEl.textContent="running"; }catch(e){ setErr(e); statusEl.textContent="error"; } };
btnTest.onclick = async ()=>{ try{ await navigator.mediaDevices.getUserMedia({video:true}); alert("Camera permission OK. Click Start."); } catch{ alert("Click the lock icon in the address bar and allow camera for this site."); } };
chkMirror.onchange = ()=>{ video.style.transform = chkMirror.checked ? "scaleX(-1)" : "none"; };

// Mode toggle
btnMode.onclick = ()=>{
  autoMode = !autoMode;
  modeChip.textContent = "Mode: " + (autoMode ? "Auto" : "Free");
  btnMode.textContent = autoMode ? "Switch to Free Form" : "Switch to Auto Commit";
  nextAutoAt = performance.now() + 300;
};

// text controls
btnCommit.onclick = ()=>{
  if (!lastTopChar) return;
  if (lastTopChar === " " || lastTopChar === "<BKSP>") return;
  const ch = chkLower.checked ? lastTopChar.toLowerCase() : lastTopChar;
  appendChar(ch);
  dippedSinceCommit = false; currCount = 0; cooldown = LETTER_COOLDOWN;
};
btnSpace.onclick = space;
btnBack.onclick = backspace;
btnClearText.onclick = clearText;
btnCopy.onclick = async ()=>{ try{ await navigator.clipboard.writeText(textOut); }catch{} };
btnSpeak.onclick = ()=>{ const u=new SpeechSynthesisUtterance((chkLower.checked?textOut.toLowerCase():textOut)); speechSynthesis.cancel(); speechSynthesis.speak(u); };

// Shortcuts
window.addEventListener("keydown", (e)=>{
  if (e.key==="Enter"){ e.preventDefault(); btnCommit.click(); }
  if (e.key===" "){ e.preventDefault(); btnSpace.click(); }
  if (e.key==="Backspace"){ e.preventDefault(); btnBack.click(); }
});

// Preload model & hands so Start only grabs camera
window.addEventListener("DOMContentLoaded", async ()=>{
  try{ await loadClassifier(); await initHands(); }catch(e){ /* Start will retry */ }
});
