# Cài môi trường train FarmX trên Windows + RTX 5080 (Blackwell -> cần torch CUDA 12.8)
# Chạy trong PowerShell tại thư mục repo:  powershell -ExecutionPolicy Bypass -File scripts\setup_win.ps1
$ErrorActionPreference = "Stop"

Write-Host "== 1. Driver NVIDIA ==" -ForegroundColor Cyan
nvidia-smi
if ($LASTEXITCODE -ne 0) { throw "Khong chay duoc nvidia-smi - cai driver NVIDIA truoc (can >= 570)" }

Write-Host "== 2. Python 3.11 ==" -ForegroundColor Cyan
# Sua: neu chua co py launcher thi 'py' nem CommandNotFoundException, gap
# $ErrorActionPreference=Stop se chet ngay truoc khi kip chay winget.
# Phai kiem tra bang Get-Command truoc, va refresh PATH sau khi cai.
function Test-Py311 {
    if (-not (Get-Command py -ErrorAction SilentlyContinue)) { return $false }
    try { & py -3.11 --version 2>$null | Out-Null } catch { return $false }
    return ($LASTEXITCODE -eq 0)
}

if (-not (Test-Py311)) {
    Write-Host "Chua co Python 3.11 - dang cai bang winget..." -ForegroundColor Yellow
    winget install --id Python.Python.3.11 -e --source winget `
        --accept-package-agreements --accept-source-agreements --disable-interactivity
    # process hien tai khong tu thay PATH moi -> nap lai tu registry
    $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
                [Environment]::GetEnvironmentVariable("Path", "User")
    if (-not (Test-Py311)) { throw "Cai Python 3.11 xong nhung van khong goi duoc 'py -3.11'. Mo PowerShell moi roi chay lai script." }
}
py -3.11 --version

Write-Host "== 3. venv ==" -ForegroundColor Cyan
if (-not (Test-Path .venv)) { py -3.11 -m venv .venv }
& .\.venv\Scripts\Activate.ps1
python -m pip install -U pip

Write-Host "== 4. PyTorch CUDA 12.8 ==" -ForegroundColor Cyan
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu128

Write-Host "== 5. ultralytics roboflow onnx onnxslim onnxruntime ==" -ForegroundColor Cyan
pip install ultralytics roboflow onnx onnxslim onnxruntime requests

Write-Host "== 6. Kiem tra GPU ==" -ForegroundColor Cyan
python -c "import torch;print('torch',torch.__version__,'cuda',torch.version.cuda,'|',torch.cuda.is_available(),torch.cuda.get_device_name(0))"
Write-Host "Xong. Chay train:  python scripts\train_v02.py" -ForegroundColor Green
