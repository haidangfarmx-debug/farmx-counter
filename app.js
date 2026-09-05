// FarmX Counter Tray — web-app v0.1 (khung)
// Camera -> quay 5 s -> lay 5 khung -> ArUco nan khay (js-aruco2, thuan JS) -> YOLO ONNX (onnxruntime-web) -> trung vi
// Lo luu IndexedDB, dong bo Supabase khi co mang.

const SUPABASE_URL = "https://xofhpbfiuolkcbwbxume.supabase.co";
const SUPABASE_KEY = "sb_publishable_DeOQ4ZYgl_6Oxth4eYyrbg_EBiJ6unP";
const MODEL_URL = SUPABASE_URL + "/storage/v1/object/public/counter-model/dem_v1.onnx"; // upload sau khi train

// ---- thong so khay (mm) — hieu chuan tu anh khay that cua Hai Dang (IMG_4370, 05/09/2026) ----
// Goc toa do = tam ma ID0 dich (25,25). Vi tri 6 ma do tu anh, ma canh 25 mm (in A4).
const PX_MM = 2;
let MA_MM = +(localStorage.maMM || 25);   // canh mot ma ArUco (mm)
// Cau truc hieu chuan DUY NHAT (dung chung cho mac dinh, localStorage va hieuChuan()):
//   { tam:{id:[x_mm,y_mm]}, long:[dai,rong], go, maMM, ngay, soMa }
//   tam  = tam cac ma trong he toa do khay (mm)
//   long = kich thuoc vung long khay de dem (mm); go = le bao quanh vung long (mm)
//   anh nan ra co kich thuoc (long[0]+2*go) x (long[1]+2*go) mm
const HC_MAC_DINH = {
  tam: { 0:[25,25], 1:[495,25], 2:[24.4,312], 3:[507,306], 4:[269.3,20.1], 5:[271.2,311.3] },
  long: [440, 240], go: 45, maMM: 25, ngay: null, soMa: 6
};
let HC = HC_MAC_DINH;
try { const h = JSON.parse(localStorage.hieuChuan || "null"); if (h && h.tam && h.long && h.go != null) HC = h; } catch(e){}
let TAM_MA = HC.tam, LONG = HC.long, GO = HC.go;

const $ = s => document.querySelector(s);
const tb = (m, ms=2500) => { const e=$("#tb"); e.textContent=m; e.style.display="block"; clearTimeout(tb.t); tb.t=setTimeout(()=>e.style.display="none", ms); };
const the = (id, txt, cls) => { const e=$(id); e.textContent=txt; e.className="the "+(cls||""); };

// ---- trang thai ----
let loaiCon = "pl", stream = null, ort = null, session = null, modelVer = null;
let nghieng = false, loHienTai = null, khayVua = null;
const PHIEN_BAN = "0.6";
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
    const n=timMa(c).size; the("#k-ma", n>=3?`Thấy ${n}/6 mã`:`Chỉ ${n} mã`, n>=3?"ok":"canh"); }
    await new Promise(r=>setTimeout(r,800)); }
}

// ---- js-aruco2: doc ma ArUco ----
// DICT_4X4_50 cua OpenCV = 50 ma dau cua ARUCO_4X4_1000, nen dung chung tu dien.
// cv.js + aruco.js + aruco_4x4_1000.js tu host trong lib/, nap bang <script> truoc app.js.
let ARUCO=null;
function aruco(){ if(!ARUCO) ARUCO=new AR.Detector({dictionaryName:"ARUCO_4X4_1000"}); return ARUCO; }
function anhTu(canvas){ return canvas.getContext("2d",{willReadFrequently:true}).getImageData(0,0,canvas.width,canvas.height); }
function timMa(canvas){
  const tam=new Map(); if(!canvas.width||!canvas.height) return tam;
  for(const m of aruco().detect(anhTu(canvas))){
    if(m.id>5) continue;
    const c=m.corners; let canh=0;
    for(let i=0;i<4;i++){ const a=c[i], b=c[(i+1)%4]; canh+=Math.hypot(b.x-a.x,b.y-a.y); }
    const p=[(c[0].x+c[1].x+c[2].x+c[3].x)/4,(c[0].y+c[1].y+c[2].y+c[3].y)/4];
    p.canh=canh/4; tam.set(m.id,p);
  }
  return tam;
}

