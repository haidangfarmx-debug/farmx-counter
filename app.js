// FarmX Counter Tray — web-app v0.1 (khung)
// Camera -> quay 5 s -> lay 5 khung -> ArUco nan khay (OpenCV.js) -> YOLO ONNX (onnxruntime-web) -> trung vi
// Lo luu IndexedDB, dong bo Supabase khi co mang.

const SUPABASE_URL = "https://xofhpbfiuolkcbwbxume.supabase.co";
const SUPABASE_KEY = "sb_publishable_DeOQ4ZYgl_6Oxth4eYyrbg_EBiJ6unP";
const MODEL_URL = SUPABASE_URL + "/storage/v1/object/public/counter-model/dem_v1.onnx"; // upload sau khi train

// ---- thong so khay (mm), khop dem_khay.py ----
const LONG = [500, 350], GO = 25, PX_MM = 2; // 2 px/mm -> anh nan 1100x800 (nhe cho dien thoai)
const TAM_MA = {
  0: [GO/2+20, GO/2], 1: [GO+LONG[0]-20+GO/2, GO/2],
  2: [GO/2+20, GO+LONG[1]+GO/2], 3: [GO+LONG[0]-20+GO/2, GO+LONG[1]+GO/2],
  4: [GO+LONG[0]/2, GO/2], 5: [GO+LONG[0]/2, GO+LONG[1]+GO/2],
};
const W_OUT = (LONG[0]+2*GO)*PX_MM, H_OUT = (LONG[1]+2*GO)*PX_MM;

const $ = s => document.querySelector(s);
const tb = (m, ms=2500) => { const e=$("#tb"); e.textContent=m; e.style.display="block"; clearTimeout(tb.t); tb.t=setTimeout(()=>e.style.display="none", ms); };
const the = (id, txt, cls) => { const e=$(id); e.textContent=txt; e.className="the "+(cls||""); };

// ---- trang thai ----
let loaiCon = "pl", stream = null, cv = null, ort = null, session = null, modelVer = null;
let nghieng = true, loHienTai = null, khayVua = null;
const thietBiId = localStorage.thietBiId || (localStorage.thietBiId = "tb_" + Math.random().toString(36).slice(2,10));

// ---- dieu huong ----
document.querySelectorAll("nav button").forEach(b => b.onclick = () => hien(b.dataset.m));
function hien(m){ document.querySelectorAll(".man").forEach(s=>s.classList.toggle("hien", s.id===m));
  $("#hanh-dong").classList.toggle("hien", m==="man-dem" && !!stream);
  document.querySelectorAll("nav button").forEach(b=>b.classList.toggle("dang", b.dataset.m===m));
  if(m==="man-ls") veLichSu(); if(m==="man-lo") veLo(); }
document.querySelectorAll("#loai button").forEach(b => b.onclick = () => { loaiCon=b.dataset.v; document.querySelectorAll("#loai button").forEach(x=>x.classList.toggle("dang", x===b)); });

// ---- camera ----
$("#bat-cam").onclick = async () => {
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1440 } }, audio: false });
    $("#cam").srcObject = stream; the("#k-cam","Camera OK","ok");
    $("#bat-cam").style.display="none"; $("#hanh-dong").classList.add("hien");
    theoDoiNghieng(); vongKiemTra();
  } catch(e){ the("#k-cam","Không mở được camera","loi"); tb("Cho phép camera trong trình duyệt (Chrome/Safari), mở bằng https."); }
};

function theoDoiNghieng(){
  if(!window.DeviceOrientationEvent) { the("#k-ngang","Không có cảm biến",""); nghieng=false; return; }
  const bat = () => window.addEventListener("deviceorientation", ev => {
    const ok = Math.abs(ev.beta||0) < 8 && Math.abs(ev.gamma||0) < 8; nghieng = !ok;
    the("#k-ngang", ok ? "Nằm ngang OK" : "Điện thoại đang nghiêng", ok ? "ok" : "canh");
  });
  if (DeviceOrientationEvent.requestPermission) DeviceOrientationEvent.requestPermission().then(r=>{ if(r==="granted") bat(); else { nghieng=false; the("#k-ngang","Bỏ qua",""); } }).catch(()=>{nghieng=false;});
  else bat();
}

