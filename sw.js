const CACHE='farmx-counter-v37';
const APP=['./','./index.html','./app.js','./manifest.json','./icon.svg','./lib/cv.js','./lib/aruco.js','./lib/aruco_4x4_1000.js'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(APP)));self.skipWaiting();});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))));self.clients.claim();});
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);
  if(e.request.method!=='GET'||u.hostname.includes('supabase')) return;
  // model ONNX va onnxruntime tu host: rat nang (11 + 21 MB), khong doi thuong xuyen -> cache truoc.
  // KHONG de roi vao nhanh mang-truoc ben duoi: se tai lai 30 MB moi lan mo app. KHONG dua vao APP precache:
  // addAll() hong mot file la hong ca lan cai service worker, va khong nen bat nguoi dung
  // tai vai chuc MB ngay lan mo dau tien.
  if(u.origin===location.origin && (u.pathname.includes('/model/') || u.pathname.includes('/lib/ort/'))){
    e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request).then(res=>{if(res.ok){const cl=res.clone();caches.open(CACHE).then(c=>c.put(e.request,cl));}return res;})));
    return;
  }
  if(u.origin===location.origin){
    // file app: MANG TRUOC, cache sau (de cap nhat luon toi ngay); offline thi dung cache
    e.respondWith(fetch(e.request).then(res=>{const cl=res.clone();caches.open(CACHE).then(c=>c.put(e.request,cl));return res;}).catch(()=>caches.match(e.request)));
  } else {
    // thu vien CDN (onnxruntime-web): cache truoc vi nang
    e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request).then(res=>{if(res.ok){const cl=res.clone();caches.open(CACHE).then(c=>c.put(e.request,cl));}return res;})));
  }
});