// ---- dai so + warp thuan JS (thay cho OpenCV) ----
// Gauss khu voi chon truc: giai A x = b (A vuong n x n). Tra ve null neu suy bien.
function giaiHe(A,b,n){
  for(let i=0;i<n;i++){
    let p=i; for(let r=i+1;r<n;r++) if(Math.abs(A[r][i])>Math.abs(A[p][i])) p=r;
    if(Math.abs(A[p][i])<1e-12) return null;
    if(p!==i){ const t=A[p]; A[p]=A[i]; A[i]=t; const u=b[p]; b[p]=b[i]; b[i]=u; }
    for(let r=i+1;r<n;r++){ const f=A[r][i]/A[i][i]; if(!f) continue;
      for(let c=i;c<n;c++) A[r][c]-=f*A[i][c]; b[r]-=f*b[i]; }
  }
  const x=new Array(n).fill(0);
  for(let i=n-1;i>=0;i--){ let t=b[i]; for(let c=i+1;c<n;c++) t-=A[i][c]*x[c]; x[i]=t/A[i][i]; }
  return x;
}
// Binh phuong toi thieu: rows = [[a0..a(n-1), ve_phai], ...] -> giai (A^T A) x = A^T b.
function binhPhuongToiThieu(rows,n){
  const A=Array.from({length:n},()=>new Array(n).fill(0)), b=new Array(n).fill(0);
  for(const r of rows) for(let i=0;i<n;i++){ for(let j=0;j<n;j++) A[i][j]+=r[i]*r[j]; b[i]+=r[i]*r[n]; }
  return giaiHe(A,b,n);
}
// Chuan hoa Hartley: trong tam ve goc, khoang cach trung binh = sqrt(2). Giup he phuong trinh on dinh.
function chuanHoa(pts){
  const n=pts.length; let cx=0,cy=0; for(const p of pts){ cx+=p[0]; cy+=p[1]; } cx/=n; cy/=n;
  let d=0; for(const p of pts) d+=Math.hypot(p[0]-cx,p[1]-cy); d/=n;
  const s=d>1e-9?Math.SQRT2/d:1;
  return { T:[s,0,-s*cx, 0,s,-s*cy, 0,0,1], nghich:[1/s,0,cx, 0,1/s,cy, 0,0,1],
           pts:pts.map(p=>[(p[0]-cx)*s,(p[1]-cy)*s]) };
}
function nhan3(A,B){ const C=new Array(9);
  for(let i=0;i<3;i++) for(let j=0;j<3;j++){ let t=0; for(let k=0;k<3;k++) t+=A[i*3+k]*B[k*3+j]; C[i*3+j]=t; }
  return C; }