function layKhung(){ const v=$("#cam"); const c=document.createElement("canvas"); c.width=v.videoWidth; c.height=v.videoHeight; c.getContext("2d").drawImage(v,0,0); return c; }

function kiemSang(canvas){
  const g=canvas.getContext("2d"), s=4; const d=g.getImageData(0,0,canvas.width,canvas.height).data;
  let sum=0,n=0,choi=0; for(let i=0;i<d.length;i+=4*s){ const y=0.299*d[i]+0.587*d[i+1]+0.114*d[i+2]; sum+=y; n++; if(y>245) choi++; }
  const m=sum/n, c=choi/n; if(m<60) return ["Tối quá","loi"]; if(m>210||c>0.05) return ["Chói / sáng quá","loi"]; return ["Ánh sáng OK","ok"]; }

async function vongKiemTra(){
  while(stream){ const c=layKhung(); if(c.width){ const [t,k]=kiemSang(c); the("#k-sang",t,k);
    if(cv){ const n=timMa(c).size; the("#k-ma", n>=3?`Thấy ${n}/6 mã`:`Chỉ ${n} mã`, n>=3?"ok":"canh"); } else the("#k-ma","Đang tải OpenCV…",""); }
    await new Promise(r=>setTimeout(r,800)); }
}

// ---- OpenCV.js: ArUco ----
async function taiOpenCV(){
  if(window.cv && window.cv.Mat) { cv=window.cv; return; }
  await new Promise((res,rej)=>{ const s=document.createElement("script"); s.src="https://cdn.jsdelivr.net/npm/@techstark/opencv-js@4.10.0-release.1/dist/opencv.js"; s.onload=res; s.onerror=rej; document.head.appendChild(s); });
  // KHONG await window.cv (Emscripten Module co .then tu tro ve chinh no -> treo trinh duyet). Chi poll cv.Mat.
  let c=window.cv;
  for(let i=0;i<150 && !(c&&c.Mat);i++){ await new Promise(r=>setTimeout(r,200)); c=window.cv; }
  if(!(c&&c.Mat)) throw new Error("opencv");
  cv=c;
}
let ARUCO=null;
function aruco(){ if(!ARUCO){ const dict=cv.getPredefinedDictionary(cv.DICT_4X4_50); const params=new cv.aruco_DetectorParameters(); const refine=new cv.aruco_RefineParameters(10,3,true); ARUCO=new cv.aruco_ArucoDetector(dict,params,refine); } return ARUCO; }
function timMa(canvas){
  const src=cv.imread(canvas), gray=new cv.Mat(); cv.cvtColor(src,gray,cv.COLOR_RGBA2GRAY);
  const det=aruco(), corners=new cv.MatVector(), ids=new cv.Mat(), rej=new cv.MatVector();
  det.detectMarkers(gray,corners,ids,rej);
  const tam=new Map();
  for(let i=0;i<ids.rows;i++){ const id=ids.data32S[i]; if(!(id in TAM_MA)) continue; const c=corners.get(i).data32F; tam.set(id,[(c[0]+c[2]+c[4]+c[6])/4,(c[1]+c[3]+c[5]+c[7])/4]); }
  src.delete(); gray.delete(); corners.delete(); ids.delete(); rej.delete(); return tam;
}
function nanKhay(canvas){
  const tam=timMa(canvas); if(tam.size<3) return {loi:`Chỉ thấy ${tam.size} mã (cần ≥3)`};
  const ids=[...tam.keys()]; const src=[],dst=[];
  ids.forEach(id=>{ src.push(...tam.get(id)); dst.push(TAM_MA[id][0]*PX_MM, TAM_MA[id][1]*PX_MM); });
  const sM=cv.matFromArray(ids.length,1,cv.CV_32FC2,src), dM=cv.matFromArray(ids.length,1,cv.CV_32FC2,dst);
  const img=cv.imread(canvas), out=new cv.Mat();
  let M; if(ids.length===3){ M=cv.getAffineTransform(sM,dM); cv.warpAffine(img,out,M,new cv.Size(W_OUT,H_OUT)); }
  else { M=cv.findHomography(sM,dM,cv.RANSAC,5); cv.warpPerspective(img,out,M,new cv.Size(W_OUT,H_OUT)); }
  // cat long khay
  const r=new cv.Rect(GO*PX_MM,GO*PX_MM,LONG[0]*PX_MM,LONG[1]*PX_MM); const long=out.roi(r);
  const c=document.createElement("canvas"); c.width=long.cols; c.height=long.rows; cv.imshow(c,long);
  [sM,dM,img,out,M,long].forEach(x=>x.delete&&x.delete()); return {canvas:c, soMa:tam.size};
}

