// FarmX Counter Tray — web-app v0.1 (khung)
// Camera -> quay 5 s -> lay 5 khung -> ArUco nan khay (js-aruco2, thuan JS) -> YOLO ONNX (onnxruntime-web) -> trung vi
// Lo luu IndexedDB, dong bo Supabase khi co mang.

const SUPABASE_URL = "https://xofhpbfiuolkcbwbxume.supabase.co";
const SUPABASE_KEY = "sb_publishable_DeOQ4ZYgl_6Oxth4eYyrbg_EBiJ6unP";
// Model tu host trong repo. Cung kien truc: YOLO11n, input [1,3,1280,1280], output [1,5,33600].
// Giu ban cu de doi chieu khi ban moi dem lech.
const MODELS = { dem_v01: "./model/dem_v01.onnx", dem_v0: "./model/dem_v0.onnx" };
const MODEL_MD = "dem_v01";
let modelChon = MODELS[localStorage.modelChon] ? localStorage.modelChon : MODEL_MD;

// ---- thong so nan khay ----
// KHONG con hieu chuan luu tru. Moi tam anh tu dung lai mat phang khay tu chinh cac ma trong no.
// Don vi lam viec la "don vi ma": canh mot ma = MA_DV. Dem con giong khong can mm that,
// nen moi kich thuoc deu tinh theo canh ma -> in ma 25 mm hay 17 mm deu chay dung nhu nhau.
const MA_DV = 25;           // canh mot ma = 25 don vi
const LE_DEM = 30;          // vung dem thut vao 30 don vi = 1,2 lan canh ma
const CHE_MA = 35;          // o che quanh moi ma = 35 don vi = 1,4 lan canh ma
const PX_DV = 2;            // px moi don vi trong anh nan
const CANH_DAI_DO = 1600;   // thu nho ve canh dai nay truoc khi do ma / nan
const SO_MA = 6;            // khay dan 6 ma ID 0-5 (timMa da loc bo ID > 5)
// He so gop cum mac dinh RIENG cho tung model — moi model cho ra khung to nho khac nhau
// nen nguong gop phai khac. Nguoi dung chinh tay thi luu rieng theo model.
const HE_SO_MD = { dem_v01: 1.2, dem_v0: 0.8 };
const heSoMacDinh = m => HE_SO_MD[m] ?? 0.8;
function docHeSo(){
  let m={}; try{ m=JSON.parse(localStorage.heSoGopTheoModel||"{}")||{}; }catch(e){}
  const v=parseFloat(m[modelChon]);
  return (v>0 && v<10) ? v : heSoMacDinh(modelChon);
}
function luuHeSo(v){
  let m={}; try{ m=JSON.parse(localStorage.heSoGopTheoModel||"{}")||{}; }catch(e){}
  m[modelChon]=v; localStorage.heSoGopTheoModel=JSON.stringify(m);
}
let heSoGop = docHeSo();
let loiModel = null, epDung = null;      // thong bao loi nap model, va execution provider dang dung
let tienDoModel = null, dangTaiModel = false;
const HET_GIO_MODEL = 90000;             // 90 s
// Hai bo onnxruntime tu host. May co WebGPU moi phai tai ban jsep 21 MB;
// may khong co (nhieu dien thoai Android) chi tai ban wasm thuong 11 MB.
const ORT_BO = {
  webgpu: { js:"./lib/ort/ort.webgpu.min.js", wasm:"./lib/ort/ort-wasm-simd-threaded.jsep.wasm", ep:"webgpu" },
  wasm:   { js:"./lib/ort/ort.wasm.min.js",   wasm:"./lib/ort/ort-wasm-simd-threaded.wasm",      ep:"wasm"   }
};
const MA_TOI_THIEU = 4;     // du 4 ma la chup duoc; duoi 4 thi nut xam
// Vung dem: hinh chu nhat noi cac tam ma, thut vao LE_DEM moi phia.
function vungDem(tam){
  const v=Object.values(tam); if(v.length<3) return null;
  const xs=v.map(p=>p[0]), ys=v.map(p=>p[1]);
  const x0=Math.min(...xs), y0=Math.min(...ys), x1=Math.max(...xs), y1=Math.max(...ys);
  const w=x1-x0-2*LE_DEM, h=y1-y0-2*LE_DEM;
  return (w>0&&h>0) ? {x:x0+LE_DEM, y:y0+LE_DEM, w, h} : null;
}

const $ = s => document.querySelector(s);
const tb = (m, ms=2500) => { const e=$("#tb"); e.textContent=m; e.style.display="block"; clearTimeout(tb.t); tb.t=setTimeout(()=>e.style.display="none", ms); };
const the = (id, txt, cls) => { const e=$(id); e.textContent=txt; e.className="the "+(cls||""); };

// ---- trang thai ----
let loaiCon = localStorage.loaiCon || null, stream = null, ort = null, session = null, modelVer = null;
let loHienTai = null, khayVua = null, dangChup = false, soMaCuoi = 0, daNhacLo = false;
const PHIEN_BAN = "1.6.1";
const thietBiId = localStorage.thietBiId || (localStorage.thietBiId = "tb_" + Math.random().toString(36).slice(2,10));

