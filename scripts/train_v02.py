# -*- coding: utf-8 -*-
"""
FarmX Counter — train v0.2 (mạng + đảo màu + tôm vẽ tự sinh), bản chạy LOCAL.
Chuyển từ tools/train-dem-v02-colab.ipynb. Khác notebook:
  - batch 64 (RTX 5080), lưu vào ./runs, không dùng đường dẫn /content
  - in mốc mỗi 10 epoch, in kết quả cuối (mAP, sai số 3 loại, mã HTTP upload)
  - chạy trên Windows: bắt buộc có if __name__ == "__main__"
Cách chạy (trong thư mục repo, đã kích hoạt venv):
  python scripts/train_v02.py
Bỏ bước nào thì thêm cờ: --khong-train (chỉ đánh giá + export + upload từ best.pt có sẵn)
"""
import os, glob, shutil, random, math, argparse, sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageOps, ImageDraw, ImageFilter

# ---------- cấu hình (giữ đúng notebook, trừ batch và đường dẫn) ----------
ROBOFLOW_KEY = os.environ.get("ROBOFLOW_API_KEY", "Go6DqabG3FqADGMkr49U")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "sb_publishable_DeOQ4ZYgl_6Oxth4eYyrbg_EBiJ6unP")
SUPABASE_URL = "https://xofhpbfiuolkcbwbxume.supabase.co/storage/v1/object/counter-model/dem_v02.onnx"

# BATCH 64 gay CUDA OOM tren RTX 5080 16GB (desktop da chiem ~1.7GB) -> ha xuong 32
EPOCHS, IMGSZ_TRAIN, BATCH = 40, 640, 32
IMGSZ_EXPORT, OPSET = 1280, 12
PROJECT, NAME = "./runs/farmx", "dem_v02"


# ---------- 1. dataset Roboflow ----------
def tai_dataset():
    from roboflow import Roboflow
    rf = Roboflow(api_key=ROBOFLOW_KEY)
    ds = rf.workspace("nguyen-hai-dang-10csz").project("risishrimp-count-suuvb").version(1).download("yolov8")
    root = Path(ds.location).resolve()
    print("Dataset:", root)
    return root


# ---------- 2. đảo màu ----------
def dao_mau(root):
    for split in ["train", "valid"]:
        imd, lbd = root / split / "images", root / split / "labels"
        n = 0
        for p in imd.iterdir():
            base, ext = p.stem, p.suffix
            if base.endswith("_inv") or base.startswith("syn_"):
                continue
            out = imd / f"{base}_inv{ext}"
            if out.exists():
                continue
            ImageOps.invert(Image.open(p).convert("RGB")).save(out, quality=92)
            lb = lbd / f"{base}.txt"
            if lb.exists():
                shutil.copy(lb, lbd / f"{base}_inv.txt")
            n += 1
        print("dao mau", split, n)


# ---------- 3. tôm vẽ tự sinh ----------
def ve_tom(draw, cx, cy, L, ang):
    a = math.radians(ang); c, s = math.cos(a), math.sin(a)
    def P(x, y): return (cx + x*c - y*s, cy + x*s + y*c)
    body = [P(-L*0.5, 0), P(-L*0.3, L*0.11), P(0, L*0.13), P(L*0.3, L*0.11), P(L*0.5, 0),
            P(L*0.3, -L*0.11), P(0, -L*0.13), P(-L*0.3, -L*0.11)]
    g = random.randint(150, 195); draw.polygon(body, fill=(g, g, g), outline=(g-40, g-40, g-40))
    draw.line([P(L*0.5, 0), P(L*0.63, L*0.06)], fill=(120, 120, 120), width=1)
    draw.line([P(L*0.5, 0), P(L*0.63, -L*0.06)], fill=(120, 120, 120), width=1)
    draw.line([P(-L*0.5, 0), P(-L*0.78, L*0.09)], fill=(140, 140, 140), width=1)
    draw.line([P(-L*0.5, 0), P(-L*0.78, -L*0.09)], fill=(140, 140, 140), width=1)
    gx, gy = P(-L*0.22, 0); r = L*0.09
    draw.ellipse([gx-r*1.3, gy-r*0.7, gx+r*1.3, gy+r*0.7],
                 fill=(random.randint(200, 240), random.randint(110, 150), random.randint(20, 60)))
    for sy in (L*0.06, -L*0.06):
        ex, ey = P(-L*0.43, sy); re = max(1.2, L*0.03)
        draw.ellipse([ex-re, ey-re, ex+re, ey+re], fill=(15, 15, 15))
    xs = [p[0] for p in body] + [P(-L*0.78, 0)[0]]; ys = [p[1] for p in body]
    return min(xs), min(ys), max(xs), max(ys)


def sinh(path_img, path_lb, W=1280, H=960):
    bg = random.randint(200, 250); img = Image.new("RGB", (W, H), (bg, bg, bg + random.randint(-5, 5)))
    d = ImageDraw.Draw(img)
    n = random.choice([20, 40, 80, 150, 250, 400, 500]); L = random.uniform(28, 70)
    pts, lines = [], []
    for _ in range(n*30):
        if len(pts) >= n: break
        x = random.uniform(L, W-L); y = random.uniform(L, H-L)
        if all(math.hypot(x-px, y-py) > L*random.uniform(0.45, 0.8) for px, py in pts): pts.append((x, y))
    for x, y in pts:
        x0, y0, x1, y1 = ve_tom(d, x, y, L*random.uniform(0.85, 1.15), random.uniform(0, 360))
        x0, x1 = max(0, x0), min(W, x1); y0, y1 = max(0, y0), min(H, y1)
        lines.append(f"0 {(x0+x1)/2/W:.6f} {(y0+y1)/2/H:.6f} {(x1-x0)/W:.6f} {(y1-y0)/H:.6f}")
    img = img.filter(ImageFilter.GaussianBlur(random.uniform(0.4, 1.6)))
    a = np.array(img).astype(np.int16) + np.random.normal(0, random.uniform(2, 8), (H, W, 1)).astype(np.int16)
    img = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))
    if random.random() < 0.5: img = img.resize((640, 480))
    img.save(path_img, quality=random.randint(70, 92))
    with open(path_lb, "w") as f: f.write("\n".join(lines))