// ---- ONNX: YOLO ----
async function taiModel(){
  try{
    if(!window.ort){ await new Promise((res,rej)=>{ const s=document.createElement("script"); s.src="https://cdn.jsdelivr.net/npm/onnxruntime-web@1.19.2/dist/ort.min.js"; s.onload=res; s.onerror=rej; document.head.appendChild(s); }); }
    ort=window.ort; const r=await fetch(MODEL_URL,{cache:"force-cache"}); if(!r.ok) throw 0;
    session=await ort.InferenceSession.create(await r.arrayBuffer(),{executionProviders:["webgpu","wasm"]});
    modelVer="dem_v1"; $("#tt-model").textContent="model "+modelVer; $("#cd-model").textContent=modelVer;
  }catch(e){ $("#tt-model").textContent="chưa có model"; $("#cd-model").textContent="chưa có — sẽ tự tải khi có"; }
}
async function demYolo(canvas, imgsz=1280, conf=0.25, iou=0.5){
  // letterbox
  const s=Math.min(imgsz/canvas.width, imgsz/canvas.height), nw=Math.round(canvas.width*s), nh=Math.round(canvas.height*s);
  const c=document.createElement("canvas"); c.width=imgsz; c.height=imgsz; const g=c.getContext("2d"); g.fillStyle="#727272"; g.fillRect(0,0,imgsz,imgsz);
  const dx=(imgsz-nw)/2, dy=(imgsz-nh)/2; g.drawImage(canvas,dx,dy,nw,nh);
  const d=g.getImageData(0,0,imgsz,imgsz).data, f=new Float32Array(3*imgsz*imgsz), n=imgsz*imgsz;
  for(let i=0;i<n;i++){ f[i]=d[i*4]/255; f[n+i]=d[i*4+1]/255; f[2*n+i]=d[i*4+2]/255; }
  const out=await session.run({[session.inputNames[0]]: new ort.Tensor("float32",f,[1,3,imgsz,imgsz])});
  const t=out[session.outputNames[0]]; const [_,ch,na]=t.dims; const a=t.data; // [1, 4+nc, N]
  let boxes=[]; for(let j=0;j<na;j++){ let best=0; for(let k=4;k<ch;k++) best=Math.max(best,a[k*na+j]); if(best<conf) continue;
    const cx=a[j],cy=a[na+j],w=a[2*na+j],h=a[3*na+j]; boxes.push([(cx-w/2-dx)/s,(cy-h/2-dy)/s,(cx+w/2-dx)/s,(cy+h/2-dy)/s,best]); }
  boxes.sort((p,q)=>q[4]-p[4]); const keep=[];
  for(const b of boxes){ let ok=true; for(const k of keep){ if(iouBox(b,k)>iou){ok=false;break;} } if(ok) keep.push(b); }
  return keep;
}
function iouBox(a,b){ const x1=Math.max(a[0],b[0]),y1=Math.max(a[1],b[1]),x2=Math.min(a[2],b[2]),y2=Math.min(a[3],b[3]); const i=Math.max(0,x2-x1)*Math.max(0,y2-y1); const u=(a[2]-a[0])*(a[3]-a[1])+(b[2]-b[0])*(b[3]-b[1])-i; return u>0?i/u:0; }
function veBox(canvas,boxes){ const g=canvas.getContext("2d"); g.lineWidth=2; g.strokeStyle="#22c55e"; boxes.forEach(b=>g.strokeRect(b[0],b[1],b[2]-b[0],b[3]-b[1])); return canvas; }