// ---- dieu huong ----
document.querySelectorAll("nav button").forEach(b => b.onclick = () => hien(b.dataset.m));
function hien(m){
  document.querySelectorAll(".man").forEach(s=>s.classList.toggle("hien", s.id===m));
  document.querySelectorAll("nav button").forEach(b=>b.classList.toggle("dang", b.dataset.m===m));
  document.body.classList.toggle("che-nav", m==="man-loai");   // buoc 1 khong co thanh dieu huong
  if(m==="man-ls") veLichSu(); if(m==="man-lo") veLo(); if(m==="man-cd") veCaiDat();
  if(m==="man-dem"){ batCamera(); nhacNho(); } else anNhac();
}
// ---- buoc 1: dem con gi ----
const tenLoai=v=>({pl:"Tôm PL",tom_uong:"Tôm ương",ca_giong:"Cá giống"})[v]||v;
document.querySelectorAll("#loai button").forEach(b => b.onclick = () => {
  loaiCon=b.dataset.v; localStorage.loaiCon=loaiCon; capNhatLoai(); hien("man-dem"); });
function capNhatLoai(){ const t=loaiCon?tenLoai(loaiCon):"—";
  $("#chip-loai").textContent=t; const e=$("#cd-loai"); if(e) e.textContent=t; }
$("#chip-loai").onclick=()=>hien("man-loai");

// ---- camera ----
// ---- buoc 2: camera bat san ----
// Quy tac: MOI trang thai deu phai co chu tren video trong 1 giay. Khong bao gio de man den im lang.
function trangThai(chinh, phu, kieu){
  $("#bang-chinh").textContent = chinh || "";
  $("#bang-phu").textContent = phu || "";
  $("#bang").className = "bang" + (kieu ? " "+kieu : "");
  $("#bang").style.display = (chinh||phu) ? "" : "none";
}
const ghiChuModel = () => session ? "" : "Model đang cập nhật — vẫn chụp được, chưa ra số";
// Dong nhac ky thuat, hien 3 giay roi tu an. Nhac MOT lan cho moi lo (khi vao man Dem),
// khong nhac lai sau moi lan "Chụp tiếp" — nhac moi lan se thanh phien.
const batNhac = () => (localStorage.nhac ?? "1") === "1";
function anNhac(){ $("#nhac").classList.remove("hien"); clearTimeout(anNhac.t); }
function nhacNho(){
  if(!batNhac() || daNhacLo) return;
  daNhacLo = true;
  $("#nhac").classList.add("hien");
  clearTimeout(anNhac.t); anNhac.t = setTimeout(anNhac, 3000);
}
$("#nhac-x").onclick = e => { e.stopPropagation(); anNhac(); };
// Nut do: khong chup duoc thi xam + ghi ly do ngay duoi nut, khong im lang.
function nutChup(bat, chu){
  const b=$("#chup"); b.disabled=!bat; b.classList.toggle("tat", !bat); $("#chup-chu").textContent=chu;
}
// A. 3 o kiem duoi video. Nut do chi sang khi Camera va Khay deu xanh.
// Khay xanh = thay du SO_MA ma: thieu ma thi hinh chu nhat noi cac tam co lai, vung dem nho di,
// nen so dem giua cac lan chup khong so sanh duoc voi nhau nua.
function veKiem(n){
  const dat=(id,kieu,chu)=>{ const e=$(id); e.className="o o-"+kieu; e.textContent=chu; };
  const coCam=!!stream;
  dat("#o-cam", coCam?"ok":"loi", coCam ? "Camera ✓" : "Camera ✗ chưa bật — chạm vào hình");
  let khayOk=false;
  if(!coCam)                 dat("#o-khay","loi", "Khay ✗ chưa có hình");
  else if(n>=SO_MA){ khayOk=true; dat("#o-khay","ok", `Khay ✓ ${n}/${SO_MA} mã`); }
  else if(n>=MA_TOI_THIEU){ khayOk=true;
    dat("#o-khay","canh", `Khay ⚠ ${n}/${SO_MA} mã — vẫn chụp được`); }
  else if(n>=3)              dat("#o-khay","loi", `Khay ✗ ${n}/${SO_MA} mã — nhích điện thoại`);
  else                       dat("#o-khay","loi", `Khay ✗ ${n}/${SO_MA} mã — chỉnh lại điện thoại`);
  const coModel=!!session;
  if(coModel)          dat("#o-model","ok",   `Model ✓ ${modelVer}${epDung?" · "+epDung:""}`);
  else if(tienDoModel)  dat("#o-model","canh", `Model … ${tienDoModel}`);
  else if(loiModel)     dat("#o-model","loi",  `Model ✗ ${loiModel}`);
  else                  dat("#o-model","loi",  "Model ✗ đang cập nhật — vẫn chụp được, sẽ không ra số");
  if(dangChup) return;
  if(!coCam)       nutChup(false, "Camera chưa bật");
  else if(!khayOk) nutChup(false, `Cần ít nhất ${MA_TOI_THIEU} mã mới chụp được`);
  else             nutChup(true, coModel ? "Chụp" : "Chụp — sẽ không ra số");
}
// Nhuong mot nhip cho trinh duyet ve lai. requestAnimationFrame KHONG chay khi tab an
// hoac man hinh tat, nen phai chay dua voi setTimeout — neu khong ca luong se treo cung.
const nhuong = () => new Promise(r=>{ let xong=false;
  const g=()=>{ if(!xong){ xong=true; r(); } };
  requestAnimationFrame(g); setTimeout(g,50); });