// Ma tran 3x3 bien diem "tu" -> "den". >=4 diem: homography DLT binh phuong toi thieu; 3 diem: affine.
function tinhH(tu,den){
  const n=tu.length; if(n<3||den.length!==n) return null;
  const a=chuanHoa(tu), b=chuanHoa(den);
  const affine=n===3, k=affine?6:8, rows=[];
  for(let i=0;i<n;i++){
    const u=a.pts[i][0], v=a.pts[i][1], x=b.pts[i][0], y=b.pts[i][1];
    const r1=[u,v,1,0,0,0], r2=[0,0,0,u,v,1];
    if(!affine){ r1.push(-u*x,-v*x); r2.push(-u*y,-v*y); }
    r1.push(x); r2.push(y); rows.push(r1,r2);
  }
  const h=binhPhuongToiThieu(rows,k); if(!h||h.some(v=>!isFinite(v))) return null;
  const Hn=[h[0],h[1],h[2], h[3],h[4],h[5], affine?0:h[6], affine?0:h[7], 1];
  const H=nhan3(b.nghich, nhan3(Hn, a.T));
  return H.some(v=>!isFinite(v))?null:H;
}
// Warp nguoc thu cong bang ImageData, lay mau song tuyen tinh.
// H bien toa do anh NAN (da cong offset) -> toa do anh GOC. Diem ra ngoai anh goc de den.
function warp(canvas,H,w,h,offX,offY){
  const src=anhTu(canvas), sw=src.width, sh=src.height, sd=src.data;
  const out=new ImageData(w,h), od=out.data;
  for(let y=0;y<h;y++){
    const Y=y+offY;
    for(let x=0;x<w;x++){
      const X=x+offX;
      const d=H[6]*X+H[7]*Y+H[8]; if(!d) continue;
      const u=(H[0]*X+H[1]*Y+H[2])/d, v=(H[3]*X+H[4]*Y+H[5])/d;
      if(!(u>=0&&v>=0&&u<=sw-1&&v<=sh-1)) continue;
      const x0=u|0, y0=v|0, x1=x0+1<sw?x0+1:x0, y1=y0+1<sh?y0+1:y0;
      const fx=u-x0, fy=v-y0;
      const w00=(1-fx)*(1-fy), w10=fx*(1-fy), w01=(1-fx)*fy, w11=fx*fy;
      const i00=(y0*sw+x0)*4, i10=(y0*sw+x1)*4, i01=(y1*sw+x0)*4, i11=(y1*sw+x1)*4, o=(y*w+x)*4;
      od[o]  =sd[i00]  *w00+sd[i10]  *w10+sd[i01]  *w01+sd[i11]  *w11;
      od[o+1]=sd[i00+1]*w00+sd[i10+1]*w10+sd[i01+1]*w01+sd[i11+1]*w11;
      od[o+2]=sd[i00+2]*w00+sd[i10+2]*w10+sd[i01+2]*w01+sd[i11+2]*w11;
      od[o+3]=255;
    }
  }
  const c=document.createElement("canvas"); c.width=w; c.height=h;
  c.getContext("2d").putImageData(out,0,0); return c;
}
// Nan khay: warp thang ra dung vung long khay (LONG mm), bo le GO mm quanh ma.
function nanKhay(canvas){
  const tam=timMa(canvas); if(tam.size<3) return {loi:`Chỉ thấy ${tam.size} mã (cần ≥3)`};
  const ids=[...tam.keys()];
  const tu=ids.map(id=>[TAM_MA[id][0]*PX_MM, TAM_MA[id][1]*PX_MM]);   // toa do khay (px anh nan)
  const den=ids.map(id=>[tam.get(id)[0], tam.get(id)[1]]);            // toa do anh goc (px)
  const H=tinhH(tu,den); if(!H) return {loi:"Không tính được phép nắn khay"};
  const off=Math.round(GO*PX_MM);
  const c=warp(canvas,H,Math.round(LONG[0]*PX_MM),Math.round(LONG[1]*PX_MM),off,off);
  return {canvas:c, soMa:tam.size};
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
  if(!stream){ tb("Chưa bật camera."); return; }
  if(nghieng) tb("Điện thoại đang nghiêng — vẫn chụp, nhưng nên đặt nằm ngang.",2000);
  const btn=$("#chup"), btn1=$("#chup-1"); btn.disabled=btn1.disabled=true; btn.textContent=soKhung>1?"Đang quay…":"Đang chụp…"; btn1.textContent="…"; const td=$("#td");
  if(navigator.vibrate) navigator.vibrate(60);
  tb(soKhung>1?"Đang quay 5 giây, giữ yên…":"Đang chụp…",1500);
  try {
  const khung=[]; for(let i=0;i<soKhung;i++){ if(soKhung>1) await new Promise(r=>setTimeout(r,1000)); khung.push(layKhung()); td.style.width=Math.round((i+1)*60/soKhung)+"%"; }
  btn.textContent="Đang đếm…";
  const [t,k]=kiemSang(khung[Math.floor(khung.length/2)]); if(k==="loi"){ tb("Ảnh "+t.toLowerCase()+". Che nắng hoặc chụp lại."); return reset(); }
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
  if(navigator.vibrate) navigator.vibrate([40,40,40]);
  } catch(e){ tb("Lỗi khi xử lý ảnh: "+(e&&e.message||e),5000); reset(); }
  function reset(){ btn.disabled=btn1.disabled=false; btn.textContent="Quay 5 giây"; btn1.textContent="Chụp 1 tấm"; td.style.width="0"; }
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

// ---- hieu chuan tu anh khay trong ----
// Chup khay trong: tu 6 ma (>=4) suy ra vi tri tung ma theo mm. He toa do: ID0 goc tren-trai.
function hieuChuan(canvas){
  const tam=timMa(canvas); if(tam.size<4) return {loi:`Chỉ thấy ${tam.size} mã, cần ≥ 4`};
  const ids=[...tam.keys()];
  // px/mm tu canh ma
  const s=ids.reduce((a,id)=>a+tam.get(id).canh,0)/ids.length/MA_MM;
  // truc: ID0->ID1 la canh dai (x), ID0->ID2 la canh ngan (y). Neu thieu, dung ID3/ID4/ID5 thay.
  const P=id=>tam.get(id); const need=[0,1,2].every(i=>tam.has(i));
  let o,ux,uy;
  if(need){ o=P(0); const dx=[P(1)[0]-o[0],P(1)[1]-o[1]]; const dy=[P(2)[0]-o[0],P(2)[1]-o[1]];
    ux=[dx[0]/Math.hypot(...dx),dx[1]/Math.hypot(...dx)]; uy=[dy[0]/Math.hypot(...dy),dy[1]/Math.hypot(...dy)]; }
  else return {loi:"Cần thấy đủ mã 1, 2, 3 (ID0, ID1, ID2) để hiệu chuẩn"};
  const mm={}; let maxX=0,maxY=0;
  for(const id of ids){ const p=P(id); const v=[p[0]-o[0],p[1]-o[1]]; const x=(v[0]*ux[0]+v[1]*ux[1])/s, y=(v[0]*uy[0]+v[1]*uy[1])/s; mm[id]=[x,y]; maxX=Math.max(maxX,x); maxY=Math.max(maxY,y); }
  // dat goc: tam ID0 nam tai (GO/2+20, GO/2) nhu cu -> dich toan bo
  const go=25, ox=go/2+20, oy=go/2;
  for(const id in mm){ mm[id]=[mm[id][0]+ox, mm[id][1]+oy]; }
  const long=[Math.round(maxX+ox+ox-go), Math.round(maxY+oy+oy-go)];
  const hc={tam:mm,long,go,maMM:MA_MM,ngay:new Date().toISOString(),soMa:ids.length};
  localStorage.hieuChuan=JSON.stringify(hc);
  HC=hc; TAM_MA=hc.tam; LONG=hc.long; GO=hc.go;
  return hc;
}
$("#cd-hieu-chuan").onclick=()=>{ if(!stream){ tb("Vào màn Đếm, bật camera, đặt khay trống rồi bấm lại."); return; }
  const c=layKhung(); const r=hieuChuan(c); if(r.loi){ tb(r.loi); return; }
  tb(`Hiệu chuẩn xong: ${r.soMa} mã, khay ${r.long[0]}×${r.long[1]} mm`,4000); veCaiDat(); };
$("#cd-ma-mm").onchange=e=>{ MA_MM=+e.target.value; localStorage.maMM=MA_MM; };
function veCaiDat(){ try{ const hc=JSON.parse(localStorage.hieuChuan||"null"); $("#cd-hc").textContent = hc ? `${hc.soMa} mã · ${hc.long[0]}×${hc.long[1]} mm · ${new Date(hc.ngay).toLocaleDateString("vi")}` : "chưa có (đang dùng mặc định)"; }catch(e){} $("#cd-ma-mm").value=MA_MM; }

// ---- cai dat ----
$("#cd-gop").checked = localStorage.gopAnh==="1"; $("#cd-gop").onchange=e=>localStorage.gopAnh=e.target.checked?"1":"0";
$("#cd-model-tai").onclick=()=>{ tb("Đang kiểm tra…"); taiModel(); };
veCaiDat();
document.querySelector("header b").textContent="FarmX Counter v"+PHIEN_BAN;
$("#cd-xoa").onclick=async()=>{ if(confirm("Xóa toàn bộ lô trên máy?")){ indexedDB.deleteDatabase("farmx"); localStorage.removeItem("loNhap"); loHienTai=null; tb("Đã xóa."); } };

// ---- khoi dong ----
if("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js");
if(localStorage.loNhap){ try{ loHienTai=JSON.parse(localStorage.loNhap); }catch(e){} }
the("#k-ma","Mã ArUco: sẵn sàng","");
taiModel();