// ---- quay 5 s va dem ----
$("#chup").onclick = () => demKhay(5);
$("#chup-1").onclick = () => demKhay(1);
async function demKhay(soKhung){
  if(!stream) return; if(nghieng){ tb("Đặt điện thoại nằm ngang trên nắp rồi bấm lại."); return; }
  const btn=$("#chup"), btn1=$("#chup-1"); btn.disabled=btn1.disabled=true; btn.textContent=soKhung>1?"Đang quay…":"Đang chụp…"; const td=$("#td");
  const khung=[]; for(let i=0;i<soKhung;i++){ if(soKhung>1) await new Promise(r=>setTimeout(r,1000)); khung.push(layKhung()); td.style.width=Math.round((i+1)*60/soKhung)+"%"; }
  btn.textContent="Đang đếm…";
  const [t,k]=kiemSang(khung[2]); if(k==="loi"){ tb("Ảnh "+t.toLowerCase()+". Che nắng hoặc chụp lại."); return reset(); }
  const ketQua=[]; let anhCuoi=null, soMa=0;
  for(const c of khung){ const n=nanKhay(c); if(n.loi){ continue; } soMa=n.soMa;
    if(session){ const bx=await demYolo(n.canvas); ketQua.push(bx.length); anhCuoi=veBox(n.canvas,bx); } else { anhCuoi=n.canvas; }
    td.style.width=(60+ketQua.length*8)+"%"; }
  if(!anhCuoi){ tb("Không thấy đủ mã ArUco. Gạt con giống khỏi gờ, lau mã, chụp lại."); return reset(); }
  let so=null; if(ketQua.length){ ketQua.sort((a,b)=>a-b); so=ketQua[Math.floor(ketQua.length/2)]; }
  khayVua={ so, anh:anhCuoi.toDataURL("image/jpeg",0.8), loai:loaiCon, soMa, khung:ketQua };
  $("#so-con").textContent = so===null ? "—" : so.toLocaleString("vi");
  $("#anh-kq").src=khayVua.anh; const e=$("#kq-the"); e.innerHTML="";
  e.appendChild(Object.assign(document.createElement("span"),{className:"the ok",textContent:`${soMa}/6 mã`}));
  e.appendChild(Object.assign(document.createElement("span"),{className:"the "+(session?"ok":"canh"),textContent:session?`${ketQua.length} khung: ${ketQua.join(", ")}`:"Chưa có model — chỉ nắn khay"}));
  $("#them-khay").disabled = so===null; reset(); hien("man-kq");
  function reset(){ btn.disabled=btn1.disabled=false; btn.textContent="Quay 5 giây"; td.style.width="0"; }
}
$("#chup-lai").onclick=()=>hien("man-dem");
$("#them-khay").onclick=()=>{ if(!loHienTai) loHienTai={ id:crypto.randomUUID(), thoi_gian:new Date().toISOString(), loai_con:loaiCon, khay:[], anh:[], khach:"", ghi_chu:"" };
  loHienTai.khay.push(khayVua.so); loHienTai.anh.push(khayVua.anh); luuNhap(); hien("man-lo"); };

// ---- lo ----
function veLo(){ const l=loHienTai; $("#lo-tong").textContent=l?l.khay.reduce((a,b)=>a+b,0).toLocaleString("vi"):"0";
  $("#lo-khay").textContent=l?l.khay.length:"0"; $("#lo-loai").textContent=l?tenLoai(l.loai_con):"—"; $("#lo-tung").textContent=l?l.khay.join(" + "):"—";
  if(l){ $("#lo-khach").value=l.khach; $("#lo-ghi").value=l.ghi_chu; } }
const tenLoai=v=>({pl:"Tôm PL",tom_uong:"Tôm ương",ca_giong:"Cá giống"})[v]||v;
$("#lo-them").onclick=()=>hien("man-dem");
$("#lo-huy").onclick=()=>{ if(confirm("Hủy lô đang đếm?")){ loHienTai=null; localStorage.removeItem("loNhap"); hien("man-dem"); } };
$("#lo-khach").oninput=e=>{ if(loHienTai){ loHienTai.khach=e.target.value; luuNhap(); } };
$("#lo-ghi").oninput=e=>{ if(loHienTai){ loHienTai.ghi_chu=e.target.value; luuNhap(); } };
function luuNhap(){ localStorage.loNhap=JSON.stringify(loHienTai); }
$("#lo-xong").onclick=async()=>{ const l=loHienTai; if(!l||!l.khay.length) return tb("Chưa có khay nào.");
  l.so_con=l.khay.reduce((a,b)=>a+b,0); l.model_ver=modelVer; await dbLuu(l); loHienTai=null; localStorage.removeItem("loNhap");
  tb("Đã lưu lô. Báo cáo PDF: v1.1"); dongBo(l); hien("man-ls"); };