// B. thanh 4 buoc. Moi buoc hien it nhat 300 ms de nguoi dung kip thay.
function veBuoc(tt, ghi){
  $("#buoc").style.display = tt ? "" : "none";
  if(!tt) return;
  for(let i=0;i<4;i++){ const li=$("#b"+(i+1));
    li.className = tt[i]||""; li.querySelector("em").textContent = (ghi&&ghi[i])||""; }
}
function moBuoc(){
  const tt=["","","",""], ghi=["","","",""]; let moc=0;
  const ve=()=>veBuoc(tt,ghi);
  const doi=async()=>{ const con=300-(performance.now()-moc); if(con>0) await new Promise(r=>setTimeout(r,con)); };
  return {
    async batDau(i){ tt[i]="chay"; ghi[i]=""; ve(); moc=performance.now(); await nhuong(); },
    async xong(i,g){ await doi(); tt[i]="xong"; ghi[i]=g||""; ve(); },
    async loi(i,g){ await doi(); tt[i]="loi"; ghi[i]=g||""; ve(); },
    dong(){ veBuoc(null); }
  };
}
$(".khung").onclick = () => { if(!stream && !dangChup) batCamera(true); };
async function batCamera(nguoiBam){
  if(stream || batCamera.dangMo) return; batCamera.dangMo = true;
  trangThai("Đang bật camera…", ghiChuModel(), "");
  veKiem(0); nutChup(false, "Đang bật camera…");
  try {
    if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia)
      throw Object.assign(new Error("khong co API camera"), {name:"KhongCoCamera"});
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 4032 }, height: { ideal: 3024 } }, audio: false });
    const v=$("#cam"); v.srcObject = stream;
    v.addEventListener("loadedmetadata", capNhatKhungXem); capNhatKhungXem();
    trangThai("Đang tìm khay…", ghiChuModel(), "");
    veKiem(0);
    vongKiemTra();
  } catch(e){
    stream = null;
    const ten = e && e.name;
    const khongCo = ten==="KhongCoCamera" || ten==="NotFoundError" || ten==="OverconstrainedError";
    trangThai("Không mở được camera — chạm để thử lại",
      khongCo ? "Máy này không có camera dùng được."
              : "Safari: aA → Cài đặt trang web → Camera → Cho phép", "loi");
    veKiem(0); nutChup(false, khongCo ? "Không có camera" : "Camera chưa bật");
  } finally { batCamera.dangMo=false; }
}

// Khong truyen canhDai = lay nguyen co (cho model). Co truyen = ve thang ra canvas nho.
function layKhung(canhDai){
  const v=$("#cam"); let w=v.videoWidth, h=v.videoHeight;
  if(canhDai && w && h){ const m=Math.max(w,h);
    if(m>canhDai){ const s=canhDai/m; w=Math.round(w*s); h=Math.round(h*s); } }
  const c=document.createElement("canvas"); c.width=w; c.height=h;
  if(w&&h) c.getContext("2d").drawImage(v,0,0,w,h);
  return c;
}
// Khung xem: dat ty le dung bang ty le that cua stream -> object-fit:contain khong xen mep.
function capNhatKhungXem(){
  const v=$("#cam"); if(!v || !v.videoWidth) return;
  const w=v.videoWidth, h=v.videoHeight;
  document.querySelector(".khung").style.setProperty("--ty-le", w+" / "+h);
  const g=(a,b)=>b?g(b,a%b):a, k=g(w,h);
  const e=$("#cd-cam"); if(e) e.textContent=`${w}×${h} (${w/k}:${h/k})`;
}

// Ve vung dem len tren video: khung xanh la + to mo ben ngoai. Vung dem tinh tu chinh
// khung hinh nay, khong dung so lieu luu san. Canvas #ve cung kich thuoc khung hinh va
// cung CSS object-fit:contain nen trinh duyet ap dung y het phep bien nhu video.
function veVungDem(tam, w, h){
  const cv=$("#ve"), lop=document.querySelector(".khung .lop"); if(!cv) return;
  if(cv.width!==w || cv.height!==h){ cv.width=w; cv.height=h; }
  const g=cv.getContext("2d"); g.clearRect(0,0,w,h);
  const mp = tam.size>=3 ? matPhang(tam) : null;
  let goc=null;
  if(mp){ const V=mp.vung;
    goc=[[V.x,V.y],[V.x+V.w,V.y],[V.x+V.w,V.y+V.h],[V.x,V.y+V.h]]
        .map(p=>apH(mp.H,[p[0]*PX_DV, p[1]*PX_DV]));
    if(goc.some(p=>!isFinite(p[0])||!isFinite(p[1]))) goc=null; }
  if(lop) lop.style.display = goc ? "none" : "";
  if(!goc) return;
  const duong=()=>{ g.moveTo(goc[0][0],goc[0][1]); for(let i=1;i<4;i++) g.lineTo(goc[i][0],goc[i][1]); g.closePath(); };
  g.beginPath(); g.rect(0,0,w,h); duong();
  g.fillStyle="rgba(0,0,0,.45)"; g.fill("evenodd");
  g.beginPath(); duong();
  g.strokeStyle="#22c55e"; g.lineWidth=Math.max(3,Math.round(w/240)); g.lineJoin="round"; g.stroke();
}
function xoaVungDem(){ const cv=$("#ve"), lop=document.querySelector(".khung .lop");
  if(cv) cv.getContext("2d").clearRect(0,0,cv.width,cv.height); if(lop) lop.style.display=""; }