def sinh_tom_ve(root):
    if (root / "train/images/syn_02599.jpg").exists() and (root / "valid/images/syn_00299.jpg").exists():
        print("tom ve da co, bo qua"); return
    random.seed(1); np.random.seed(1)
    for split, N in [("train", 2600), ("valid", 300)]:
        for i in range(N):
            sinh(str(root / split / "images" / f"syn_{i:05d}.jpg"), str(root / split / "labels" / f"syn_{i:05d}.txt"))
    print("da sinh 2900 anh")


# ---------- 4. train ----------
def moc_10_epoch(trainer):
    ep = trainer.epoch + 1
    if ep % 10 == 0 or ep == trainer.epochs:
        m = trainer.metrics or {}
        print(f"\n===== MOC EPOCH {ep}/{trainer.epochs} | mAP50={m.get('metrics/mAP50(B)', 0):.3f} "
              f"mAP50-95={m.get('metrics/mAP50-95(B)', 0):.3f} "
              f"P={m.get('metrics/precision(B)', 0):.3f} R={m.get('metrics/recall(B)', 0):.3f} =====\n", flush=True)


def train(root):
    from ultralytics import YOLO
    m = YOLO("yolo11n.pt")
    m.add_callback("on_fit_epoch_end", moc_10_epoch)
    res = m.train(data=str(root / "data.yaml"), epochs=EPOCHS, imgsz=IMGSZ_TRAIN, batch=BATCH,
                  degrees=180, flipud=0.5, fliplr=0.5, scale=0.4, hsv_v=0.6, hsv_s=0.5, mosaic=1.0,
                  patience=12, project=PROJECT, name=NAME, exist_ok=True, device=0)
    return Path(res.save_dir)


# ---------- 5. sai số 3 loại ----------
def sai_so(best, root):
    def sai(files):
        s = []
        for p in files[:120]:
            p = Path(p)
            lb = root / p.parent.parent.name / "labels" / (p.stem + ".txt")
            that = sum(1 for _ in open(lb)) if lb.exists() else 0
            may = len(best.predict(str(p), imgsz=1280 if p.name.startswith("syn_") else 640, conf=0.3, verbose=False)[0].boxes)
            s.append(abs(may - that) / max(that, 1) * 100)
        return float(np.mean(s)) if s else float("nan")
    V = root / "valid" / "images"
    tat_ca = sorted(str(p) for p in V.iterdir())
    kq = {
        "nen toi ": sai([p for p in tat_ca if "_inv" not in p and "syn_" not in Path(p).name]),
        "nen sang": sai([p for p in tat_ca if p.endswith("_inv.jpg")]),
        "tom ve  ": sai([p for p in tat_ca if Path(p).name.startswith("syn_")]),
    }
    for k, v in kq.items(): print(f"{k}: {v:.1f}%")
    return kq


# ---------- 6. export + upload ----------
def export_upload(best, save_dir):
    import requests
    best.export(format="onnx", imgsz=IMGSZ_EXPORT, opset=OPSET, simplify=True, dynamic=False)
    F = save_dir / "weights" / "best.onnx"
    print("ONNX:", F, os.path.getsize(F), "bytes")
    r = requests.post(SUPABASE_URL,
                      headers={"apikey": SUPABASE_KEY, "Authorization": "Bearer " + SUPABASE_KEY,
                               "Content-Type": "application/octet-stream", "x-upsert": "true"},
                      data=open(F, "rb").read())
    print("Upload Supabase:", r.status_code, r.text[:120])
    return r.status_code


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--khong-train", action="store_true", help="bo qua train, dung best.pt co san")
    args = ap.parse_args()

    import torch
    print("torch", torch.__version__, "| CUDA:", torch.cuda.is_available(),
          "|", torch.cuda.get_device_name(0) if torch.cuda.is_available() else "KHONG CO GPU")
    if not torch.cuda.is_available():
        sys.exit("Khong thay GPU — kiem tra lai driver / ban torch cu128")

    root = tai_dataset()
    dao_mau(root)
    sinh_tom_ve(root)

    if args.khong_train:
        save_dir = Path(PROJECT) / NAME
    else:
        save_dir = train(root)

    from ultralytics import YOLO
    best = YOLO(str(save_dir / "weights" / "best.pt"))
    val = best.val(data=str(root / "data.yaml"), imgsz=IMGSZ_TRAIN, verbose=False)
    sai = sai_so(best, root)
    code = export_upload(best, save_dir)

    print("\n================ KET QUA CUOI ================")
    print(f"mAP50     : {val.box.map50:.3f}")
    print(f"mAP50-95  : {val.box.map:.3f}")
    for k, v in sai.items(): print(f"sai so {k}: {v:.1f}%")
    print(f"upload    : HTTP {code} {'(OK)' if code == 200 else '(LOI)'}")
    print("==============================================")


if __name__ == "__main__":
    main()