// ---- IndexedDB ----
function db(){ return new Promise((res,rej)=>{ const r=indexedDB.open("farmx",1); r.onupgradeneeded=()=>r.result.createObjectStore("lo",{keyPath:"id"}); r.onsuccess=()=>res(r.result); r.onerror=rej; }); }
async function dbLuu(l){ const d=await db(); await new Promise((res,rej)=>{ const t=d.transaction("lo","readwrite"); t.objectStore("lo").put(l); t.oncomplete=res; t.onerror=rej; }); }
async function dbTatCa(){ const d=await db(); return new Promise((res,rej)=>{ const r=d.transaction("lo").objectStore("lo").getAll(); r.onsuccess=()=>res(r.result.sort((a,b)=>b.thoi_gian.localeCompare(a.thoi_gian))); r.onerror=rej; }); }
async function veLichSu(){ const ds=await dbTatCa(); const e=$("#ls"); e.innerHTML="";
  if(!ds.length){ e.innerHTML='<div class="trong">Chưa có lô nào. Bấm Đếm để bắt đầu.</div>'; return; }
  ds.forEach(l=>{ const m=document.createElement("div"); m.className="muc";
    m.innerHTML=`<b>${l.so_con.toLocaleString("vi")} con</b> · ${tenLoai(l.loai_con)} · ${l.khay.length} khay<small>${new Date(l.thoi_gian).toLocaleString("vi")}${l.khach?" · "+l.khach:""}${l.dong_bo?" · đã đồng bộ":""}</small>`; e.appendChild(m); }); }

// ---- Supabase (dong bo khi co mang) ----
async function dongBo(l){ if(!navigator.onLine) return; try{
  const r=await fetch(SUPABASE_URL+"/rest/v1/counter_lo",{method:"POST",headers:{apikey:SUPABASE_KEY,Authorization:"Bearer "+SUPABASE_KEY,"Content-Type":"application/json",Prefer:"return=minimal"},
    body:JSON.stringify({id:l.id,thiet_bi_id:thietBiId,thoi_gian:l.thoi_gian,loai_con:l.loai_con,so_khay:l.khay.length,so_con:l.so_con,so_tung_khay:l.khay,khach:l.khach||null,ghi_chu:l.ghi_chu||null,model_ver:l.model_ver||null})});
  if(r.ok){ l.dong_bo=true; await dbLuu(l); }
  if(r.ok && $("#cd-gop").checked) gopAnh(l);
 }catch(e){} }
async function gopAnh(l){ for(let i=0;i<l.anh.length;i++){ const blob=await (await fetch(l.anh[i])).blob(); const path=`${thietBiId}/${l.id}_${i}.jpg`;
  const up=await fetch(`${SUPABASE_URL}/storage/v1/object/counter-anh/${path}`,{method:"POST",headers:{apikey:SUPABASE_KEY,Authorization:"Bearer "+SUPABASE_KEY,"Content-Type":"image/jpeg"},body:blob});
  if(up.ok) await fetch(SUPABASE_URL+"/rest/v1/counter_anh_gop",{method:"POST",headers:{apikey:SUPABASE_KEY,Authorization:"Bearer "+SUPABASE_KEY,"Content-Type":"application/json",Prefer:"return=minimal"},
    body:JSON.stringify({thiet_bi_id:thietBiId,lo_id:l.id,loai_con:l.loai_con,so_may_dem:l.khay[i],so_sau_sua:l.khay[i],model_ver:l.model_ver,duong_dan:path})}); } }

// ---- cai dat ----
$("#cd-gop").checked = localStorage.gopAnh==="1"; $("#cd-gop").onchange=e=>localStorage.gopAnh=e.target.checked?"1":"0";
$("#cd-model-tai").onclick=()=>{ tb("Đang kiểm tra…"); taiModel(); };
$("#cd-xoa").onclick=async()=>{ if(confirm("Xóa toàn bộ lô trên máy?")){ indexedDB.deleteDatabase("farmx"); localStorage.removeItem("loNhap"); loHienTai=null; tb("Đã xóa."); } };

// ---- khoi dong ----
if("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js");
if(localStorage.loNhap){ try{ loHienTai=JSON.parse(localStorage.loNhap); }catch(e){} }
taiOpenCV().then(()=>the("#k-ma","OpenCV sẵn sàng","")).catch(()=>the("#k-ma","Không tải được OpenCV","loi"));
taiModel();
