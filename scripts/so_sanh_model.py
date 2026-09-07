# -*- coding: utf-8 -*-
"""So sanh cac ban ONNX trong model/ tren CUNG mot thuoc do.

Muc dich: chon MOT model duy nhat de giu lai. Chay:
  python scripts/so_sanh_model.py
"""
from pathlib import Path
import numpy as np
from ultralytics import YOLO

ROOT = Path("risishrimp-count-1")
V = ROOT / "valid" / "images"
CONF, IMGSZ, N_MAU = 0.3, 1280, 120   # ONNX export dynamic=False -> bat buoc 1280


def dem(m, p, conf=CONF):
    # onnxruntime ban CPU: phai ep device="cpu", khong ultralytics tu chon CUDA roi loi binding
    return len(m.predict(str(p), imgsz=IMGSZ, conf=conf, device="cpu", verbose=False)[0].boxes)


def that(p):
    lb = ROOT / "valid" / "labels" / (Path(p).stem + ".txt")
    return sum(1 for _ in open(lb)) if lb.exists() else 0


def sai(m, files):
    s = [abs(dem(m, p) - that(p)) / max(that(p), 1) * 100 for p in files[:N_MAU]]
    return float(np.mean(s)) if s else float("nan")


def main():
    tat_ca = sorted(str(p) for p in V.iterdir())
    nhom = {
        "nen toi ": [p for p in tat_ca if "_inv" not in p and not Path(p).name.startswith("syn_")],
        "nen sang": [p for p in tat_ca if p.endswith("_inv.jpg")],
        "tom ve  ": [p for p in tat_ca if Path(p).name.startswith("syn_")],
    }
    khay = [p for p in Path("tools/mau").glob("khay-trong*.jpg")]

    for f in sorted(Path("model").glob("*.onnx")):
        print(f"\n===== {f.name} =====", flush=True)
        m = YOLO(str(f), task="detect")
        for ten, fs in nhom.items():
            print(f"  sai so {ten}: {sai(m, fs):5.1f}%   (n={min(len(fs), N_MAU)})", flush=True)
        for k in khay:
            print(f"  khay trong {k.name}: conf0.25 -> {dem(m, k, 0.25)} con | "
                  f"conf0.05 -> {dem(m, k, 0.05)} con", flush=True)


if __name__ == "__main__":
    main()