async function vongKiemTra(){
  while(stream){
    if(!dangChup && $("#man-dem").classList.contains("hien")){
      try{
        const c=layKhung(CANH_DAI_DO);
        if(c.width){
          capNhatKhungXem();
          const tam=timMa(c), n=tam.size; soMaCuoi=n;
          veVungDem(tam, c.width, c.height);
          if(n>=SO_MA)              trangThai(`Thấy ${n}/${SO_MA} mã ✓`, ghiChuModel(), "ok");
          else if(n>=MA_TOI_THIEU)  trangThai(`Thấy ${n}/${SO_MA} mã — vẫn chụp được`, ghiChuModel(), "canh");
          else if(n>=3)             trangThai(`Thấy ${n}/${SO_MA} mã — nhích điện thoại`, ghiChuModel(), "loi");
          else                      trangThai("Không thấy khay — chỉnh lại điện thoại", ghiChuModel(), "loi");
          veKiem(n);
        }
      } catch(e){ trangThai("Lỗi: "+(e&&e.message||e), "Chạm vào hình để thử lại", "loi"); }
    }
    await new Promise(r=>setTimeout(r,800));
  }
  xoaVungDem();
}

// ---- js-aruco2: doc ma ArUco ----
// DICT_4X4_50 cua OpenCV = 50 ma dau cua ARUCO_4X4_1000, nen dung chung tu dien.
// cv.js + aruco.js + aruco_4x4_1000.js tu host trong lib/, nap bang <script> truoc app.js.
let ARUCO=null;
function aruco(){ if(!ARUCO) ARUCO=new AR.Detector({dictionaryName:"ARUCO_4X4_1000"}); return ARUCO; }
function anhTu(canvas){ return canvas.getContext("2d",{willReadFrequently:true}).getImageData(0,0,canvas.width,canvas.height); }
// Thu nho ve canh dai <= canhDai. Tra ve {canvas, s} voi s = ty le nho/goc (1 neu khong doi).
function thuNho(canvas, canhDai=CANH_DAI_DO){
  const m=Math.max(canvas.width,canvas.height);
  if(!m || m<=canhDai) return {canvas, s:1};
  const s=canhDai/m, c=document.createElement("canvas");
  c.width=Math.round(canvas.width*s); c.height=Math.round(canvas.height*s);
  const g=c.getContext("2d"); g.imageSmoothingEnabled=true; g.imageSmoothingQuality="high";
  g.drawImage(canvas,0,0,c.width,c.height);
  return {canvas:c, s};
}
// Tra ve Map id -> [x,y] (tam) kem .canh (px) va .goc (4 goc [x,y]).
// Toa do luon quy ve he cua `canvas` truyen vao, du ben trong co thu nho.
function timMa(canvas){
  const tam=new Map(); if(!canvas.width||!canvas.height) return tam;
  const {canvas:nho, s}=thuNho(canvas), k=1/s;
  for(const m of aruco().detect(anhTu(nho))){
    if(m.id>5) continue;
    const goc=m.corners.map(q=>[q.x*k, q.y*k]);
    let canh=0; for(let i=0;i<4;i++){ const a=goc[i], b=goc[(i+1)%4]; canh+=Math.hypot(b[0]-a[0],b[1]-a[1]); }
    const p=[(goc[0][0]+goc[1][0]+goc[2][0]+goc[3][0])/4,(goc[0][1]+goc[1][1]+goc[2][1]+goc[3][1])/4];
    p.canh=canh/4; p.goc=goc; tam.set(m.id,p);
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
// To xam o CHE_MA quanh moi ma, de model khong dem nham ma thanh con giong.
function cheMa(c, vung, tamDV){
  const g=c.getContext("2d"); g.fillStyle="#808080"; const k=CHE_MA*PX_DV;
  for(const id in tamDV){ const p=tamDV[id];
    const x=(p[0]-vung.x)*PX_DV-k/2, y=(p[1]-vung.y)*PX_DV-k/2;
    if(x+k>0 && y+k>0 && x<c.width && y<c.height) g.fillRect(x,y,k,k); }
}
// Dung lai mat phang khay tu CHINH cac ma trong tam anh nay — khong dung so lieu luu san.
//   1. Homography anh -> mat phang tu 4 goc cua ma neo (ID nho nhat).
//   2. Chieu toan bo 4*n goc qua no de co toa do tam thoi.
//   3. epVuong(): ep tung ma ve dung hinh vuong canh MA_DV (chi xoay + tinh tien).
//      Day la buoc dua rang buoc "ma nao cung vuong va bang nhau" vao -> khu duoc phoi canh.
//   4. Khop lai homography bang ca 4*n goc, lap lai tu buoc 2.
// H tra ve bien toa do anh NAN (px) -> toa do anh vao (px).
function matPhang(tam){
  const ids=[...tam.keys()].sort((a,b)=>a-b); if(ids.length<3) return null;
  const M=MA_DV, gocAnh=[];
  for(const id of ids) for(const g of tam.get(id).goc) gocAnh.push(g);
  let H=tinhH(tam.get(ids[0]).goc, [[0,0],[M,0],[M,M],[0,M]]);
  if(!H) return null;
  let dv=null, gocDV=null;
  for(let lap=0; lap<8; lap++){
    dv={}; gocDV=[];
    for(const id of ids){ const e=epVuong(tam.get(id).goc.map(g=>apH(H,g)), M);
      dv[id]=e.tam; gocDV.push(...e.goc); }
    const Hm=tinhH(gocAnh,gocDV); if(!Hm) break; H=Hm;
  }
  if(!dv) return null;
  const xs=ids.map(i=>dv[i][0]), ys=ids.map(i=>dv[i][1]);
  const ox=Math.min(...xs), oy=Math.min(...ys);
  for(const id of ids) dv[id]=[dv[id][0]-ox, dv[id][1]-oy];
  for(const g of gocDV){ g[0]-=ox; g[1]-=oy; }
  const vung=vungDem(dv); if(!vung) return null;
  const gocPx=gocDV.map(p=>[p[0]*PX_DV, p[1]*PX_DV]);
  const Hnan=tinhH(gocPx, gocAnh); if(!Hnan) return null;
  let max=0, tong=0;
  for(let k=0;k<gocPx.length;k++){ const q=apH(Hnan,gocPx[k]);
    const e=Math.hypot(q[0]-gocAnh[k][0], q[1]-gocAnh[k][1]); max=Math.max(max,e); tong+=e*e; }
  return { tam:dv, vung, H:Hnan, soMa:ids.length,
           saiSo:{ max:+max.toFixed(2), rms:+Math.sqrt(tong/gocPx.length).toFixed(2) } };
}
// Buoc 2 tach rieng: thu nho + tim ma trong mot khung hinh.
function timKhay(canvas){ const {canvas:nho}=thuNho(canvas); return {nho, tam:timMa(nho)}; }
// Buoc 3 tach rieng: tu cac ma da tim -> mat phang -> cat vung dem -> che ma.
function nanTuMa(nho, tam){
  const mp=matPhang(tam); if(!mp) return null;
  const V=mp.vung;
  const c=warp(nho, mp.H, Math.round(V.w*PX_DV), Math.round(V.h*PX_DV),
               Math.round(V.x*PX_DV), Math.round(V.y*PX_DV));
  cheMa(c, V, mp.tam);
  return { canvas:c, soMa:mp.soMa, vung:V, saiSo:mp.saiSo };
}

// ---- ONNX: YOLO ----
// Tai co tien do: doc Content-Length roi stream, bao "12/21 MB" ra o kiem Model.
// Tai san file .wasm o day de ORT lay lai tu cache — ORT tu fetch thi khong hook duoc tien do.
async function taiCoTienDo(url, nhan, signal){
  const r = await fetch(url, {cache:"force-cache", signal});
  if(!r.ok) throw new Error(`${nhan}: HTTP ${r.status}`);
  const tong = +(r.headers.get("content-length") || 0);
  const mb = b => (b/1e6).toFixed(b < 1e7 ? 1 : 0);   // MB thap phan, khop cach ghi dung luong tai ve
  if(!r.body || !tong) return await r.arrayBuffer();
  const doc = r.body.getReader(); const manh=[]; let da=0, moc=0;
  for(;;){
    const {done, value} = await doc.read(); if(done) break;
    manh.push(value); da += value.length;
    if(performance.now()-moc > 150){ moc=performance.now();
      tienDoModel = `Đang tải ${nhan} ${mb(da)}/${mb(tong)} MB`;
      $("#tt-model").textContent = `${nhan} ${Math.round(100*da/tong)}%`;
      veKiem(soMaCuoi);
    }
  }
  const b=new Uint8Array(da); let o=0; for(const m of manh){ b.set(m,o); o+=m.length; }
  return b.buffer;
}
// Nap onnxruntime-web TU HOST trong lib/ort (khong dung CDN: Android hay bi chan CDN/CORS).
// numThreads=1 va proxy=false vi nhieu may Android khong co SharedArrayBuffer / chan worker.
async function taiModel(){
  if(dangTaiModel) return;
  dangTaiModel = true;
  session=null; modelVer=null; loiModel=null; epDung=null; tienDoModel="Đang bắt đầu…";
  $("#tt-model").textContent="đang tải model…"; veKiem(soMaCuoi);
  const ac = new AbortController();
  const dongHo = setTimeout(()=>ac.abort(), HET_GIO_MODEL);
  try{
    const bo = navigator.gpu ? ORT_BO.webgpu : ORT_BO.wasm;   // khong co WebGPU thi khoi tai ban 21 MB
    await taiCoTienDo(bo.wasm, "thư viện", ac.signal);        // tai truoc de ORT lay lai tu cache
    if(!window.ort){
      await new Promise((res,rej)=>{ const t=document.createElement("script");
        t.src=bo.js; t.onload=res;
        t.onerror=()=>rej(new Error("không tải được "+bo.js));
        document.head.appendChild(t); });
    }
    ort=window.ort;
    if(!ort || !ort.InferenceSession) throw new Error("onnxruntime không nạp được");
    // URL TUYET DOI: ORT giai wasmPaths tuong doi voi chinh file ort.*.min.js,
    // dua duong dan tuong doi vao se thanh /lib/ort/lib/ort/... roi 404.
    ort.env.wasm.wasmPaths  = new URL("./lib/ort/", document.baseURI).href;
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy      = false;
    const buf = await taiCoTienDo(MODELS[modelChon], "model", ac.signal);
    tienDoModel = "Đang khởi tạo…"; veKiem(soMaCuoi);
    // Thu webgpu truoc, hong thi roi ve wasm. Thu rieng tung cai de biet CHAC dang chay bang gi;
    // truyen ca mang ["webgpu","wasm"] thi ORT co the tu roi ve wasm ma minh van tuong la webgpu.
    const tao = async () => {
      if(bo.ep==="webgpu"){
        try{ const x=await ort.InferenceSession.create(buf,{executionProviders:["webgpu"]}); epDung="webgpu"; return x; }
        catch(eGpu){ /* roi ve wasm */ }
      }
      const x=await ort.InferenceSession.create(buf,{executionProviders:["wasm"]}); epDung="wasm"; return x;
    };
    session = await Promise.race([ tao(),
      new Promise((_,rej)=>setTimeout(()=>rej(Object.assign(new Error("qua-lau"),{name:"QuaLau"})), HET_GIO_MODEL)) ]);
    modelVer=modelChon;
    $("#tt-model").textContent="model "+modelVer;
    $("#cd-model").textContent=`${modelVer} · ${epDung}`;
  }catch(e){
    session=null; modelVer=null; epDung=null;
    const qua = e && (e.name==="AbortError" || e.name==="QuaLau");
    loiModel = qua ? "Tải model quá lâu — kiểm tra mạng, chạm để thử lại"
                   : ((e && e.message) || String(e) || "lỗi không rõ") + " — chạm để thử lại";
    $("#tt-model").textContent="model lỗi";
    $("#cd-model").textContent="lỗi: "+loiModel;
  }finally{
    clearTimeout(dongHo); tienDoModel=null; dangTaiModel=false; veKiem(soMaCuoi);
  }
}
// Cham vao o Model de tai lai khi hong.
$("#o-model").onclick = () => { if(!session && !dangTaiModel) taiModel(); };

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
// Gop cum sau NMS: hai khung co tam cach nhau < heSo x chieu dai trung vi thi coi la MOT con,
// giu khung diem cao hon. "Chieu dai" = canh dai cua khung; trung vi uoc tu chinh lo khung nay
// nen tu thich nghi voi co con giong va do phong dai cua anh nan.
// NMS chi bo khung CHONG NHAU nhieu; hai khung tach roi cung nam tren mot con (dau va duoi)
// thi IoU nho, NMS khong dong duoc — buoc nay moi don duoc.
function gopCum(boxes, heSo){
  if(boxes.length<2) return boxes.slice();
  const dai=boxes.map(b=>Math.max(b[2]-b[0], b[3]-b[1])).sort((a,b)=>a-b);
  const tv=dai[Math.floor(dai.length/2)];
  if(!(tv>0)) return boxes.slice();
  const n2=(heSo*tv)**2;
  const sx=boxes.slice().sort((a,b)=>b[4]-a[4]);   // diem cao xet truoc -> khung giu lai la khung diem cao
  const giu=[];
  for(const b of sx){
    const cx=(b[0]+b[2])/2, cy=(b[1]+b[3])/2;
    let trung=false;
    for(const k of giu){ const dx=cx-(k[0]+k[2])/2, dy=cy-(k[1]+k[3])/2;
      if(dx*dx+dy*dy < n2){ trung=true; break; } }
    if(!trung) giu.push(b);
  }
  return giu;
}
function veBox(canvas,boxes){ const g=canvas.getContext("2d"); g.lineWidth=2; g.strokeStyle="#22c55e"; boxes.forEach(b=>g.strokeRect(b[0],b[1],b[2]-b[0],b[3]-b[1])); return canvas; }

// ---- bam nut: thanh 4 buoc chay tuan tu, buoc nao xong tick ngay ----
$("#chup").onclick = () => demKhay(3);
async function demKhay(soKhung){
  if(!stream || dangChup) return;
  dangChup=true;
  // phan hoi trong <=100 ms: rung + vong xoay + chu, roi moi lam viec nang
  if(navigator.vibrate) navigator.vibrate(40);
  const btn=$("#chup"); btn.disabled=true; btn.classList.add("chay"); btn.classList.remove("tat");
  $("#chup-chu").textContent="Đang đếm…";
  trangThai("Đang đếm…", ghiChuModel(), "");
  const B=moBuoc(); veBuoc(["","","",""],["","","",""]);
  await nhuong();   // bao dam ve xong vong xoay + chu truoc khi lam viec nang
  let den=0;
  try{
    // 1. chup anh
    await B.batDau(0); den=1;
    const khung=[];
    // gian 600 ms giua cac khung: 3 khung sat nhau gan nhu giong het, trung vi se vo dung
    for(let i=0;i<soKhung;i++){ if(i) await new Promise(r=>setTimeout(r,600)); khung.push(layKhung(CANH_DAI_DO)); }
    await B.xong(0, `${khung.length} khung`);

    // 2. tim khay
    await B.batDau(1); den=2;
    const thay=[]; let maToiDa=0;
    // chi nhan khung du MA_TOI_THIEU ma, dung nguong voi cua nut: khung it ma hon co vung dem
    // nho hon, tron vao trung vi se lam lech so.
    for(const c of khung){ const k=timKhay(c); maToiDa=Math.max(maToiDa,k.tam.size); if(k.tam.size>=MA_TOI_THIEU) thay.push(k); }
    if(!thay.length){ await B.loi(1, `chỉ thấy ${maToiDa}/${SO_MA} mã`);
      return raKetQua({loi:`Chỉ thấy ${maToiDa}/${SO_MA} mã — chỉnh lại điện thoại`, den:2}); }
    await B.xong(1, `${maToiDa}/${SO_MA} mã`);

    // 3. nan anh
    await B.batDau(2); den=3;
    const nan=[]; for(const k of thay){ const r=nanTuMa(k.nho,k.tam); if(r) nan.push(r); }
    if(!nan.length){ await B.loi(2, "không dựng được mặt phẳng khay");
      return raKetQua({loi:"Không nắn được khay — chụp lại", den:3}); }
    await B.xong(2, `${nan[0].canvas.width}×${nan[0].canvas.height} px`);

    // 4. dem
    await B.batDau(3); den=4;
    const ketQua=[], truocGop=[]; let anhCuoi=nan[nan.length-1].canvas;
    if(session){ for(const r of nan){
      const bx=await demYolo(r.canvas);
      const gop=gopCum(bx, heSoGop);
      truocGop.push(bx.length); ketQua.push(gop.length);
      anhCuoi=veBox(r.canvas, gop);
    } }
    const tv=a=>{ const x=a.slice().sort((p,q)=>p-q); return x[Math.floor(x.length/2)]; };
    let so=null, soTruoc=null;
    if(ketQua.length){ so=tv(ketQua); soTruoc=tv(truocGop); }
    if(session) await B.xong(3, `${ketQua.join(", ")}`);
    else await B.loi(3, "chưa có model");
    const cuoi=nan[nan.length-1];
    khayVua={ so, anh:anhCuoi.toDataURL("image/jpeg",0.8), loai:loaiCon, soMa:cuoi.soMa, khung:ketQua, khungTruoc:truocGop };
    raKetQua({so, soTruoc, soMa:cuoi.soMa, vung:cuoi.vung, saiSo:cuoi.saiSo, soKhung:khung.length, den:session?4:3});
  } catch(e){
    const m = (e && e.message) || String(e);
    await B.loi(Math.max(0,den-1), m);
    trangThai("Lỗi: "+m, "Chạm vào hình để thử lại", "loi");
    raKetQua({loi:"Lỗi: "+m, den});
  }
  finally{
    dangChup=false; btn.classList.remove("chay"); $("#chup-chu").textContent="Chụp";
    setTimeout(()=>{ if(!dangChup) B.dong(); }, 1200);
  }
}
// ---- ket qua ----
function raKetQua(r){
  const soEl=$("#kq-so"), loiEl=$("#kq-loi"), phuEl=$("#kq-phu"), anh=$("#anh-kq"),
        luu=$("#them-khay"), tiep=$("#chup-lai"), db=$("#kq-buoc");
  const den = r.den==null ? 4 : r.den;
  if(r.loi){
    db.className="kq-buoc loi"; db.textContent=`Dừng ở bước ${den}/4`;
    soEl.style.display="none"; loiEl.style.display=""; loiEl.textContent=r.loi;
    phuEl.textContent=""; $("#kq-gop").textContent=""; anh.removeAttribute("src"); anh.style.display="none";
    luu.style.display="none"; tiep.textContent="Chụp lại";
  } else {
    const heto = r.so!==null;
    db.className="kq-buoc "+(heto?"ok":"loi");
    db.textContent = heto ? "Xong 4/4" : "Xong 3/4 — chưa có model";
    soEl.style.display=""; loiEl.style.display="none";
    $("#so-con").textContent = heto ? r.so.toLocaleString("vi") : "—";
    phuEl.textContent = heto ? `Trung vị ${khayVua.khung.length}/${r.soKhung} khung · thấy ${r.soMa} mã`
                             : "Model đang cập nhật — đã nắn khay, chưa ra số";
    anh.src=khayVua.anh; anh.style.display="";
    $("#kq-gop").textContent = (heto && r.soTruoc!=null)
      ? `Trước gộp ${r.soTruoc.toLocaleString("vi")} · sau gộp ${r.so.toLocaleString("vi")} (hệ số ${heSoGop})`
      : "";
    luu.style.display=""; luu.disabled=!heto; tiep.textContent="Chụp tiếp";
    const e=$("#cd-lan");
    if(e) e.textContent=`${r.soMa} mã · vùng đếm ${Math.round(r.vung.w)}×${Math.round(r.vung.h)} đv · sai số ${r.saiSo.rms} px`;
  }
  if(navigator.vibrate) navigator.vibrate(r.loi?[80,60,80]:[40,40,40]);
  hien("man-kq");
}
$("#chup-lai").onclick=()=>hien("man-dem");
$("#them-khay").onclick=()=>{ if(!loHienTai) loHienTai={ id:crypto.randomUUID(), thoi_gian:new Date().toISOString(), loai_con:loaiCon, khay:[], anh:[], khach:"", ghi_chu:"" };
  loHienTai.khay.push(khayVua.so); loHienTai.anh.push(khayVua.anh); luuNhap(); tb("Đã thêm khay vào lô."); hien("man-dem"); };

// ---- lo ----
function veLo(){ const l=loHienTai; $("#lo-tong").textContent=l?l.khay.reduce((a,b)=>a+b,0).toLocaleString("vi"):"0";
  $("#lo-khay").textContent=l?l.khay.length:"0"; $("#lo-loai").textContent=l?tenLoai(l.loai_con):"—"; $("#lo-tung").textContent=l?l.khay.join(" + "):"—";
  if(l){ $("#lo-khach").value=l.khach; $("#lo-ghi").value=l.ghi_chu; } }
$("#lo-them").onclick=()=>hien("man-dem");
$("#lo-huy").onclick=()=>{ if(confirm("Hủy lô đang đếm?")){ loHienTai=null; localStorage.removeItem("loNhap"); daNhacLo=false; hien("man-dem"); } };
$("#lo-khach").oninput=e=>{ if(loHienTai){ loHienTai.khach=e.target.value; luuNhap(); } };
$("#lo-ghi").oninput=e=>{ if(loHienTai){ loHienTai.ghi_chu=e.target.value; luuNhap(); } };
function luuNhap(){ localStorage.loNhap=JSON.stringify(loHienTai); }
$("#lo-xong").onclick=async()=>{ const l=loHienTai; if(!l||!l.khay.length) return tb("Chưa có khay nào."); daNhacLo=false;   // lo sau nhac lai
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

// ---- dung lai mat phang khay (dung boi matPhang) ----
function apH(H,p){ const d=H[6]*p[0]+H[7]*p[1]+H[8];
  return [(H[0]*p[0]+H[1]*p[1]+H[2])/d, (H[3]*p[0]+H[4]*p[1]+H[5])/d]; }
// Ep 4 diem ve hinh vuong canh M (Procrustes 2D: chi xoay + tinh tien, khong doi ty le).
function epVuong(p, M){
  const q=[[-M/2,-M/2],[M/2,-M/2],[M/2,M/2],[-M/2,M/2]];
  let cx=0, cy=0; for(const t of p){ cx+=t[0]; cy+=t[1]; } cx/=4; cy/=4;
  let sin=0, cos=0;
  for(let i=0;i<4;i++){ const dx=p[i][0]-cx, dy=p[i][1]-cy;
    sin += q[i][0]*dy - q[i][1]*dx; cos += q[i][0]*dx + q[i][1]*dy; }
  const t=Math.atan2(sin,cos), c=Math.cos(t), n=Math.sin(t);
  return { tam:[cx,cy], goc:q.map(v=>[cx+v[0]*c-v[1]*n, cy+v[0]*n+v[1]*c]) };
}
// ---- cai dat ----
function veCaiDat(){ $("#cd-pb").textContent=PHIEN_BAN; capNhatLoai(); }
$("#cd-model-chon").value = modelChon;
$("#cd-model-chon").onchange = e => {
  modelChon = MODELS[e.target.value] ? e.target.value : MODEL_MD;
  localStorage.modelChon = modelChon; e.target.value = modelChon;
  heSoGop = docHeSo(); $("#cd-he-so").value = heSoGop; veGhiChuHeSo();
  tb(`Đang đổi sang ${modelChon}… (hệ số gộp ${heSoGop})`); taiModel();
};
function veGhiChuHeSo(){
  $("#cd-he-so-ghi").textContent =
    `Hai khung có tâm gần nhau hơn hệ số × chiều dài trung vị thì gộp làm một con. Cao hơn = gộp mạnh hơn. Mặc định của ${modelChon} là ${heSoMacDinh(modelChon)}.`;
}
$("#cd-he-so").value = heSoGop; veGhiChuHeSo();
$("#cd-he-so").onchange = e => {
  const v=parseFloat(e.target.value);
  if(v>0 && v<10){ heSoGop=v; luuHeSo(v); } else { e.target.value=heSoGop; }
};
$("#cd-nhac").checked = batNhac(); $("#cd-nhac").onchange=e=>localStorage.nhac=e.target.checked?"1":"0";
$("#cd-gop").checked = localStorage.gopAnh==="1"; $("#cd-gop").onchange=e=>localStorage.gopAnh=e.target.checked?"1":"0";
$("#cd-model-tai").onclick=()=>{ tb("Đang kiểm tra…"); taiModel(); };
veCaiDat();
document.querySelector("header b").textContent="FarmX Counter v"+PHIEN_BAN;
$("#cd-pb").textContent=PHIEN_BAN;
$("#cd-xoa").onclick=async()=>{ if(confirm("Xóa toàn bộ lô trên máy?")){ indexedDB.deleteDatabase("farmx"); localStorage.removeItem("loNhap"); loHienTai=null; tb("Đã xóa."); } };

// ---- khoi dong ----
if("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js");
if(localStorage.loNhap){ try{ loHienTai=JSON.parse(localStorage.loNhap); }catch(e){} }
taiModel();
capNhatLoai();
hien(loaiCon ? "man-dem" : "man-loai");














