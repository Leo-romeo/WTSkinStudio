# Build zstd.wasm (decode-only, dictionary-capable) with the same wasi-sdk used for oodle.wasm.
$ErrorActionPreference = "Stop"
$env:TMP = "D:\claude_work\tmp"; $env:TEMP = "D:\claude_work\tmp"
$WASI = "D:\claude_work\wasi-sdk-25.0-x86_64-windows"
$CC = "$WASI\bin\clang.exe"
$SYSROOT = "$WASI\share\wasi-sysroot"
$SFL = "D:\claude_work\zstd-1.5.7\build\single_file_libs"
$OUT = "D:\claude_work\zstd-build"
New-Item -ItemType Directory -Force $OUT | Out-Null

$flags = @(
  "--target=wasm32-wasip1", "--sysroot=$SYSROOT",
  "-O3", "-flto", "-fvisibility=hidden", "-std=gnu11",
  "-DNDEBUG", "-I$SFL",
  "-nostartfiles", "-Wl,--no-entry", "-Wl,--export-memory",
  "-Wl,--export=zdec_malloc", "-Wl,--export=zdec_free",
  "-Wl,--export=zdec_dctx_new", "-Wl,--export=zdec_dctx_free",
  "-Wl,--export=zdec_ddict_new", "-Wl,--export=zdec_ddict_free",
  "-Wl,--export=zdec_decompress",
  "-Wl,--lto-O3", "-Wl,--strip-debug", "-Wl,--gc-sections",
  "-Wl,-z,stack-size=1048576", "-Wl,--initial-memory=16777216"
)
& $CC @flags -o "$OUT\zstd.wasm" "D:\claude_work\zstd_wasm_shim.c"
if ($LASTEXITCODE -ne 0) { throw "build failed" }
Write-Host "Done: $((Get-Item "$OUT\zstd.wasm").Length) bytes"
